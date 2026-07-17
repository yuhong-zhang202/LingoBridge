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

echo "--- 对比基线 v3 ---"
python3 - "$LATEST_RANKING" << 'PYEOF'
import json, glob, re, sys, hashlib

# ⚠️ 尺子 v3 的两条线。必须与 src/lib/constants.ts 保持一致(SCORE_HIGH=85 / SCORE_MID=60)。
#    SCORE_LOW 已于 dd418d5 删除——「低档」不再存在,<60 一律不展示。
SCORE_HIGH, SCORE_MID = 85, 60

RANKING = sys.argv[1]
BASE = json.load(open('scripts/eval/loop/BASELINE.json'))

fails, warns, report = [], [], []

def check_min(name, value, floor, extra=''):
    ok = value >= floor
    report.append(f"{name}: {value} (下限{floor}, 不许跌破) {'PASS' if ok else 'FAIL'}{extra}")
    if not ok: fails.append(name)

def check_max(name, value, cap, extra=''):
    ok = value <= cap
    report.append(f"{name}: {value} (上限{cap}, 不许涨过) {'PASS' if ok else 'FAIL'}{extra}")
    if not ok: fails.append(name)

# ── 萃取 ──────────────────────────────────────────────────────────────────────
# 萃取仍用 1.5pp 容差(其噪声地板实测 ±1.0pp)。重排【不】共用它——见 BASELINE 的 _废除noise_margin_pct。
f = sorted(glob.glob('scripts/eval/results/extraction-*.json'))
if f:
    m = json.load(open(f[-1]))['metrics']
    v = m['strictHit'] / m['accDenom'] * 100
    base, margin = BASE['extraction_strict_pct'], BASE['extraction_noise_margin_pct']
    ok = v >= base - margin
    report.append(f"萃取严格命中: {v:.1f}% (基线{base}%, 不许跌破{base - margin:.1f}) {'PASS' if ok else 'FAIL'}")
    if not ok: fails.append('萃取严格命中')

# ── 金标结构断言(红队修改项5) ───────────────────────────────────────────────
# 金标一改这些数必动(坑⑭)。对不上 = 金标换了版本却没重钉基线 → 直接 FAIL,不许静默继续。
# ⛔ 2026-07-17:上面这句被证伪。6 条金标补裁(中→低)后,高11/故事40/labels148 三条【全程静音】,
#    而 has_hm 从 16 掉到 11(−31%)——红线5 的分母整个换了一遍。断言锁的是它列出的那三个数,
#    不是「金标没变」。故补 金标中总数 / has_hm故事数 两条(后者是红线5 的分母本身)。
gold = json.load(open('scripts/eval/golden/ranking.v1.json'))
gold_map = {it['storyId']: {l['questionId']: l['goldBucket'] for l in it['labels']}
            for it in gold['items'] if it.get('countInAccuracy', True)}
# ⛔ 2026-07-17 当夜:S056/aee49959 中→低(产品方裁决)→ S056 失去唯一的金标中 → 离开 has_hm。
#    中 20→19、has_hm 11→10,而高11/故事40/labels148 三条【依旧一声不响】。
#    **这是这两条断言第一次真正咬住东西**——它们 2026-07-17 新增的理由就是堵这个洞。
# 低/隐藏两条(新增):现有四条能推出「低+隐藏=118」,推不出 67/51 的拆分,
#    而红线7A 的论域正是隐藏那 51 条。不锁它,7A 的语义会随金标改版无声漂掉。
gold_high_total = sum(1 for qs in gold_map.values() for b in qs.values() if b == '高')
gold_mid_total = sum(1 for qs in gold_map.values() for b in qs.values() if b == '中')
gold_low_total = sum(1 for qs in gold_map.values() for b in qs.values() if b == '低')
gold_hidden_total = sum(1 for qs in gold_map.values() for b in qs.values() if b == '隐藏')
gold_labels = sum(len(qs) for qs in gold_map.values())
# has_hm:有≥1条金标高或中的故事 = 红线5 的分母。40 个故事里 30 个结构上不可能成为真丢。
has_hm = {s for s, qs in gold_map.items() if any(b in ('高', '中') for b in qs.values())}
for name, got, want in [('金标高总数', gold_high_total, BASE['gold_high_total_assert']),
                        ('金标中总数', gold_mid_total, BASE['gold_mid_total_assert']),
                        ('金标低总数', gold_low_total, BASE['gold_low_total_assert']),
                        ('金标隐藏总数', gold_hidden_total, BASE['gold_hidden_total_assert']),
                        ('金标故事数', len(gold_map), BASE['gold_stories_assert']),
                        ('金标标注数', gold_labels, BASE['gold_labels_assert']),
                        ('金标has_hm故事数', len(has_hm), BASE['gold_has_hm_stories_assert'])]:
    if got != want:
        fails.append(f'{name}断言')
        report.append(f"❌ {name}断言: 实为 {got}, 基线声称 {want} —— 金标已变而基线未重钉,拒绝比较")
    else:
        report.append(f"{name}断言: {got} PASS")

# ── 金标 core digest 断言(红队放行条件2:『金标加逐条 digest 断言,堵住保桶置换』) ──
# 七条计数断言锁边缘分布,锁不住条目身份。保桶置换(隐藏↔低,总数不变)让计数全程静音,
# 而红线7A 的论域(隐藏 51 条)被换掉一条成员。digest 咬住它。
# ⚠️ 实施约束(不写死会被绕过):
#   (1) 必须从【本脚本上面已 load 的那个 gold 对象】算,不许另开一次 open()——
#       否则可让算分读金标A、digest 读金标B(实施官注:此处直接复用 line『gold = json.load(...)』的对象)。
#   (2) **排序必须在哈希之前**(按 storyId/questionId)——这样重排字段顺序、prettier 一遍,digest 不动。
# 逐字段取舍(设计官):收 storyId/questionId(身份)+goldBucket(红线论域)+countInAccuracy(40故事闸门);
#   不收 note(判例文字,收了每次写判例都 FAIL)、不收 version/revisionNote/annotator(元数据)、不收 zone(只驱动埋没率HT权重)。
# 实测:改全部 note → digest 不变;保桶置换(S074/f9119694 隐藏→低 + S066/2b5fd475 低→隐藏)→ 7bcc85d74ac5886f。
_digest_lines = []
for _it in gold['items']:
    _sid, _cia = _it['storyId'], _it.get('countInAccuracy', True)
    for _l in _it['labels']:
        _digest_lines.append((_sid, _l['questionId'], f"{_sid}|{_cia}|{_l['questionId']}|{_l['goldBucket']}"))
_digest_lines.sort(key=lambda x: (x[0], x[1]))          # ← 排序在哈希之前(约束2)
_gold_core_digest = hashlib.sha256('\n'.join(x[2] for x in _digest_lines).encode()).hexdigest()[:16]
_gold_core_want = BASE['gold_digest_core_assert']
if _gold_core_digest != _gold_core_want:
    fails.append('金标core_digest断言')
    report.append(f"❌ 金标 core digest 不匹配 —— 金标已改版。")
    report.append(f"   实为 {_gold_core_digest}, 基线声称 {_gold_core_want}")
    report.append(f"   全部红线数值是对旧金标标定的,对新金标未经标定。")
    report.append(f"   这【不是】说金标错了,也【不是】说模型退步了 —— 是说这次比较无效。")
    report.append(f"   动作:人确认金标改动 → @baseline-engineer 重钉 → 再比较。")
    report.append(f"   定位改了哪里:看上面六条计数断言(digest 只说「变了」,计数说「哪变了」)。")
else:
    report.append(f"金标 core digest 断言: {_gold_core_digest} PASS")

# ── 对齐导出 ─────────────────────────────────────────────────────────────────
# ⚠️ 所有「按故事数算」的指标,分母必须是【金标覆盖的故事】,不是导出里的全部故事(原则2/台账019)。
d = json.load(open(RANKING))
gold_stories = [st for st in d['stories'] if st['storyId'] in gold_map]
gold_stories_by_id = {st['storyId']: st for st in gold_stories}
if not gold_stories:
    print('❌ 导出里没有任何金标覆盖的故事 —— 对不上,视为FAIL'); sys.exit(1)
if len(gold_stories) != len(gold_map):
    fails.append('导出覆盖'); report.append(f"❌ 导出只覆盖 {len(gold_stories)}/{len(gold_map)} 个金标故事")

# ── 候选集规模断言(红队放行条件6) ───────────────────────────────────────────
# 金标断言只锁金标,不锁候选池。而红线6(缺口计数)的自然尺度是「未标候选池」——
# 映射一改,未标池变大 → 缺口计数随之涨 → 红线6 假 FAIL;金标补全 → 缺口恒0 → 红线6 变死线。
# 两个方向都会让计数的语义悄悄漂掉,而金标断言一声不响。
#
# ⛔ 2026-07-17:全量候选断言(997)已删除,改观察项。理由不是「它抖」,是「它测不到它想测的」:
#    红线6 的作用域只在金标 40 故事内,而 997 里有 704 条候选根本不在该作用域内——只贡献噪声。
#    实测六轮 [997,997,997,995,995,998](三个值),assert=997 会在 3/6 轮 FAIL。
#    成因 S100 primary SPI_06↔EMO_08(候选8↔6)/ S097 secondary None→REL_02(候选4→5),两者都不在金标 40 里。
# ⚠️ 293 的「稳」,主语是什么:它恒定的原因是【金标 40 故事的 primaryPoint 六轮全部恒定】——
#    这是**实测运气,不是构造性恒真**。S051 的 secondaryPoint 就在金标里漂着,只是恰好没改变候选集。
#    下次萃取噪声落在金标故事的 primary 上,293 会动,那时它会正确地 FAIL 并强制重钉——那正是我们要它做的。
#    **293 不是「永不动」,是「动了就该重钉」。** 与红线3 的构造性恒真(有效 n=1)不是一回事。
cand_in_gold = sum(len(st.get('candidates') or []) for st in gold_stories)
cand_total = sum(len(st.get('candidates') or []) for st in d['stories'])
for name, got, want in [('金标故事内候选数', cand_in_gold, BASE['candidates_in_gold_stories_assert'])]:
    if got != want:
        fails.append(f'{name}断言')
        report.append(f"❌ {name}断言: 实为 {got}, 基线声称 {want} —— 候选池规模已变,"
                      f"红线6(缺口计数)的语义随之漂移,先重钉再比较")
    else:
        report.append(f"{name}断言: {got} PASS")

# ── 候选集 digest 断言(红队放行条件2 的另一半:候选池上的保桶置换同型) ──────────
# 293(计数)看不见「换掉一条候选、总数不变」,digest 看得见。与 293 并存,不替换。
# ⚠️ 它「稳」的主语(不许犯坑⑯):六轮恒定的原因是金标40故事 primaryPoint 六轮全部恒定——
#    是实测运气不是构造性恒真(S051 的 secondary 就在漂,只是没改变候选集)。动了就该重钉,不是永不动。
_cand_lines = sorted((st['storyId'], c['questionId'])
                     for st in gold_stories for c in (st.get('candidates') or []))
_cand_digest = hashlib.sha256('\n'.join(f"{s}|{q}" for s, q in _cand_lines).encode()).hexdigest()[:16]
_cand_want = BASE['candidates_in_gold_stories_digest']
if _cand_digest != _cand_want:
    fails.append('候选集digest断言')
    report.append(f"❌ 金标故事内候选集 digest 不匹配: 实为 {_cand_digest}, 基线声称 {_cand_want} —— "
                  f"候选池成员已变(即使总数不变),红线6 语义随之漂移,先重钉再比较")
else:
    report.append(f"金标故事内候选集 digest 断言: {_cand_digest} PASS")

# ── 观察项 · 全量候选数 + 匹配点漂移(取代已删的 997 断言;零红线价值,有诊断价值) ──
# 它是萃取噪声地板 ±1.0pp 在重排导出里的可见痕迹。只打印,不 FAIL。
_ref = BASE.get('_观察_匹配点参照快照_轮1', {})
report.append(f"  ── 观察:全量候选与匹配点漂移(不作PASS/FAIL) ──")
report.append(f"    全量候选数: {cand_total}  [六轮实测 997/997/997/995/995/998,不设线]")
_drift = []
for st in d['stories']:
    p = (st.get('primaryPoint') or {}).get('code') or '-'
    s = (st.get('secondaryPoint') or {}).get('code') or '-'
    cur, base_v = f"{p}|{s}", _ref.get(st['storyId'])
    if base_v is not None and cur != base_v:
        _drift.append(f"{st['storyId']} {base_v}→{cur}{' [在金标40内]' if st['storyId'] in gold_map else ''}")
if _drift:
    report.append(f"    匹配点漂移 {len(_drift)} 个(参照=轮1 快照): {'; '.join(_drift)}")
    report.append(f"    ⚠️ S051/S097/S100 报出来是【已知噪声,不是新闻】;金标40内 primary 漂移才值得看")
else:
    report.append(f"    匹配点漂移: 无")

def score_of(c):
    return c.get('relevanceScore')

def visible(c):
    """尺子v3 + 产品不变式2:无分数→不展示。
    ⚠️ 历史坑:此处曾写 `(c.get('relevanceScore') or 100) < 40`——两个错叠在一起:
       (1) 旧线40(SCORE_LOW 早已删除);(2) `or 100` 是不变式2 明令禁止的 ?? 100 兜底,
       且 Python 的 or 比 ?? 更糟——score=0 会变成 100(实测三轮有 10/6/11 条 0 分候选)。
       后果:三轮真实 26/25/27 被算成 14/19/16,量的根本不是同一个东西。"""
    s = score_of(c)
    return s is not None and s >= SCORE_MID

# ── 红线4 · noMatch ──────────────────────────────────────────────────────────
check_max('红线4 noMatch', d['summary']['noMatch'], BASE['ranking_nomatch_max'])

# ── 红线1 · 召回率(分子:AI高∩金标高 的条目数;分母:金标高总数,金标定死) ──────
hit = [(st['storyId'], c['questionId']) for st in gold_stories for c in (st.get('candidates') or [])
       if (score_of(c) is not None and score_of(c) >= SCORE_HIGH)
       and gold_map[st['storyId']].get(c['questionId']) == '高']
check_min('红线1 召回率命中数', len(hit), BASE['ranking_recall_hit_min'],
          f"  [{len(hit)}/{gold_high_total} = {len(hit)/gold_high_total*100:.1f}%]")

# ── 红线2 · 首屏可用故事数 ───────────────────────────────────────────────────
usable = {s for s, _ in hit}
check_min('红线2 首屏可用故事数', len(usable), BASE['ranking_firstscreen_usable_min'],
          f"  [{len(usable)}/{len(gold_map)} = {len(usable)/len(gold_map)*100:.1f}%]")

# ── 红线3 · 金标未召回数(取代已废除的「召回精度」) ───────────────────────────
recalled = {(st['storyId'], c['questionId']) for st in gold_stories for c in (st.get('candidates') or [])}
not_recalled = [(s, q, b) for s, qs in gold_map.items() for q, b in qs.items() if (s, q) not in recalled]
check_max('红线3 金标未召回数', len(not_recalled), BASE['ranking_gold_not_recalled_max'])
for s, q, b in not_recalled[:10]:
    report.append(f"    ↳ 未召回 {s} {q[:8]} 金标={b}")

# ── 红线5 · 真丢【集合包含】(金标有高/中,却全部候选<60 → 用户看到空屏) ──────
# 2026-07-17 钉板:钉 true_loss ⊆ {S051},不钉计数。
#   · 不钉 ≤1:它允许【任意一个】故事变黑。S041(余量35)明天全黑 + S051 恢复可见 → 真丢仍=1 → PASS。
#     这是铁律①「总分回到基线 ≠ 修好了」的字面复现。
#   · 不钉 ≤0:轮3 当场 FAIL——用基线数据自己 FAIL 的红线不是红线。
#   · 集合包含:量子是【故事身份】不是数字;噪声误 FAIL 需安全故事最高分跌 ≥30,而实测最大波动 3 分(S061 95→92)。
#   ⚠️ 本条【无对冲】:S051/29391f1e 从 55 顶到 60(动5分)→ 真丢 1→0 且五条红线全 PASS,红线1 对此全瞎。
#      对冲待红线7(虚高计数)落地。详见 BASELINE.json 的 _红线5_真丢数 / _对冲说明_v3 ①。
empty = {st['storyId'] for st in gold_stories
         if (st.get('candidates') and not any(visible(c) for c in st['candidates']))}
true_loss = empty & has_hm
correct_empty = empty - has_hm
# 分母是 has_hm(11),不是金标故事数(40):40 个里 29 个一条高/中都没有,结构上不可能成为真丢。
# 量子 1/11 = 9.09pp,不是 1/40 = 2.5pp——后者看起来小 3.6 倍。
_allowed = set(BASE['ranking_true_loss_subset_of'])
_outliers = true_loss - _allowed
_ok = not _outliers
report.append(f"红线5 真丢集合: {sorted(true_loss)} (必须 ⊆ {sorted(_allowed)}) {'PASS' if _ok else 'FAIL'}"
              f"  [真丢{len(true_loss)}/{len(has_hm)} = {len(true_loss)/len(has_hm)*100:.2f}%"
              f" + 正确空屏{len(correct_empty)} = 可见0假空{len(empty)}/{len(gold_map)}]")
if not _ok:
    fails.append('红线5 真丢集合')
    report.append(f"    ❌ 越界故事(不在允许集内,与总数无关): {sorted(_outliers)}")
    for s in sorted(_outliers):
        st = next(x for x in gold_stories if x['storyId'] == s)
        top = max((score_of(c) for c in (st.get('candidates') or []) if score_of(c) is not None), default=None)
        hm = [q[:8] for q, b in gold_map[s].items() if b in ('高', '中')]
        report.append(f"    ↳ {s} 全部候选 <{SCORE_MID}(最高分 {top}),金标高/中: {hm} —— 用户看到空屏")
report.append(f"    ↳ 正确空屏 {len(correct_empty)} 个 —— 【不设线】。产品方修正2:『本值是题库供给缺口的计数器,"
              f"非质量目标。65%空态是已知产品事实(台账005),真实量级待内测L1回答。禁止把降低本值当优化目标"
              f"——降它最省事的办法是放宽阈值,那是刷分。』")

# ── 红线6 · 金标缺口项数(金标没标的新题冒进可见区) ───────────────────────────
gap = [(st['storyId'], c['questionId']) for st in gold_stories for c in (st.get('candidates') or [])
       if visible(c) and c['questionId'] not in gold_map[st['storyId']]]
check_max('红线6 金标缺口项数', len(gap), BASE['ranking_gold_gap_max'])
if gap:
    warns.append('金标缺口非零')
    report.append(f"    ⚠️ 缺口非零 → 该补标(告警口径已改为【非零即报】,取代旧的10%阈值):")
    for s, q in gap[:10]:
        report.append(f"    ↳ 可见未标 {s} {q[:8]}")

# ── 红线7A · 隐藏档冒进可见区(金标=隐藏 且 AI≥60 的【条目】集合,必须为空) ─────
# 一道「答非所问」的题冒进可见区 = 产品不变式 #1(不许骗)的直接违反。
# ⛔⛔ 产品方勾选『钉 ⊆ ∅:承认当前不合格,先修再钉』。
#     六轮实测 [∅,∅,∅,∅,{S074/f9119694},{S074/f9119694}] —— **轮5/轮6 会 FAIL,那是它的目的,不是 bug。**
#     在 S074/f9119694 被修好之前,回归会持续 FAIL —— **不许为了让它绿而放宽它。**
#     证据:AI 六轮理由高度一致(「故事未提广告」六轮都说了),分数摆了 55 分(轮1=25 / 轮5=75 / 轮6=65)。
#     轮5 自己写「需硬加广告才答」,然后给了 75。**这是标定不稳,不是判断不稳。**
# ⚠️ 诚实边界(设计官原话):『**余量只有 5 分,不是 30。我不借红线5 的论证壳子。**』
#     除 S074/f91 外,隐藏档 51 条每轮最高分 [40,35,40,55,40,40],六轮最高 55 → 距 60 线仅 5 分。
#     **误 FAIL 风险实测存在,不是零。** 接受它的理由与红线5 同(误FAIL 只触发复跑协议),但论证强度弱一个数量级。
# 刷分推演:想刷它 = 压低隐藏档 = 正是我们要的。**这条线不可刷。**
hidden_inf = [(st['storyId'], c['questionId']) for st in gold_stories for c in (st.get('candidates') or [])
              if visible(c) and gold_map[st['storyId']].get(c['questionId']) == '隐藏']
_hid_allowed = set(tuple(x.split('/')) for x in BASE['ranking_hidden_inflation_subset_of'])
_hid_got = {(s, q[:8]) for s, q in hidden_inf}
_hid_out = _hid_got - _hid_allowed
_hid_ok = not _hid_out
report.append(f"红线7A 隐藏档冒进可见区: {sorted('/'.join(x) for x in _hid_got)} "
              f"(必须 ⊆ {sorted('/'.join(x) for x in _hid_allowed) or '∅'}) {'PASS' if _hid_ok else 'FAIL'}")
if not _hid_ok:
    fails.append('红线7A 隐藏档冒进可见区')
    for s, q in sorted(hidden_inf):
        sc_ = next(score_of(c) for c in gold_stories_by_id[s]['candidates'] if c['questionId'] == q)
        report.append(f"    ❌ {s} {q[:8]} 金标=隐藏(答非所问) 却得 {sc_} 分 → 冒进可见区"
                      f" —— 违反产品不变式 #1(不许骗)")
    report.append(f"    ⚠️ 本条【当前基线自己 FAIL】是产品方明知并选择的:『承认当前不合格,先修再钉』。")
    report.append(f"       修的是 S074/f9119694 的标定,**不是这条红线**。不许放宽它来换绿。")

# ── 余量观察项(红队修改项4,不是红线) ────────────────────────────────────────
# 红线1 的「三轮集合恒等」是阶跃函数的输出,对阈值以上的连续漂移完全免疫。
if BASE.get('ranking_gold_high_margin_watch'):
    report.append("  ── 金标高余量观察(离85线的距离;不作PASS/FAIL) ──")
    for st in gold_stories:
        for q, b in gold_map[st['storyId']].items():
            if b != '高': continue
            m = [score_of(c) for c in (st.get('candidates') or []) if c['questionId'] == q]
            s = m[0] if m else None
            if s is None:
                report.append(f"    {st['storyId']} {q[:8]}  未召回/未打分  ❌"); continue
            margin = s - SCORE_HIGH
            flag = '  ⚠️ 贴线' if 0 <= margin <= 2 else ('  ❌ 未进高档' if margin < 0 else '')
            if flag: warns.append(f"余量 {st['storyId']}")
            report.append(f"    {st['storyId']} {q[:8]}  分数 {s}  余量 {margin:+d}{flag}")

# ── 观察项 · 虚高构成(设计官拒绝钉板,主会话接受;三样缺一则本条无意义) ────────
# 六轮 [6,6,8,8,11,7]:按 n=3 最坏值会钉 ≤8,而轮5 是 11 → 当场 FAIL。
# 累积并集 6→7→9→11→15→15,交集5/并集15/浮动10 —— **尖峰到达率未收敛。**
# 设计官原话:『**花掉的钱不是钉板的理由。这次复跑的价值不是「拿到了 n=6 可以钉了」,
#   是「证明了 n=6 还不够,而 n=3 时我们根本不知道这一点」。**』
# (3) 的理由:≥80 六轮恒 4,**极差 0 是假的** —— 3 条恒定 + 1 个轮换位(S096/S016/S044/S061/S096)。
#   『如果我不做构成核对,我会提「≥80 虚高六轮恒 4,钉 ≤4,极差 0,超稳」——那会是
#     首屏精确率 50.0/50.0/50.0 的字面复现,只是这次写提案的人是我。』
infl = sorted([(st['storyId'], c['questionId'][:8], score_of(c)) for st in gold_stories
               for c in (st.get('candidates') or [])
               if visible(c) and gold_map[st['storyId']].get(c['questionId']) in ('低', '隐藏')],
              key=lambda x: -x[2])
_hist = set(BASE.get('_观察_虚高历史并集_条目', []))
report.append("  ── 观察:虚高构成(🔴 不作PASS/FAIL —— 并集未收敛,不钉板) ──")
report.append(f"    (1) 虚高计数: {len(infl)}  [六轮实测 6/6/8/8/11/7,不设线]  构成:")
for s, q, sc_ in infl:
    report.append(f"        {s}/{q}  {sc_}分  金标={gold_map[s].get(next(k for k in gold_map[s] if k.startswith(q)))}")
_new = [f"{s}/{q}" for s, q, _ in infl if f"{s}/{q}" not in _hist]
report.append(f"    (2) 本轮新增(历史 {len(_hist)} 条并集里从未见过): {_new or '无'}"
              f"  ← 并集增长曲线的在线版,**是判断收敛的唯一途径**")
for cut in (80, 85):
    sub = [f"{s}/{q}({sc_})" for s, q, sc_ in infl if sc_ >= cut]
    report.append(f"    (3) ≥{cut} 虚高: {len(sub)} 条 —— 构成 {sub or '无'}"
                  f"  ⚠️ 极差 0/1 是假的(3恒定+1轮换),**必须看构成不看计数**")

# ── 观察指标(不作PASS/FAIL依据;修正3) ───────────────────────────────────────
f = sorted(glob.glob('scripts/eval/results/ranking-score-*.json'))
if f:
    g = json.load(open(f[-1])).get('gates', {})
    report.append("  ── 观察指标(🔴 分母由AI控制,不作PASS/FAIL —— 修正3) ──")
    for key, label in [('firstScreenPrecision', '首屏精确率'), ('falseHigh', '虚高率'),
                       ('visibleTierAccuracy', '可见区档位命中率')]:
        if key in g:
            n, dn = g[key].get('numer'), g[key].get('denom')
            # 红队修改项9:必须带分子/分母——聚合值掩盖了档位命中率分子 19→17→15(−21%)而分母仅 −3%
            pct = (n / dn * 100) if dn else float('nan')
            report.append(f"    {label}: {pct:.1f}%  [分子{n} / 分母{dn}]")

print('\n'.join(report))
if warns:
    print(f"\n⚠️ 观察项告警(不阻断): {sorted(set(warns))}")
if fails:
    print(f"\n❌ 回归FAIL: {fails} —— 打回修复,不许合并")
    if '红线7A 隐藏档冒进可见区' in fails:
        print("   ⛔ 红线7A 是【设计成 FAIL】的,不是基线定错了。产品方 2026-07-17 选择『承认当前不合格,先修再钉』。")
        print("      语义:一道『答非所问』的题冒进可见区 = 违反产品不变式 #1(不许骗)。")
        print("      **不许放宽它、不许复跑指望它变绿**——它绿的唯一方式是把 S074/f9119694 修好。")
        print("      下面那段『复跑复核』的提示【不适用于本条】。")
    print("   ⚠️ 若FAIL的是 ±0 红线(红线1/2/3/4):按产品方修正1,必须复跑一次 R=3 复核后才算 FAIL。")
    print("      『不得为此补任何未实测的容差——补一个没测过的 ±X 等于凭空发明噪声地板』(台账052)。")
    print("      ⚠️ 但复跑只防随机抖动,防不了单调漂移(红队洞2):复跑只会把FAIL确认一遍,")
    print("      然后诱导人认为『基线定错了』去松红线。先看上面的余量观察项与真丢构成。")
    sys.exit(1)
print("\n✅ 回归全部通过")
PYEOF
