#!/usr/bin/env bash
# 考卷保护hook:挡住 subagent 对金标/评估脚本/指标定义的写入。
#
# 用法:挂在 subagent frontmatter 的 PreToolUse (matcher: "Write|Edit|Bash"),带一个档位参数:
#   bash scripts/eval/loop/guard-golden.sh full       ← @fix-engineer:考卷全禁(默认)
#   bash scripts/eval/loop/guard-golden.sh human-only ← @baseline-engineer:只禁「只有人能写」的那几样
#
# 两个档位的分界(2026-07-17 新增 human-only 档):
#   full       = 金标 + 评估脚本 + 指标定义 + 红线 + 不变式 + 护栏 + agent说明书  ——「碰不到考卷」
#   human-only = 金标 + 不变式 + 护栏 + agent说明书                          ——「碰不到只有人能写的东西」
# 为什么要两档:产品不变式 #7 说「金标只能由人写」,那是【人】的专属;
# 而红线数值/指标定义是「必停第2条」——【人拍板后需要有人实施】。此前没有任何角色能实施它,
# 于是这活默认落到主会话,而主会话没有岗位约束、且往往同时是提案方(2026-07-17 产品方指出)。
# human-only 档就是给那个实施者的:它能落地人已拍板的红线,但金标依旧碰不到。
# 协议:从stdin读工具调用JSON;命中保护清单 → exit 2 阻断(stderr会反馈给agent)。
#
# 2026-07-17 实测修补(台账 066)。此前只挂 Write|Edit,**Bash 完全不在拦截面内**。
# 实测证据(fix-engineer 亲跑,非推断):
#   Write  → specs/_hook_probe.md          被拦 ✅
#   Edit   → BASELINE.json                 被拦 ✅
#   Bash   → `printf ... > specs/x.md`     **没拦,文件真的建出来了** ❌
#   Bash   → `touch BASELINE.json`         **没拦** ❌
# 即:LOOP.md「hook 直接物理拒绝」与产品不变式 #7「物理拦截,不靠自觉」
# 此前只在 Write|Edit 那一面为真;Bash 面上考卷一直只靠 agent 自觉。
#
# ⚠️ 诚实边界(红线设计原则 4:禁止用「稳健于偏差」粉饰):
#   Bash 面的拦截是**字符串启发式**,不是 shell 解析,做不到完备。
#   已知绕过:变量拼路径($D/ranking.v1.json)、base64、python -c 里拼字符串、cd 后用相对路径……
#   **它把「顺手写」变难,挡不住「存心写」。** 真正的保证只有两条:
#     (1) 不给需要写考卷的 agent 配 Bash 工具;
#     (2) 人审 diff。
#   本脚本不宣称「物理拒绝」——它宣称「Write/Edit 面物理拒绝,Bash 面尽力拦截」。

PROFILE="${1:-full}"
INPUT=$(cat)

read -r TOOL_NAME FILE_PATH COMMAND <<<"$(printf '%s' "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    ti = d.get('tool_input', {}) or {}
    name = d.get('tool_name') or ''
    # Write/Edit 系:路径在 file_path/path;Bash:整条命令在 command
    fp = ti.get('file_path') or ti.get('path') or ''
    cmd = (ti.get('command') or '').replace('\n', ' ')
    # 用 \x01 分隔避免路径含空格时错位
    print(name, fp or '-', cmd or '-')
except Exception:
    print('', '-', '-')
")"

# 两档共禁:只有【人】能写的东西。任何 subagent、任何档位都碰不到。
HUMAN_ONLY=(
  "scripts/eval/golden/"                # 产品不变式 #7:金标只能由人写
  "docs/PRODUCT_INVARIANTS.md"          # 产品不变式=什么不许变,只有人能改。2026-07-16 新增
  # ↓ 2026-07-17 新增:护栏自己此前不在保护清单里 —— agent 可以先改门禁再改考卷。
  "scripts/eval/loop/guard-golden.sh"
  "scripts/eval/loop/only-ledger.sh"
  ".claude/agents/"                     # agent 岗位说明书含 hooks 声明,改它=拆自己的门禁
  ".claude/settings.json"               # 权限与 hook 注册
)

# 仅 full 档额外禁:人拍板后【需要有人实施】的东西。@baseline-engineer 可以写这些。
EXAM_ARTIFACTS=(
  "scripts/eval/run-extraction.ts"
  "scripts/eval/run-ranking.ts"
  "scripts/eval/run-ranking-score.ts"   # 算分脚本=闸门的口径定义,和金标同级。2026-07-16 补:此前漏保护
  "scripts/eval/hidden-sample-weight.ts" # 隐藏区抽样冻结权重表=指标定义,与算分脚本同级。2026-07-17 新增
  "scripts/data/question-observation-remap"
  "scripts/eval/loop/specs/"
  "scripts/eval/loop/BASELINE.json"
  "scripts/eval/loop/regression-all.sh" # 回归守卫=红线的执行者。2026-07-17 新增:它此前不在任何清单里,
                                        # 而它自己带着 `or 100` + 旧线40 的 bug 活了很久(台账 064)。
)

case "$PROFILE" in
  human-only) PROTECTED=("${HUMAN_ONLY[@]}") ;;
  full|*)     PROTECTED=("${HUMAN_ONLY[@]}" "${EXAM_ARTIFACTS[@]}") ;;
esac

deny() {
  if [ "$PROFILE" = "human-only" ]; then
    echo "⛔ 禁区:$1 —— 这是【只有人能写】的东西(金标/产品不变式/护栏/agent说明书)。" >&2
    echo "   你是实施官,能落地人已拍板的红线与指标定义,但这几样不行。停下来交人。" >&2
  else
    echo "⛔ 禁区:$1 属于考卷/评估基建,修复工程师无权改动。若确需改动,停下来交人裁决。" >&2
  fi
  exit 2
}

case "$TOOL_NAME" in
  Bash)
    [ "$COMMAND" = "-" ] && exit 0
    # 只在「命中保护路径」且「像是写操作」时阻断,否则会误伤 cat/grep/ls 等只读命令。
    for p in "${PROTECTED[@]}"; do
      if [[ "$COMMAND" == *"$p"* ]]; then
        # 写操作特征:重定向 / tee / 原地编辑 / 移动删除 / 权限时间戳 / 常见改写工具
        if [[ "$COMMAND" =~ (\>|\>\>|[[:space:]]tee[[:space:]]|sed[[:space:]]+-i|perl[[:space:]]+-i|[[:space:]]mv[[:space:]]|[[:space:]]cp[[:space:]]|[[:space:]]rm[[:space:]]|truncate|[[:space:]]dd[[:space:]]|chmod|chown|touch|patch|git[[:space:]]+(checkout|restore|apply|revert)) ]]; then
          deny "[Bash] $p ← 命令:$COMMAND"
        fi
      fi
    done
    exit 0
    ;;
  *)
    # Write/Edit/NotebookEdit 等:按路径判。
    # ⚠️ 拿不到路径就放行(fail-open)——宁可漏拦不可误伤。这是已知弱点:
    #    stdin 字段名随 Claude Code 版本漂移时,这里会静默全放行。
    [ -z "$FILE_PATH" ] || [ "$FILE_PATH" = "-" ] && exit 0
    for p in "${PROTECTED[@]}"; do
      [[ "$FILE_PATH" == *"$p"* ]] && deny "$FILE_PATH"
    done
    exit 0
    ;;
esac
