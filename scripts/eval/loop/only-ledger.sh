#!/usr/bin/env bash
# 记录员专用hook:只允许写议题台账,其他一律拒绝。
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
[ -z "$FILE_PATH" ] && exit 0
if [[ "$FILE_PATH" == *"scripts/eval/loop/DISCUSSION_LOG.md"* ]]; then
  exit 0
fi
echo "⛔ 记录员只能写 scripts/eval/loop/DISCUSSION_LOG.md,拒绝写入:$FILE_PATH" >&2
exit 2
