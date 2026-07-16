#!/usr/bin/env bash
# 产品表面过滤器:从 git diff 里只捞"用户看得见 / 能改变用户看见什么"的改动,给人扫。
#
# 为什么要它:一周的 diff 可能 2000 行,其中 95% 是实现细节。人不该读那 95%。
# 这个脚本回答一个问题:"这段时间里,产品表面被动过哪些地方?"
#
# 用法: bash scripts/eval/loop/product-surface-diff.sh <since-commit>
#       bash scripts/eval/loop/product-surface-diff.sh HEAD~10
#       bash scripts/eval/loop/product-surface-diff.sh main        # 对比分支
#       bash scripts/eval/loop/product-surface-diff.sh             # 默认:未提交的工作区改动
#
# 输出按【风险从高到低】排序,不是按文件名。人的注意力有限,先看最该看的。
set -uo pipefail

SINCE="${1:-}"
if [ -z "$SINCE" ]; then
  DIFF_ARGS=""      # 工作区(含未暂存)
  SCOPE="未提交的工作区改动"
else
  DIFF_ARGS="$SINCE"
  SCOPE="$SINCE → HEAD"
fi

echo "═══════════════════════════════════════════════════════════"
echo " 产品表面改动 | 范围:$SCOPE"
echo "═══════════════════════════════════════════════════════════"

# 拿到改动的文件清单
FILES=$(git diff --name-only $DIFF_ARGS 2>/dev/null | sort -u)
[ -z "$FILES" ] && { echo "（无改动）"; exit 0; }

TOTAL=$(echo "$FILES" | wc -l | tr -d ' ')

# ── 分类器 ────────────────────────────────────────────────────────────────────
# 每类给:标题、判据、匹配到的文件+行。
# 判据写在输出里,让人知道这条为什么被捞出来——不解释判据的过滤器没法被信任。

section() {
  local title="$1" why="$2" files="$3" pattern="$4"
  [ -z "$files" ] && return
  echo ""
  echo "───────────────────────────────────────────────────────────"
  echo "▌$title"
  echo "  判据:$why"
  echo "───────────────────────────────────────────────────────────"
  for f in $files; do
    [ -f "$f" ] || { echo "  $f  （已删除）"; continue; }
    if [ -n "$pattern" ]; then
      # 只显示命中判据的那几行改动
      local hits
      hits=$(git diff -U0 $DIFF_ARGS -- "$f" 2>/dev/null \
             | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
             | grep -iE "$pattern" | head -8)
      if [ -n "$hits" ]; then
        echo ""
        echo "  📄 $f"
        echo "$hits" | sed 's/^/     /'
      fi
    else
      echo ""
      echo "  📄 $f"
      git diff --stat $DIFF_ARGS -- "$f" 2>/dev/null | head -1 | sed 's/^/     /'
    fi
  done
}

# ── 第 0 类:考卷与承诺（最高风险，动了要立刻质问）──────────────────────────
GOVERN=$(echo "$FILES" | grep -E "docs/PRODUCT_INVARIANTS\.md|scripts/eval/golden/|scripts/eval/loop/BASELINE\.json|scripts/eval/loop/LOOP\.md|scripts/eval/run-.*\.ts" || true)
if [ -n "$GOVERN" ]; then
  echo ""
  echo "🔴🔴🔴 考卷/承诺/规则被改动 —— 这些只有人能改,逐条确认是谁改的、为什么"
  for f in $GOVERN; do
    echo "     ⚠️  $f"
  done
fi

# ── 第 1 类:用户可见文案 ──────────────────────────────────────────────────────
COPY=$(echo "$FILES" | grep -E "\.(tsx|jsx)$" || true)
section "用户可见文案（前端中文字符串）" \
        "tsx/jsx 里增删的中文字符串 = 用户读到的字变了" \
        "$COPY" \
        "[一-龥]"

# ── 第 2 类:阈值常量 ──────────────────────────────────────────────────────────
THRESH=$(echo "$FILES" | grep -E "\.(ts|tsx)$" || true)
section "阈值常量" \
        "SCORE_HIGH/MID/LOW、NEIGHBOR_MIN/TARGET、timeout —— 改一个数,全盘分档就变" \
        "$THRESH" \
        "SCORE_HIGH|SCORE_MID|SCORE_LOW|NEIGHBOR_MIN|NEIGHBOR_TARGET|TIMEOUT|timeoutMs|maxTokens|MAX_ATTEMPTS"

# ── 第 3 类:展示逻辑 ──────────────────────────────────────────────────────────
section "展示逻辑（决定用户首屏看到什么）" \
        "highGroup/midGroup/lowGroup/expanded/noneVisible/NoMatchView" \
        "$THRESH" \
        "highGroup|midGroup|lowGroup|expanded|noneVisible|globalNoneVisible|NoMatchView|GroupHeader"

# ── 第 4 类:降级路径 ──────────────────────────────────────────────────────────
section "降级路径（出错时用户看到什么）" \
        "catch / fallback / ?? 默认值 —— 历史上 8 个 bug 里 6 个藏在这儿" \
        "$THRESH" \
        "catch|fallback|\?\? |return \[\]|return null"

# ── 第 5 类:prompt ────────────────────────────────────────────────────────────
PROMPTS=$(echo "$FILES" | grep -E "src/services/.*\.ts$" || true)
section "Prompt（AI 的判断标准）" \
        "services/*.ts 的 SYSTEM_PROMPT —— 改 prompt 有全局副作用,不是精准打击" \
        "$PROMPTS" \
        "SYSTEM_PROMPT|PROMPT|示例|【"

# ── 第 6 类:零红线环节（哑铃）────────────────────────────────────────────────
NOGUARD=$(echo "$FILES" | grep -E "src/services/(analysis|practice|restructure)\.ts$" || true)
if [ -n "$NOGUARD" ]; then
  echo ""
  echo "───────────────────────────────────────────────────────────"
  echo "🚩 零红线环节被改动 —— 回归守卫测不到这些,必须人工确认"
  echo "  判据:analysis / practice / restructure 目前没有任何 eval 与红线"
  echo "───────────────────────────────────────────────────────────"
  for f in $NOGUARD; do
    echo "     🚩 $f"
    git diff --stat $DIFF_ARGS -- "$f" 2>/dev/null | head -1 | sed 's/^/        /'
  done
  echo ""
  echo "  ⚠️ analysis 是用户点进题目后看到的全部内容。它改了而红线全绿,"
  echo "     不代表没坏 —— 代表我们测不到。"
fi

# ── 收尾 ──────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo " 共 $TOTAL 个文件改动。上面只列了命中产品表面判据的部分。"
echo " 没列出来的 = 纯实现细节（类型、测试、日志、重构）。"
echo ""
echo " 对照 docs/PRODUCT_INVARIANTS.md 逐条检查:任一条动摇 → 挂旗停机。"
echo "═══════════════════════════════════════════════════════════"
