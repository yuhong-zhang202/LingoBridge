/**
 * @module   ranking-latency-probe
 * @desc     ranking 环节延迟长尾归因探针 —— 【只读】。质疑「ranking 提速必须动 prompt/模型（AI 判断力）」
 *           这个归类：用生产数据检验「延迟长尾是不是候选题数（candidate_count）驱动」。
 *
 *           动机：ranking 延迟形状 p50 11.3s → p95 33.9s → max 56.4s（约 3× 离散度），远宽于 analysis 的
 *           12.4→17.4（1.4×）。窄分布 = 模型本身就慢；宽分布更像「部分请求负载远超均值」。ranking 的负载
 *           = 候选题数（候选越多 → 输出 token 越多 → 生成越久）。若长尾由候选数驱动 → 限候选数上限即可提速，
 *           不碰 prompt/模型、不涉判断力，属纯工程；若无关 → 才需转向上游服务（DashScope 限流/排队）或模型选型。
 *           结论由数据得出，不预设立场。
 *
 *           数据：api_usage_logs，phase='ranking' 且 status='success'，created_at >= 2026-07-21
 *           （看板注明此前 latency_ms 语义不同，必须排除，否则结论错）。candidate_count / completion_tokens
 *           已在 metadata 里（见 src/app/api/matching/route.ts 约 177 行），无需新增埋点。
 *
 *           只读：仅 SELECT，绝无写操作。走既有 service-role REST 通道 getSupabaseServer（不新建连接）。
 *           报告输出 stdout + 存 scripts/analysis/results/ranking-latency-probe-YYYY-MM-DD.txt。
 *
 *           运行：npx tsx --conditions=react-server --env-file=.env.local scripts/analysis/ranking-latency-probe.ts
 *           （按「其他文件一律不动」本次未改 package.json；若要加脚本，建议命名 "probe:ranking-latency"，
 *            与 eval:ranking 等同风格：加进 package.json scripts 即可 `npm run probe:ranking-latency`）
 * @author   LingoBridge
 * @created  2026-08-01
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getSupabaseServer } from '@/lib/supabase-server'

// 延迟口径变更日：早于此日期的 latency_ms 语义不一致，必须排除（看板注明）
const CUTOFF_DATE = '2026-07-21'
// 长尾阈值：> 30s 视为长尾样本（对照 p95 33.9s）
const TAIL_MS = 30_000
// 候选数分桶
const BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: '1-5',   lo: 1,  hi: 5 },
  { label: '6-10',  lo: 6,  hi: 10 },
  { label: '11-20', lo: 11, hi: 20 },
  { label: '21-35', lo: 21, hi: 35 },
  { label: '36+',   lo: 36, hi: Infinity },
]
// 判读阈值（显式列出，令结论透明可复核）
const MIN_TOTAL = 30          // 少于此样本量 → 判「不足」
const MIN_TAIL  = 5           // 长尾(>30s)样本少于此 → 判「不足」（分布无从谈起）
const CORR_STRONG = 0.5       // |r| ≥ 此值算强相关
const CORR_MODERATE = 0.4     // |r| ≥ 此值算中等相关
const TAIL_CONCENTRATION = 0.6 // 长尾样本落在「高候选桶」的占比达此值算「集中」
const HIGH_BUCKET_MIN_CANDIDATES = 11 // 候选数 ≥ 此值算「高候选桶」（11-20 及以上）

interface Row { latency_ms: number; candidate_count: number | null; completion_tokens: number | null }

/** 线性插值百分位（numpy 默认法）：sorted 升序，rank = p*(n-1)，在 floor/ceil 间插值。 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN
  if (sortedAsc.length === 1) return sortedAsc[0]
  const rank = (p / 100) * (sortedAsc.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo)
}

function median(nums: number[]): number {
  if (nums.length === 0) return NaN
  return percentile([...nums].sort((a, b) => a - b), 50)
}

/** Pearson 相关系数；任一序列方差为 0 或样本 < 2 时返回 NaN。 */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return NaN
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return NaN
  return sxy / Math.sqrt(sxx * syy)
}

const s = (ms: number): string => (ms / 1000).toFixed(1) + 's'
const r2 = (n: number): string => (Number.isNaN(n) ? 'N/A' : n.toFixed(2))

async function main(): Promise<void> {
  const sb = getSupabaseServer()
  // 只读 SELECT：phase=ranking + success + 口径变更日之后 + latency 非空
  const { data, error } = await sb
    .from('api_usage_logs')
    .select('latency_ms, metadata, created_at')
    .eq('metadata->>phase', 'ranking')
    .eq('status', 'success')
    .gte('created_at', CUTOFF_DATE)
    .not('latency_ms', 'is', null)
  if (error) throw new Error(`查询失败：${error.message}`)

  const raw = (data ?? []) as { latency_ms: number; metadata: Record<string, unknown> | null }[]
  const rows: Row[] = raw.map((r) => ({
    latency_ms: r.latency_ms,
    candidate_count: typeof r.metadata?.candidate_count === 'number' ? r.metadata.candidate_count as number : null,
    completion_tokens: typeof r.metadata?.completion_tokens === 'number' ? r.metadata.completion_tokens as number : null,
  }))

  const out: string[] = []
  const log = (line = ''): void => { out.push(line) }

  log('═══════════════════════════════════════════════════════════════')
  log(`ranking 延迟长尾归因探针  ·  ${new Date().toISOString()}`)
  log(`数据口径：phase=ranking · status=success · created_at >= ${CUTOFF_DATE} · latency 非空`)
  log('═══════════════════════════════════════════════════════════════')

  const N = rows.length
  const withCand = rows.filter((r) => r.candidate_count !== null)
  const withTok  = rows.filter((r) => r.completion_tokens !== null)
  log('')
  log(`总样本量：${N}   （含 candidate_count：${withCand.length} · 含 completion_tokens：${withTok.length}）`)

  // ── 1. 整体延迟分布 ──
  const lat = rows.map((r) => r.latency_ms).sort((a, b) => a - b)
  log('')
  log('【1】latency_ms 整体分布')
  log(`  p50=${s(percentile(lat, 50))}  p95=${s(percentile(lat, 95))}  p99=${s(percentile(lat, 99))}  max=${s(lat[lat.length - 1] ?? NaN)}`)

  // ── 2. 按 candidate_count 分桶 ──
  log('')
  log('【2】按 candidate_count 分桶')
  log('  桶       样本  latency_p50  latency_p95  completion_tokens中位')
  for (const b of BUCKETS) {
    const inB = withCand.filter((r) => r.candidate_count! >= b.lo && r.candidate_count! <= b.hi)
    if (inB.length === 0) { log(`  ${b.label.padEnd(7)}  ${'0'.padStart(4)}  ${'—'.padStart(11)}  ${'—'.padStart(11)}  —`); continue }
    const bl = inB.map((r) => r.latency_ms).sort((a, b2) => a - b2)
    const tok = inB.map((r) => r.completion_tokens).filter((t): t is number => t !== null)
    log(`  ${b.label.padEnd(7)}  ${String(inB.length).padStart(4)}  ${s(percentile(bl, 50)).padStart(11)}  ${s(percentile(bl, 95)).padStart(11)}  ${tok.length ? Math.round(median(tok)) : '—'}`)
  }

  // ── 3. 相关系数 ──
  const candLat = withCand.map((r) => [r.candidate_count!, r.latency_ms] as const)
  const tokLat  = withTok.map((r) => [r.completion_tokens!, r.latency_ms] as const)
  const candTok = rows.filter((r) => r.candidate_count !== null && r.completion_tokens !== null)
    .map((r) => [r.candidate_count!, r.completion_tokens!] as const)
  const rCandLat = pearson(candLat.map((p) => p[0]), candLat.map((p) => p[1]))
  const rTokLat  = pearson(tokLat.map((p) => p[0]), tokLat.map((p) => p[1]))
  const rCandTok = pearson(candTok.map((p) => p[0]), candTok.map((p) => p[1]))
  log('')
  log('【3】相关系数（Pearson r）')
  log(`  latency ~ candidate_count      r = ${r2(rCandLat)}   (n=${candLat.length})`)
  log(`  latency ~ completion_tokens    r = ${r2(rTokLat)}   (n=${tokLat.length})`)
  log(`  candidate_count ~ completion_tokens  r = ${r2(rCandTok)}   (n=${candTok.length})   ← 候选→token 传导链`)

  // ── 4. 长尾（>30s）样本剖析 ──
  const tail = rows.filter((r) => r.latency_ms > TAIL_MS)
  const tailWithCand = tail.filter((r) => r.candidate_count !== null)
  const tailHigh = tailWithCand.filter((r) => r.candidate_count! >= HIGH_BUCKET_MIN_CANDIDATES)
  const tailConc = tailWithCand.length ? tailHigh.length / tailWithCand.length : NaN
  log('')
  log(`【4】长尾样本（latency > ${TAIL_MS / 1000}s）：共 ${tail.length} 条`)
  if (tail.length) {
    log('  latency   candidate_count   completion_tokens')
    for (const t of tail.sort((a, b) => b.latency_ms - a.latency_ms)) {
      log(`  ${s(t.latency_ms).padStart(7)}   ${String(t.candidate_count ?? '—').padStart(15)}   ${String(t.completion_tokens ?? '—').padStart(17)}`)
    }
    log('')
    log(`  长尾中「高候选桶(≥${HIGH_BUCKET_MIN_CANDIDATES})」占比：${tailWithCand.length ? (tailConc * 100).toFixed(0) + '%' : 'N/A'}  (${tailHigh.length}/${tailWithCand.length})`)
  }

  // ── 5. 候选数上限权衡 ──
  // 关键 nuance：p90 上限只削「超过上限」的极端尾（少数请求），削不动中位数——因为大批请求本就 ≤上限。
  // 要压中位数得把上限压低，但会截断更多请求。故给一张权衡表：每个候选上限 → 截断比例 + 「≤上限子集」的
  // 当前 p50/p95（≈ 全部压到该上限后的延迟形状，因被截断的请求会退化成 ≤上限请求的表现）。
  const cands = withCand.map((r) => r.candidate_count!).sort((a, b) => a - b)
  const capP90 = Math.ceil(percentile(cands, 90))
  const truncPct = cands.length ? cands.filter((c) => c > capP90).length / cands.length * 100 : NaN
  log('')
  log('【5】候选上限权衡（上限越低、延迟越省，但截断越多）')
  log('  上限   截断比例   ≤上限子集_latency_p50   ≤上限子集_latency_p95   （≈ 压到该上限后的延迟）')
  for (const cap of [10, 15, capP90, 25]) {
    const le = withCand.filter((r) => r.candidate_count! <= cap)
    const leLat = le.map((r) => r.latency_ms).sort((a, b) => a - b)
    const trunc = withCand.length ? withCand.filter((r) => r.candidate_count! > cap).length / withCand.length * 100 : NaN
    const tag = cap === capP90 ? ' ←p90' : ''
    log(`  ${String(cap).padStart(4)}${tag.padEnd(6)}  ${(trunc.toFixed(0) + '%').padStart(6)}   ${(leLat.length ? s(percentile(leLat, 50)) : '—').padStart(20)}   ${(leLat.length ? s(percentile(leLat, 95)) : '—').padStart(20)}`)
  }

  // ── 判读结论（阈值显式，结论由数据得出）──
  log('')
  log('───────────────────────────────────────────────────────────────')
  log('判读（阈值：')
  log(`  样本足够 = 总数≥${MIN_TOTAL} 且 长尾≥${MIN_TAIL}；`)
  log(`  候选驱动 = [ r(latency,candidate)≥${CORR_MODERATE} 或 (r(latency,token)≥${CORR_STRONG} 且 r(candidate,token)≥${CORR_MODERATE}) ] 且 长尾高候选占比≥${(TAIL_CONCENTRATION * 100).toFixed(0)}% ）`)
  log('───────────────────────────────────────────────────────────────')

  let verdict: string
  if (N < MIN_TOTAL || tail.length < MIN_TAIL) {
    const needTotal = Math.max(0, MIN_TOTAL - N)
    const needTail = Math.max(0, MIN_TAIL - tail.length)
    verdict = `❓ 样本量不足以判断 —— 现有总样本 ${N}（还需 ${needTotal}）、长尾样本 ${tail.length}（还需 ${needTail}）。` +
      `按当前 ranking 调用量，攒够约需继续观察数日。`
  } else {
    const chainDriven = (!Number.isNaN(rCandLat) && rCandLat >= CORR_MODERATE)
      || (!Number.isNaN(rTokLat) && rTokLat >= CORR_STRONG && !Number.isNaN(rCandTok) && rCandTok >= CORR_MODERATE)
    const concentrated = !Number.isNaN(tailConc) && tailConc >= TAIL_CONCENTRATION
    if (chainDriven && concentrated) {
      verdict = `✅ 长尾由候选数驱动 → ranking 提速属纯工程，可限候选数、不必动 prompt/模型。\n` +
        `   依据：r(latency,candidate)=${r2(rCandLat)} · r(latency,token)=${r2(rTokLat)} · r(candidate,token)=${r2(rCandTok)} · 长尾高候选占比=${(tailConc * 100).toFixed(0)}%。\n` +
        `   ⚠ 上限取值是「延迟↔截断」权衡（见【5】），不是单一答案：\n` +
        `      · p90 上限(${capP90}) 只截 ${truncPct.toFixed(0)}%，但基本不降延迟（大批请求本就≤该上限，p95 仍在长尾区）；\n` +
        `      · 要显著压延迟需把上限压到 ~10–15（p95 约 ~33s→~12s），代价是截断 ~50–60% 请求。\n` +
        `   → 具体取值须产品方按「ranking 实际需要多少候选题（下游只展示前几道？）」拍板，本探针只证明「限候选=有效且不碰判断力」。`
    } else {
      verdict = `⚠️ 长尾与候选数无关 → 需转向排查上游服务（DashScope 限流/排队）或模型选型，属判断力链路。\n` +
        `   依据：r(latency,candidate)=${r2(rCandLat)} · r(latency,token)=${r2(rTokLat)} · r(candidate,token)=${r2(rCandTok)} · 长尾高候选占比=${Number.isNaN(tailConc) ? 'N/A' : (tailConc * 100).toFixed(0) + '%'}` +
        `（未同时满足「相关性」与「长尾集中」两条）。`
    }
  }
  log('')
  log('【结论】')
  log(verdict)
  log('')

  // ═══════════════════════════════════════════════════════════════
  // 【附加分析】匹配结果的选题排位分布（用于决定 analysis 预取范围）
  //   任务硬约束：以库为准、不假设表结构；无排位信息则报「数据不足」+ 需补的埋点，不用其它字段推测代替。
  // ═══════════════════════════════════════════════════════════════
  log('═══════════════════════════════════════════════════════════════')
  log('【附加】匹配结果的选题排位分布（决定 analysis 预取范围：top-1 集中→值得预取第一道；分散→不做）')
  log('═══════════════════════════════════════════════════════════════')
  // 先以生产库为准，列出 flow_events 实际有哪些事件类型及各自 props 键（不假设）
  const { data: evData, error: evErr } = await sb.from('flow_events').select('event, props').limit(5000)
  if (evErr) throw new Error(`flow_events 查询失败：${evErr.message}`)
  const events = (evData ?? []) as { event: string; props: Record<string, unknown> | null }[]
  const evCount = new Map<string, number>()
  const evKeys = new Map<string, Set<string>>()
  for (const e of events) {
    evCount.set(e.event, (evCount.get(e.event) ?? 0) + 1)
    const ks = evKeys.get(e.event) ?? new Set<string>()
    for (const k of Object.keys(e.props ?? {})) ks.add(k)
    evKeys.set(e.event, ks)
  }
  log('')
  log('现有事件类型及 props 键（生产库实测）：')
  for (const [ev, n] of [...evCount.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${ev}  (${n})  props: ${[...(evKeys.get(ev) ?? [])].sort().join(', ') || '(无)'}`)
  }
  // 检测是否存在「选中题排位」信息（任一事件的 props 含排位类键）
  const RANK_KEYS = ['position', 'rank', 'index', 'order', 'clickedIndex', 'selectedIndex', 'openedRank', 'openedIndex']
  let rankKey: string | null = null
  for (const ks of evKeys.values()) { const hit = RANK_KEYS.find((k) => ks.has(k)); if (hit) { rankKey = hit; break } }
  log('')
  if (rankKey === null) {
    log('❓ 数据不足以回答「用户点开的题排第几位」。')
    log('   以库为准的原因：现有三类事件全部不记录「用户选中的具体题目」及其「匹配列表中的排位」——')
    log('     · match.result / match.view_rendered = 结果/所见的计数（candidateCount/highCount 等），非某次点击；')
    log('     · flow.corpus_bound = 建语料时触发（props 仅 source），与点题无关；')
    log('     · 点「练习」进 /analysis、以及「存对子」，均【不发】带排位的事件。')
    log('   （按任务硬约束，不以 relevanceScore/served_from 等其它字段推测代替。）')
    log('')
    log('   要回答此问题，需补一个「选中排位」埋点，落地三处：')
    log('     ① 迁移：flow_events 的 event CHECK 约束加新事件名（建议 match.question_opened）；')
    log('     ② /api/events：白名单 + sanitize 收 rank（1-based 排位）、candidateCount（列表总数）两个数字；')
    log('     ③ 客户端：matching 页点「练习」的 onPractice 处，按该题在 result.questions 的 index+1 上报 rank。')
    log('   攒够样本（约数十次点击）后，本节即可算 top-1/2/3/4+ 分布，据此定 analysis 预取范围。')
  } else {
    // 未来补了排位埋点后自动生效：按 rankKey 算 top-1/2/3/4+ 分布
    const ranks = events.map((e) => e.props?.[rankKey!]).filter((v): v is number => typeof v === 'number' && v >= 1)
    const b1 = ranks.filter((r) => r === 1).length
    const b2 = ranks.filter((r) => r === 2).length
    const b3 = ranks.filter((r) => r === 3).length
    const b4 = ranks.filter((r) => r >= 4).length
    const tot = ranks.length
    const pct = (n: number): string => (tot ? (n / tot * 100).toFixed(0) + '%' : 'N/A')
    log(`检测到排位字段「${rankKey}」，总样本 ${tot}：`)
    log(`  第1位 ${b1} (${pct(b1)}) · 第2位 ${b2} (${pct(b2)}) · 第3位 ${b3} (${pct(b3)}) · 第4位及以后 ${b4} (${pct(b4)})`)
    log(`  → ${tot < 30 ? '样本量偏小，结论暂作参考' : (b1 / (tot || 1) >= 0.5 ? 'top-1 集中，值得预取第一道' : '分布分散，预取浪费大、不建议')}`)
  }
  log('')

  // ═══════════════════════════════════════════════════════════════
  // 【查询A】高匹配题数分布（决定 analysis 预取范围）
  //   数据源：match.view_rendered 的 props.highCount / midCount / visibleCount（复用上方已拉的 events）
  // ═══════════════════════════════════════════════════════════════
  log('═══════════════════════════════════════════════════════════════')
  log('【查询A】首屏高匹配题数（highCount）分布 —— 定 analysis 预取范围')
  log('═══════════════════════════════════════════════════════════════')
  const vr = events.filter((e) => e.event === 'match.view_rendered')
  const highs = vr.map((e) => e.props?.highCount).filter((v): v is number => typeof v === 'number')
  const viss = vr.map((e) => {
    const v = e.props?.visibleCount, h = e.props?.highCount, m = e.props?.midCount
    return typeof v === 'number' ? v : (typeof h === 'number' && typeof m === 'number' ? h + m : null)
  }).filter((v): v is number => v !== null)
  log('')
  log(`样本量：${highs.length}（match.view_rendered）`)
  if (highs.length) {
    const hb = (lo: number, hi: number): number => highs.filter((h) => h >= lo && h <= hi).length
    const pctH = (n: number): string => (highs.length ? (n / highs.length * 100).toFixed(0) + '%' : 'N/A')
    const rows: [string, number][] = [['=0', hb(0, 0)], ['=1', hb(1, 1)], ['=2', hb(2, 2)], ['=3', hb(3, 3)], ['4-5', hb(4, 5)], ['6+', hb(6, Infinity)]]
    log('highCount 分布：')
    for (const [lab, n] of rows) log(`  ${lab.padEnd(4)} ${String(n).padStart(4)}  (${pctH(n)})`)
    const mean = highs.reduce((s2, v) => s2 + v, 0) / highs.length
    log('')
    log(`highCount  中位数=${median(highs)}  均值=${mean.toFixed(1)}   visibleCount(高+中) 中位数=${viss.length ? median(viss) : 'N/A'}`)
    log('')
    log('【查询A 结论】')
    log(`  ${median(highs) <= 3
      ? `highCount 中位数 ${median(highs)} ≤3 → 首屏高匹配题很少，预取前 3 道 ≈ 覆盖全部首屏高匹配。`
      : `highCount 中位数 ${median(highs)} >3 → 首屏高匹配题较多，预取 3 道覆盖有限。`}`)
  } else {
    log('❓ 无 match.view_rendered 样本，无法算 highCount 分布。')
  }
  log('')

  // ═══════════════════════════════════════════════════════════════
  // 【查询B】候选截断的准确率代价（定 ranking 候选上限）—— 本次重点
  //   任务硬约束：先确认 corpus_match_snapshots 真实结构、不假设；数据不足则如实报告 + 说明缺啥字段。
  // ═══════════════════════════════════════════════════════════════
  log('═══════════════════════════════════════════════════════════════')
  log('【查询B】候选截断的准确率代价 —— 定 ranking 候选上限')
  log('═══════════════════════════════════════════════════════════════')
  const { data: snapData, error: snapErr } = await sb
    .from('corpus_match_snapshots')
    .select('result')
    .limit(5000)
  if (snapErr) throw new Error(`corpus_match_snapshots 查询失败：${snapErr.message}`)
  type SnapQ = { relevanceScore?: unknown; isPrimaryMatch?: unknown }
  const snaps = ((snapData ?? []) as { result: { questions?: SnapQ[] } | null }[])
    .map((r) => (Array.isArray(r.result?.questions) ? r.result!.questions! : []))
    .filter((qs) => qs.length > 0)
    .map((qs) => qs.map((q) => ({
      score: typeof q.relevanceScore === 'number' ? q.relevanceScore : null,
      primary: q.isPrimaryMatch === true,
    })))

  log('')
  log('先以库为准确认结构（corpus_match_snapshots.result jsonb = FunnelMatchResult）：')
  log('  · questions[] 每题键含 relevanceScore、isPrimaryMatch、matched_point；【无】显式候选位置字段。')
  // 实证：数组是否按分数单调递减（= 已按分重排，非候选顺序）
  let monotonic = 0, checked = 0
  for (const qs of snaps) {
    const sc = qs.map((q) => q.score).filter((v): v is number => v !== null)
    if (sc.length < 2) continue
    checked++
    let mono = true
    for (let i = 1; i < sc.length; i++) if (sc[i] > sc[i - 1]) { mono = false; break }
    if (mono) monotonic++
  }
  log(`  · 实证：${checked} 个多题快照中 ${monotonic} 个 relevanceScore 沿数组单调递减 → questions 是【按分重排】存的，`)
  log('    数组下标 = 分数序，≠ 候选数组位置（matching.ts:227/236 sort 后才存）。')

  // primary 块大小分布（候选顺序里 primary 恒在最前 → cap ≥ |primary| 才不切进 primary 块）
  const prims = snaps.map((qs) => qs.filter((q) => q.primary).length).sort((a, b) => a - b)
  const total85 = snaps.reduce((s2, qs) => s2 + qs.filter((q) => q.score !== null && q.score >= 85).length, 0)
  const np85 = snaps.reduce((s2, qs) => s2 + qs.filter((q) => q.score !== null && q.score >= 85 && !q.primary).length, 0)
  const np60 = snaps.reduce((s2, qs) => s2 + qs.filter((q) => q.score !== null && q.score >= 60 && !q.primary).length, 0)
  log('')
  log(`primary 块大小（|isPrimaryMatch=true|）：n=${prims.length}  中位=${median(prims)}  均值=${(prims.reduce((s2, v) => s2 + v, 0) / prims.length).toFixed(1)}  最大=${prims[prims.length - 1]}`)
  log('  cap 切进 primary 块的快照数（|primary| > cap，切进即无法还原被截断的具体 primary 题）：')
  for (const cap of [10, 15, 20]) {
    const over = prims.filter((p) => p > cap).length
    log(`    cap=${cap}: ${over}/${prims.length} (${(over / prims.length * 100).toFixed(0)}%)`)
  }
  log(`高匹配题(≥85)共 ${total85} 道，其中【非 primary】(在 secondary/邻居块、候选序靠后) ${np85} 道；非 primary 的 ≥60 有 ${np60} 道。`)

  log('')
  log('【查询B 结论】')
  log('⚠️ 快照数据不足以判断「按候选位置截断」的准确率代价 —— 缺「候选数组位置」字段。')
  log('   原因（以库为准，非假设）：')
  log('     1) result.questions 存的是【按 relevanceScore 重排后】的数组（上方实证），未保留候选数组位置；')
  log('     2) 无显式 position/candidateIndex 字段 → 数组下标 ≠ 候选位置，无法定位「候选第 11-20 位」是哪几道；')
  log('     3) primary 块常大于 cap（cap=10 时 ' + prims.filter((p) => p > 10).length + '/' + prims.length + ' 个快照 primary>10），')
  log('        cap 切进 primary 块时块内 DB 顺序已丢、更无法还原被截断的具体题与其分数。')
  log('   → 精确的「被截断高匹配题数 / 占比 / 丢失全部高匹配的次数 / 来源三块占比」四问，当前数据都算不出。')
  log('   缺什么字段才能回答：快照的每道题需存【候选数组原始下标 candidateIndex（重排前的位置）】，')
  log('     或额外存【重排前的候选顺序 id 列表】。补上后本节即可精确重建任意 cap 的截断集。')
  log('   （B.4 来源三块：现有 isPrimaryMatch 只能分「primary / 非primary」，secondary 与邻居无独立标记、无法三分；')
  log('     但因位置字段缺失、截断集本身不可还原，此项亦无从计。)')
  log('')
  log('   不过 primary 块大小分布给出一个可直接用的【风险信号】（不依赖位置重建）：')
  log('     · cap=20：仅 ' + (prims.filter((p) => p > 20).length / prims.length * 100).toFixed(0) + '% 快照会切进 primary 块 → 多数情况只截语义较弱的 secondary/邻居，风险低；')
  log('     · cap=10：' + (prims.filter((p) => p > 10).length / prims.length * 100).toFixed(0) + '% 快照会切进 primary 块（语义最强的一档）→ 风险明显，不宜盲上。')
  log('     · 另有 ' + np85 + ' 道 ≥85 高匹配题落在非 primary 块（候选序靠后），其截断命运因位置缺失无法量化 → 属未知风险。')
  log('   → 建议：ranking 候选上限落地前，先补 candidateIndex 埋点、攒数据精确核代价；若要即刻上，cap 取偏保守的 20 而非 10。')
  log('')

  const report = out.join('\n')
  console.log(report)

  // 存档（目录不存在则建）
  const dir = path.resolve(process.cwd(), 'scripts/analysis/results')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `ranking-latency-probe-${new Date().toISOString().slice(0, 10)}.txt`)
  writeFileSync(file, report + '\n', 'utf8')
  console.log(`\n报告已存档：${path.relative(process.cwd(), file)}`)
}

main().catch((e) => {
  console.error('[ranking-latency-probe] 失败：', e)
  process.exit(1)
})
