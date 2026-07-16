#!/usr/bin/env bash
# 回归守卫:任何环节改动后,跑全部已有评估,和基线比,超噪声阈值的退步直接报FAIL。
# 这是脚本不是agent——数字对比不需要判断力,需要的是绝不含糊。
# 用法: bash scripts/eval/loop/regression-all.sh        (完整,萃取R=3)
#       bash scripts/eval/loop/regression-all.sh quick  (快跑,萃取R=1,省额度)
set -e
MODE=${1:-full}
RUNS=3; [ "$MODE" = "quick" ] && RUNS=1
echo "=== 回归守卫 | 模式:$MODE ==="

echo "--- [1/3] 萃取 (R=$RUNS) ---"
npm run eval:extraction -- --runs=$RUNS
echo "--- [2/3] 匹配+重排 (全量导出) ---"
npm run eval:ranking
# TODO 未来环节接入点(有eval后取消注释):
# npm run eval:analysis
# npm run eval:practice
# npm run eval:restructure

# 重排算分:导出只产候选,不产质量分。不跑这步=测不到重排判断力。
# 必须显式传 --export=<最新导出>,脚本本身不猜文件。
echo "--- [3/3] 重排算分 (对金标) ---"
LATEST_RANKING=$(python3 -c "
import glob, re, sys
# 只认真导出: ranking-<ISO时间戳>.json。排除 -gold-scaffold / ranking-score-* / ranking-v2-scaffold-*
fs = [f for f in glob.glob('scripts/eval/results/ranking-*.json')
      if re.search(r'/ranking-\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$', f)]
if not fs: sys.exit('找不到重排导出')
print(sorted(fs)[-1])
")
echo "导出: $LATEST_RANKING"
npm run eval:ranking:score -- --export="$LATEST_RANKING"

echo "--- 对比基线 ---"
python3 - "$LATEST_RANKING" << 'PYEOF'
import json, glob, re, sys

RANKING = sys.argv[1]
BASE = json.load(open('scripts/eval/loop/BASELINE.json'))
MARGIN = BASE.get('noise_margin_pct', 1.5)

def latest(pattern, must_match=None):
    fs = sorted(glob.glob(pattern))
    if must_match:
        fs = [f for f in fs if re.search(must_match, f)]
    return fs[-1] if fs else None

fails, report = [], []

def check(name, value, base, direction, unit='%', margin=MARGIN):
    """direction: 'up'=越大越好(不许跌) / 'down'=越小越好(不许涨)
    双向都留 margin 噪声容差,但方向相反——防止把'不许涨'的指标当'不许跌'来放水。"""
    if direction == 'up':
        ok = value >= base - margin
        line = f"{name}: {value:.1f}{unit} (基线{base}{unit}, 不许跌破{base - margin:.1f})"
    else:
        ok = value <= base + margin
        line = f"{name}: {value:.1f}{unit} (上限{base}{unit}, 不许涨过{base + margin:.1f})"
    report.append(f"{line} {'PASS' if ok else 'FAIL'}")
    if not ok:
        fails.append(name)

def check_count(name, value, cap):
    ok = value <= cap
    report.append(f"{name}: {value} (上限{cap}) {'PASS' if ok else 'FAIL'}")
    if not ok:
        fails.append(name)

# ── 萃取 ──────────────────────────────────────────────────────────────────────
f = latest('scripts/eval/results/extraction-*.json')
if f:
    m = json.load(open(f))['metrics']
    check('萃取严格命中', m['strictHit'] / m['accDenom'] * 100,
          BASE['extraction_strict_pct'], 'up')

# ── 重排:导出层(召回是否塌方) ────────────────────────────────────────────────
d = json.load(open(RANKING))
s = d['summary']
check_count('重排 noMatch', s['noMatch'], BASE['ranking_nomatch_max'])

# 算分报告只记 goldVersion 不记路径,这里跟 run-ranking-score.ts 的 DEFAULT_GOLD 保持一致
gold = json.load(open('scripts/eval/golden/ranking.v1.json'))
gold_map = {it['storyId']: {l['questionId']: l['goldBucket'] for l in it['labels']}
            for it in gold['items'] if it.get('countInAccuracy', True)}

# ⚠️ 所有"按故事数算"的指标,分母必须是【金标覆盖的故事】,不是导出里的全部故事。
#    2026-07-16 踩过:导出从40个故事变成100个(run-ranking.ts 改动),而金标只覆盖40个。
#    用 len(d['stories']) 当分母 → 首屏可用率 12.5% 被算成 5.0%,报了个假FAIL。
#    基线写的就是"6/40",分母口径本就是金标覆盖数,这里是对齐口径,不是改口径。
gold_stories = [st for st in d['stories'] if st['storyId'] in gold_map]
if not gold_stories:
    print('❌ 导出里没有任何金标覆盖的故事 —— 对不上,视为FAIL')
    sys.exit(1)

# 可见=0假空:召回到了候选,但全被压到40以下 → 用户看到 NoMatchView
vz = sum(1 for st in gold_stories if not st['noMatch'] and st.get('candidates') and
         all((c.get('relevanceScore') or 100) < 40 for c in st['candidates']))
check_count('可见=0假空', vz, BASE['ranking_visible_zero_max'])

# ── 重排:质量层(对金标算分) ──────────────────────────────────────────────────
f = latest('scripts/eval/results/ranking-score-*.json')
if f is None:
    print('❌ 找不到 ranking-score-*.json —— 算分没跑成,重排质量未被测到,视为FAIL')
    sys.exit(1)

sc = json.load(open(f))
g = sc['gates']

# 首屏精确率:AI高里有多少是金标高。不许跌 = 不许让首屏更脏。
check('首屏精确率', g['firstScreenPrecision']['value'] * 100,
      BASE['ranking_firstscreen_precision_pct'], 'up')

# 虚高率:AI高里有多少是金标≤低。不许涨 = 不许更多地骗用户。
check('虚高率', g['falseHigh']['value'] * 100,
      BASE['ranking_inflation_rate_pct_max'], 'down')

# 召回精度:漏斗捞上来的题里,用户真能用的(金标高/中)占多少。
# ⚠️ 金标视角,与AI打分无关——它测的是"映射准不准",不是"重排判得准不准"。
#    其余五条红线全在测重排,只有这条测召回/映射。动映射(题目重映射、季度更新题库)时,
#    没有这条,回归守卫看不见映射退化。
# 口径:本轮召回 ∩ 金标已标 的对,金标∈{高,中} / 全部计入对。
#    必须按"本轮召回"算而不是只读金标文件——只读金标文件是个常数,永远PASS,等于没装。
gold_hit = gold_total = 0
for st in gold_stories:
    gm = gold_map.get(st['storyId'], {})
    for c in (st.get('candidates') or []):
        b = gm.get(c['questionId'])
        if b is None:
            continue  # 召回了但金标没标(多为隐藏区抽样外),不入分母
        gold_total += 1
        if b in ('高', '中'):
            gold_hit += 1
check('召回精度', gold_hit / gold_total * 100,
      BASE['ranking_recall_precision_pct'], 'up')

# 首屏可用率:有多少故事的首屏至少有一道"能原样答"的题。
# ⚠️ 这条是"精确率/虚高率"的对冲。只守前两条,最省事的刷分法是把所有候选压到40以下——
#    首屏精确率↑虚高率↓,而用户看到的是空屏。这条不许跌,就是不许用空屏换干净。
usable = sum(
    1 for st in gold_stories
    if any((c.get('relevanceScore') or -1) >= 85
           and gold_map.get(st['storyId'], {}).get(c['questionId']) == '高'
           for c in (st.get('candidates') or []))
)
check('首屏可用率', usable / len(gold_stories) * 100,
      BASE['ranking_firstscreen_usable_pct'], 'up')

print('\n'.join(report))
if fails:
    print(f"\n❌ 回归FAIL: {fails} —— 打回修复,不许合并")
    sys.exit(1)
print("\n✅ 回归全部通过")
PYEOF
