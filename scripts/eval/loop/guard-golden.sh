#!/usr/bin/env bash
# 考卷保护hook:挡住 fix-engineer 对金标/评估脚本/指标定义的写入。
# 用法:挂在 subagent frontmatter 的 PreToolUse (matcher: Write|Edit)。
# 协议:从stdin读工具调用JSON,取写入路径;命中保护清单 → exit 2 阻断(stderr会反馈给agent)。
# 注意:hook的stdin字段名随Claude Code版本可能微调,如不生效,让Claude Code按官方hooks文档校准取路径那一行。

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    ti = d.get('tool_input', {}) or {}
    print(ti.get('file_path') or ti.get('path') or '')
except Exception:
    print('')
")

[ -z "$FILE_PATH" ] && exit 0  # 拿不到路径就放行,宁可漏拦不可误伤

PROTECTED=(
  "scripts/eval/golden/"
  "scripts/eval/run-extraction.ts"
  "scripts/eval/run-ranking.ts"
  "scripts/eval/run-ranking-score.ts"   # 算分脚本=四闸门的口径定义,和金标同级。2026-07-16 补:此前漏保护
  "scripts/eval/hidden-sample-weight.ts" # 隐藏区抽样冻结权重表=指标定义,与算分脚本同级。2026-07-17 新增
  "scripts/data/question-observation-remap"
  "scripts/eval/loop/specs/"
  "scripts/eval/loop/BASELINE.json"
  "docs/PRODUCT_INVARIANTS.md"          # 产品不变式=什么不许变,只有人能改。2026-07-16 新增
)

for p in "${PROTECTED[@]}"; do
  if [[ "$FILE_PATH" == *"$p"* ]]; then
    echo "⛔ 禁区:$FILE_PATH 属于考卷/评估基建,修复工程师无权改动。若确需改动,停下来交人裁决。" >&2
    exit 2
  fi
done
exit 0
