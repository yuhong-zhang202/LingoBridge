/**
 * @module   run-ranking-score
 * @desc     重排环节算分脚本 —— 读【重排金标 ranking.v1.json】+【run-ranking 导出的 JSON】，
 *           按「AI 档 × 金标档」推导 4 个上线闸门指标（首屏精确率 / 虚高率 / 可见区档位命中率 / 埋没率）
 *           + 参考指标（4×4 混淆矩阵 / NDCG@5 / Kendall τ / 稳定性）+ 诊断（虚高榜·埋没榜·分观察点·
 *           金标未召回项·金标缺口项）。纯离线计算，不调网络、不跑链路。
 *           运行：npm run eval:ranking:score -- --export=results/ranking-XXX.json [--gold=...] [--k=5]
 *                多轮稳定性：--export=a.json,b.json,c.json（首个用于闸门指标，≥2 个才算稳定性）
 *           底层：npx tsx scripts/eval/run-ranking-score.ts
 * @author   LingoBridge
 * @created  2026-07-15
 *
 * 口径（务必对照第 2 节指标体系）：
 *   AI 档由分数映射：≥85 高 / ≥60 中 / ≥40 低 / <40 隐藏 / null 未打分(unscored，重排降级)。
 *   金标档为人工四档：高/中/低/隐藏。所有指标只在「金标有标 且 本轮召回到 且 已打分」的对上计算；
 *   unscored 对（重排降级）一律排除出四闸门，单列计数。仅 countInAccuracy=true 的故事进闸门；域外条只出诊断。
 *   四闸门定义：
 *     1) 首屏精确率  = |AI高 ∩ 金标高| / |AI高|
 *     2) 虚高率      = |AI高 ∩ 金标∈{低,隐藏}| / |AI高|
 *     3) 可见档位命中 = |AI∈{高,中,低} 且 AI档==金标档| / |AI∈{高,中,低}|
 *     4) 埋没率      = |金标高 ∩ AI隐藏| / |金标高（已召回已打分）|
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { SCORE_HIGH, SCORE_MID, SCORE_LOW } from '@/lib/constants'

// ── 类型 ──────────────────────────────────────────────────────────────────────

type Tier = '高' | '中' | '低' | '隐藏'
type AiTier = Tier | 'unscored'
const TIERS: Tier[] = ['高', '中', '低', '隐藏']
/** NDCG 分级相关：高3/中2/低1/隐藏0 */
const GRADE: Record<Tier, number> = { 高: 3, 中: 2, 低: 1, 隐藏: 0 }

/** 标注归属区：visible=可见区全标(权重1)；hidden_sampled=隐藏区1/5抽样(算分时按抽样率还原) */
type Zone = 'visible' | 'hidden_sampled'

/** 金标：一条故事对若干候选题的档位标注 */
interface GoldLabel { questionId: string; goldBucket: Tier; zone: Zone; note?: string }
interface GoldStory { storyId: string; countInAccuracy: boolean; labels: GoldLabel[] }
interface GoldSet {
  version: string
  bucketRubric?: string
  hiddenSampleRate?: number   // 隐藏区抽样率(如 0.2)；算分优先用数据实测 S，此值仅交叉校验/留档
  annotator?: string
  annotatedAt?: string
  items: GoldStory[]
}

/** run-ranking 导出的候选题（子集，只取算分要用的字段） */
interface CandidateExport {
  questionId: string
  part: 1 | 2 | 3
  questionEn: string
  questionZh: string
  pointName: string
  relevanceScore: number | null
  relevanceReason: string | null
}
interface StoryResult {
  storyId: string
  isOutOfScope: boolean
  noMatch: boolean
  candidates: CandidateExport[]
}
interface RankingExport {
  version: string
  stories: StoryResult[]
}

interface CliOptions {
  exports: string[]        // 一或多份导出 JSON 路径（首个用于闸门指标）
  goldPath: string
  k: number                // NDCG@K 的 K
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_GOLD = join(__dirname, 'golden', 'ranking.v1.json')
const RESULTS_DIR = join(__dirname, 'results')
/** 金标缺口率超此值即预警（可见候选中无金标标注的占比过高 → 覆盖衰减，该补标了） */
const GAP_WARN_RATIO = 0.10

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliOptions {
  let exports: string[] = []
  let goldPath = DEFAULT_GOLD
  let k = 5
  for (const arg of argv) {
    if (arg.startsWith('--export=')) {
      exports = arg.slice('--export='.length).split(',').map((s) => s.trim()).filter((s) => s !== '')
    } else if (arg.startsWith('--gold=')) {
      goldPath = arg.slice('--gold='.length).trim()
    } else if (arg.startsWith('--k=')) {
      const n = Number.parseInt(arg.slice('--k='.length), 10)
      if (!Number.isFinite(n) || n < 1) throw new Error(`--k 需为 ≥1 的整数，收到：${arg}`)
      k = n
    } else {
      throw new Error(`未知参数：${arg}（支持 --export=a.json[,b.json] / --gold=path / --k=N）`)
    }
  }
  if (exports.length === 0) throw new Error('缺少 --export=<导出JSON路径>（可逗号分隔多份用于稳定性）')
  return { exports, goldPath, k }
}

/** 文件名安全时间戳 */
function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** 分数 → AI 档（null 记 unscored=重排降级） */
function aiTierOf(score: number | null): AiTier {
  if (score === null) return 'unscored'
  if (score >= SCORE_HIGH) return '高'
  if (score >= SCORE_MID) return '中'
  if (score >= SCORE_LOW) return '低'
  return '隐藏'
}

/** 百分比展示；分母 0 → '—' */
function pct(numer: number, denom: number): string {
  if (denom === 0) return '—'
  return `${((numer / denom) * 100).toFixed(1)}%（${numer}/${denom}）`
}

/** 埋没率展示：还原点估计 + Wilson 95% CI；标注不足则给提示 */
function burialStr(b: { point: number | null; lo: number | null; hi: number | null; rawSampledBuried: number; hiddenLabeled: number; scale: number | null; unestimable: boolean }): string {
  if (b.unestimable) return '⚠ 无法估计（有隐藏候选却无隐藏区标注，需补标）'
  if (b.point === null) return '—'
  const p = (x: number) => `${(x * 100).toFixed(1)}%`
  const ci = b.lo !== null && b.hi !== null ? `，95%CI [${p(b.lo)}, ${p(b.hi)}]` : ''
  const restore = b.scale && b.scale !== 1 ? `，隐藏区×${b.scale.toFixed(1)}还原(样本埋没 ${b.rawSampledBuried}/${b.hiddenLabeled})` : ''
  return `${p(b.point)}${ci}${restore}`
}

/** Markdown 单元格安全化 */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
}

// ── 对齐：金标 × 导出 ───────────────────────────────────────────────────────────

/** 一条对齐后的「金标—AI」配对（金标有标、且本轮召回到） */
interface Pair {
  storyId: string
  isOutOfScope: boolean
  questionId: string
  pointName: string
  questionZh: string
  reason: string | null
  score: number | null
  ai: AiTier
  gold: Tier
  zone: Zone      // 标注归属区，决定还原权重
}

interface AlignResult {
  pairs: Pair[]                 // 金标有 & 本轮召回到（含 unscored）
  goldNotRecalled: { storyId: string; questionId: string; goldBucket: Tier }[]  // 金标有、本轮没召回
  goldGapVisible: { storyId: string; questionId: string; questionZh: string; score: number }[] // 召回可见、金标没标
  storiesGoldMissing: string[]  // 金标有该故事、但导出里没有（故事本身 error/未跑）
}

/**
 * 把首份导出与金标对齐，产出配对 + 三类诊断项。
 * @param gold    金标集
 * @param exp     首份导出（用于闸门指标）
 */
function align(gold: GoldSet, exp: RankingExport): AlignResult {
  const storyById = new Map(exp.stories.map((s) => [s.storyId, s]))
  const pairs: Pair[] = []
  const goldNotRecalled: AlignResult['goldNotRecalled'] = []
  const goldGapVisible: AlignResult['goldGapVisible'] = []
  const storiesGoldMissing: string[] = []

  for (const gs of gold.items) {
    const story = storyById.get(gs.storyId)
    if (!story) { storiesGoldMissing.push(gs.storyId); continue }

    const candById = new Map(story.candidates.map((c) => [c.questionId, c]))
    const labeledIds = new Set(gs.labels.map((l) => l.questionId))

    // 金标每条标注 → 找导出候选
    for (const lb of gs.labels) {
      const c = candById.get(lb.questionId)
      if (!c) { goldNotRecalled.push({ storyId: gs.storyId, questionId: lb.questionId, goldBucket: lb.goldBucket }); continue }
      // zone 以金标记录为准（=标注当轮的抽样归属）；缺失则按当前分数兜底推断，并保证与 AI 隐藏定义一致
      const zone: Zone = lb.zone ?? (c.relevanceScore !== null && c.relevanceScore < SCORE_LOW ? 'hidden_sampled' : 'visible')
      pairs.push({
        storyId: gs.storyId,
        isOutOfScope: story.isOutOfScope,
        questionId: lb.questionId,
        pointName: c.pointName,
        questionZh: c.questionZh,
        reason: c.relevanceReason,
        score: c.relevanceScore,
        ai: aiTierOf(c.relevanceScore),
        gold: lb.goldBucket,
        zone,
      })
    }

    // 导出里「可见（≥SCORE_LOW 或 unscored）却没金标」的候选 → 缺口，提示补标
    for (const c of story.candidates) {
      if (labeledIds.has(c.questionId)) continue
      const visible = c.relevanceScore === null || c.relevanceScore >= SCORE_LOW
      if (visible) {
        goldGapVisible.push({
          storyId: gs.storyId,
          questionId: c.questionId,
          questionZh: c.questionZh,
          score: c.relevanceScore ?? -1,
        })
      }
    }
  }

  return { pairs, goldNotRecalled, goldGapVisible, storiesGoldMissing }
}

// ── 闸门 + 参考指标 ─────────────────────────────────────────────────────────────

/**
 * 埋没率（抽样加权还原）。隐藏区仅 1/S 标注，直接计数会把埋没系统性低估约 S 倍，故按抽样率还原。
 * 还原口径：把「隐藏区已标」样本外推到「隐藏区全体」。用数据实测 S = 隐藏候选总数 / 隐藏已标数，
 * 不写死 ×5，稳健于实际标注量偏差。埋没率 = N_hidden·p̂ /（V_goldHigh + N_hidden·p̂），
 * p̂ = 隐藏样本中埋没(金标高)占比。CI 由 Wilson 区间 [pL,pU] 单调映射得来。
 */
interface Burial {
  point: number | null      // 还原后埋没率点估计
  lo: number | null         // 95% CI 下界
  hi: number | null         // 95% CI 上界
  rawSampledBuried: number  // 隐藏样本里实测埋没数 k
  hiddenLabeled: number     // 隐藏区已标总数 n（Wilson 的分母）
  hiddenTotal: number       // 隐藏区候选总数 N_hidden（来自导出，全量已知）
  visibleGoldHigh: number   // 可见区金标高数 V（权重1，全标）
  scale: number | null      // 实测还原倍数 S = N_hidden / n
  unestimable: boolean      // 有隐藏候选却无隐藏标注 → 无法估计埋没，需补标
}

interface Gates {
  firstScreenPrecision: { numer: number; denom: number }  // 首屏精确率（全落可见区，不受抽样影响）
  falseHigh: { numer: number; denom: number }             // 虚高率（同上，不受抽样影响）
  visibleTierAccuracy: { numer: number; denom: number }   // 可见区档位命中率（同上，不受抽样影响）
  burial: Burial                                          // 埋没率（抽样加权还原 + CI）
  unscoredExcluded: number                                 // 因降级(unscored)被排除的对数
}

/** Wilson 得分区间（比例的 95% CI，小样本稳健）；n=0 → [0,0] */
function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0]
  const p = k / n
  const d = 1 + (z * z) / n
  const center = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, center - half), Math.min(1, center + half)]
}

/** 埋没率映射：给定「隐藏区埋没占比 p」，还原为埋没率 = N·p /（V + N·p），对 p 单调增 */
function burialRate(p: number, nHidden: number, vGoldHigh: number): number {
  const est = nHidden * p
  const denom = vGoldHigh + est
  return denom === 0 ? 0 : est / denom
}

/**
 * 只在「计入准确率 & 已打分」的对上算四闸门。
 * @param pairs      对齐后的配对
 * @param hiddenTotal 计入闸门的故事里，隐藏区候选总数 N_hidden（来自导出，全量已知）
 */
function computeGates(pairs: Pair[], hiddenTotal: number): Gates {
  const inGate = pairs.filter((p) => !p.isOutOfScope)
  const scored = inGate.filter((p) => p.ai !== 'unscored')
  const unscoredExcluded = inGate.length - scored.length

  const aiHigh = scored.filter((p) => p.ai === '高')
  const aiVisible = scored.filter((p) => p.ai === '高' || p.ai === '中' || p.ai === '低')

  // 埋没率：只受隐藏区抽样影响，须加权还原。
  const hiddenLabeled = scored.filter((p) => p.zone === 'hidden_sampled')
  const sampledBuried = hiddenLabeled.filter((p) => p.gold === '高')   // 隐藏样本里的埋没（金标高）
  const visibleGoldHigh = scored.filter((p) => p.zone === 'visible' && p.gold === '高').length
  const n = hiddenLabeled.length
  const k = sampledBuried.length
  const scale = n > 0 ? hiddenTotal / n : null
  const unestimable = hiddenTotal > 0 && n === 0

  let burial: Burial
  if (hiddenTotal === 0) {
    // 无隐藏候选：埋没率必为 0（金标高全在可见区），精确无需还原
    burial = { point: visibleGoldHigh === 0 ? null : 0, lo: 0, hi: 0, rawSampledBuried: 0, hiddenLabeled: 0, hiddenTotal: 0, visibleGoldHigh, scale: 1, unestimable: false }
  } else if (unestimable) {
    burial = { point: null, lo: null, hi: null, rawSampledBuried: 0, hiddenLabeled: 0, hiddenTotal, visibleGoldHigh, scale: null, unestimable: true }
  } else {
    const pHat = k / n
    const [pL, pU] = wilson(k, n)
    burial = {
      point: burialRate(pHat, hiddenTotal, visibleGoldHigh),
      lo: burialRate(pL, hiddenTotal, visibleGoldHigh),
      hi: burialRate(pU, hiddenTotal, visibleGoldHigh),
      rawSampledBuried: k,
      hiddenLabeled: n,
      hiddenTotal,
      visibleGoldHigh,
      scale,
      unestimable: false,
    }
  }

  return {
    firstScreenPrecision: {
      numer: aiHigh.filter((p) => p.gold === '高').length,
      denom: aiHigh.length,
    },
    falseHigh: {
      numer: aiHigh.filter((p) => p.gold === '低' || p.gold === '隐藏').length,
      denom: aiHigh.length,
    },
    visibleTierAccuracy: {
      numer: aiVisible.filter((p) => p.ai === (p.gold as AiTier)).length,
      denom: aiVisible.length,
    },
    burial,
    unscoredExcluded,
  }
}

/**
 * 4×4 混淆矩阵（抽样加权还原）：行=AI 档，列=金标档。
 * 高/中/低 三行全落可见区（权重1，整数）；隐藏行整行来自隐藏区抽样，按 S 还原（结果为估计值，非整数）。
 * @param scale 隐藏行还原倍数 S；null（无隐藏标注）则隐藏行按原始计数、并在报告注明不可靠。
 */
function confusionMatrix(pairs: Pair[], scale: number | null): Record<Tier, Record<Tier, number>> {
  const m = {} as Record<Tier, Record<Tier, number>>
  for (const r of TIERS) { m[r] = {} as Record<Tier, number>; for (const c of TIERS) m[r][c] = 0 }
  for (const p of pairs) {
    if (p.isOutOfScope || p.ai === 'unscored') continue
    const w = p.zone === 'hidden_sampled' ? (scale ?? 1) : 1
    m[p.ai as Tier][p.gold] += w
  }
  // 隐藏行还原后取整展示（估计值）
  for (const c of TIERS) m['隐藏'][c] = Math.round(m['隐藏'][c])
  return m
}

/** NDCG@K（参考）：AI 分数降序为预测序，金标档为分级相关；按故事宏平均，仅算有≥1标注的故事 */
function ndcgAtK(pairs: Pair[], k: number): { value: number | null; storiesCounted: number } {
  const byStory = new Map<string, Pair[]>()
  for (const p of pairs) {
    if (p.isOutOfScope || p.ai === 'unscored') continue
    if (!byStory.has(p.storyId)) byStory.set(p.storyId, [])
    byStory.get(p.storyId)!.push(p)
  }
  let sum = 0
  let count = 0
  for (const [, ps] of byStory) {
    const byAi = [...ps].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    const dcg = byAi.slice(0, k).reduce((acc, p, i) => acc + GRADE[p.gold] / Math.log2(i + 2), 0)
    const ideal = [...ps].sort((a, b) => GRADE[b.gold] - GRADE[a.gold])
    const idcg = ideal.slice(0, k).reduce((acc, p, i) => acc + GRADE[p.gold] / Math.log2(i + 2), 0)
    if (idcg > 0) { sum += dcg / idcg; count++ }
  }
  return { value: count > 0 ? sum / count : null, storiesCounted: count }
}

/** Kendall τ（参考，忽略并列）：每故事内 AI 分数 vs 金标档 的秩一致，宏平均 */
function kendallTau(pairs: Pair[]): { value: number | null; storiesCounted: number } {
  const byStory = new Map<string, Pair[]>()
  for (const p of pairs) {
    if (p.isOutOfScope || p.ai === 'unscored') continue
    if (!byStory.has(p.storyId)) byStory.set(p.storyId, [])
    byStory.get(p.storyId)!.push(p)
  }
  let sum = 0
  let count = 0
  for (const [, ps] of byStory) {
    if (ps.length < 2) continue
    let concordant = 0
    let discordant = 0
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const ds = (ps[i].score ?? -1) - (ps[j].score ?? -1)
        const dg = GRADE[ps[i].gold] - GRADE[ps[j].gold]
        if (ds === 0 || dg === 0) continue  // 并列不计
        if (Math.sign(ds) === Math.sign(dg)) concordant++
        else discordant++
      }
    }
    const denom = concordant + discordant
    if (denom > 0) { sum += (concordant - discordant) / denom; count++ }
  }
  return { value: count > 0 ? sum / count : null, storiesCounted: count }
}

/** 稳定性（参考）：对多份导出，取「金标有标 & 每份都召回到 & 每份都打分」的对，看 AI 档跨轮是否全一致 */
function stability(gold: GoldSet, exps: RankingExport[]): { value: number | null; agreed: number; total: number } {
  if (exps.length < 2) return { value: null, agreed: 0, total: 0 }
  const goldPairs: { storyId: string; questionId: string }[] = []
  for (const gs of gold.items) if (gs.countInAccuracy) for (const l of gs.labels) goldPairs.push({ storyId: gs.storyId, questionId: l.questionId })

  const tierIn = (exp: RankingExport, storyId: string, qid: string): AiTier | null => {
    const s = exp.stories.find((x) => x.storyId === storyId)
    const c = s?.candidates.find((x) => x.questionId === qid)
    if (!c) return null
    return aiTierOf(c.relevanceScore)
  }

  let agreed = 0
  let total = 0
  for (const gp of goldPairs) {
    const tiers = exps.map((e) => tierIn(e, gp.storyId, gp.questionId))
    if (tiers.some((t) => t === null || t === 'unscored')) continue  // 任一轮缺失/降级则跳过
    total++
    if (tiers.every((t) => t === tiers[0])) agreed++
  }
  return { value: total > 0 ? agreed / total : null, agreed, total }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────────

function main(): void {
  const opts = parseArgs(process.argv.slice(2))
  const gold = JSON.parse(readFileSync(opts.goldPath, 'utf-8')) as GoldSet
  const exps = opts.exports.map((p) => JSON.parse(readFileSync(p, 'utf-8')) as RankingExport)
  const primary = exps[0]

  const aligned = align(gold, primary)

  // 隐藏区候选总数 N_hidden（计入闸门的故事，来自导出，全量已知）——埋没率还原的分母基。
  const gateStoryIds = new Set(gold.items.filter((g) => g.countInAccuracy).map((g) => g.storyId))
  let hiddenTotal = 0
  for (const s of primary.stories) {
    if (!gateStoryIds.has(s.storyId)) continue
    for (const c of s.candidates) if (c.relevanceScore !== null && c.relevanceScore < SCORE_LOW) hiddenTotal++
  }

  const gates = computeGates(aligned.pairs, hiddenTotal)
  const matrix = confusionMatrix(aligned.pairs, gates.burial.scale)
  const ndcg = ndcgAtK(aligned.pairs, opts.k)
  const tau = kendallTau(aligned.pairs)
  const stab = stability(gold, exps)

  // 金标缺口率：可见候选中无金标标注的占比
  const visiblePaired = aligned.pairs.filter((p) => !p.isOutOfScope && (p.ai === '高' || p.ai === '中' || p.ai === '低')).length
  const gapVisibleInGate = aligned.goldGapVisible.length
  const gapDenom = visiblePaired + gapVisibleInGate
  const gapRatio = gapDenom > 0 ? gapVisibleInGate / gapDenom : 0
  const gapWarn = gapRatio > GAP_WARN_RATIO

  const report = buildReport(gold, opts, aligned, gates, matrix, ndcg, tau, stab, { gapRatio, gapWarn, gapDenom })

  mkdirSync(RESULTS_DIR, { recursive: true })
  const stamp = fileStamp()
  const jsonPath = join(RESULTS_DIR, `ranking-score-${stamp}.json`)
  const mdPath = join(RESULTS_DIR, `ranking-score-${stamp}-报告.md`)
  writeFileSync(jsonPath, JSON.stringify(report.json, null, 2), 'utf-8')
  writeFileSync(mdPath, report.md, 'utf-8')

  console.log(report.console)
  console.log(`\nJSON:  ${jsonPath}`)
  console.log(`报告:  ${mdPath}`)
}

// ── 报告构建 ────────────────────────────────────────────────────────────────────

interface GapInfo { gapRatio: number; gapWarn: boolean; gapDenom: number }

function buildReport(
  gold: GoldSet,
  opts: CliOptions,
  aligned: AlignResult,
  gates: Gates,
  matrix: Record<Tier, Record<Tier, number>>,
  ndcg: { value: number | null; storiesCounted: number },
  tau: { value: number | null; storiesCounted: number },
  stab: { value: number | null; agreed: number; total: number },
  gap: GapInfo,
): { json: unknown; md: string; console: string } {
  const g = gates
  const ndcgStr = ndcg.value === null ? '—' : ndcg.value.toFixed(3)
  const tauStr = tau.value === null ? '—' : tau.value.toFixed(3)
  const stabStr = stab.value === null ? '—（需 ≥2 份导出）' : `${(stab.value * 100).toFixed(1)}%（${stab.agreed}/${stab.total}）`

  // ── 控制台摘要 ──
  const con: string[] = []
  con.push('## 重排算分 · 摘要')
  con.push(`- 金标：${gold.version}｜导出：${opts.exports.length} 份（首个用于闸门）`)
  con.push('')
  con.push('### 四闸门（主线）')
  con.push(`- 首屏精确率      ：${pct(g.firstScreenPrecision.numer, g.firstScreenPrecision.denom)}   目标 ≥90%`)
  con.push(`- 虚高率          ：${pct(g.falseHigh.numer, g.falseHigh.denom)}   目标 ≤5%`)
  con.push(`- 可见区档位命中率：${pct(g.visibleTierAccuracy.numer, g.visibleTierAccuracy.denom)}   目标 ≥85%`)
  con.push(`- 埋没率          ：${burialStr(g.burial)}   目标 ≤5%（隐藏区抽样加权，CI 宽，仅看趋势）`)
  con.push('')
  con.push('### 参考')
  con.push(`- NDCG@${opts.k}：${ndcgStr}（${ndcg.storiesCounted} 故事）｜Kendall τ：${tauStr}｜稳定性：${stabStr}`)
  con.push(`- 因重排降级(unscored)排除：${g.unscoredExcluded} 对`)
  con.push('')
  con.push('### 金标覆盖（A 端到端固有：上游变动会衰减）')
  con.push(`- 金标未召回项：${aligned.goldNotRecalled.length}｜金标缺口项(可见未标)：${aligned.goldGapVisible.length}｜缺口率：${(gap.gapRatio * 100).toFixed(1)}%`)
  if (gap.gapWarn) con.push(`  ⚠ 缺口率 > ${(GAP_WARN_RATIO * 100).toFixed(0)}%：金标覆盖衰减，请按本轮导出补标缺口项后重算。`)
  if (aligned.storiesGoldMissing.length > 0) con.push(`- ⚠ 金标有、导出缺的故事（error/未跑）：${aligned.storiesGoldMissing.join(', ')}`)

  // ── Markdown 报告 ──
  const md: string[] = []
  md.push('# 重排环节 · 算分报告')
  md.push('')
  md.push(`- 金标：\`${gold.version}\``)
  md.push(`- 导出：${opts.exports.map((p) => `\`${p}\``).join(' , ')}`)
  md.push('')
  md.push('## 一、四闸门（决定上不上线）')
  md.push('')
  md.push('| 闸门 | 结果 | 目标(占位) | 口径 |')
  md.push('|---|---|---|---|')
  md.push(`| 首屏精确率 | ${pct(g.firstScreenPrecision.numer, g.firstScreenPrecision.denom)} | ≥90% | AI高∩金标高 / AI高 |`)
  md.push(`| 虚高率 | ${pct(g.falseHigh.numer, g.falseHigh.denom)} | ≤5% | AI高∩金标≤低 / AI高 |`)
  md.push(`| 可见区档位命中率 | ${pct(g.visibleTierAccuracy.numer, g.visibleTierAccuracy.denom)} | ≥85% | AI∈{高中低}且档==金标 / AI∈{高中低} |`)
  md.push(`| 埋没率 | ${burialStr(g.burial)} | ≤5% | 金标高∩AI隐藏 / 金标高(已召回已打分) |`)
  md.push('')
  md.push('> **抽样自查（哪些指标受隐藏区 1/5 抽样影响）**：首屏精确率 / 虚高率 / 可见区档位命中率——分子分母**全落可见区**（AI≥40，100% 标注），**不受抽样影响**，是精确值。')
  md.push('> **埋没率**——分子（金标高∩AI隐藏）与分母的隐藏部分都在隐藏区，已按 `隐藏候选总数/隐藏已标数` **加权还原** 并给 Wilson 95% CI；**该 CI 偏宽，仅看趋势**，逼近闸门线时需按下节升级为全标确认。')
  md.push(`> **混淆矩阵隐藏行**——同受影响，已按同一 S 还原（估计值，非整数计数）。因重排降级（unscored，分数 null）排除出闸门的对：${g.unscoredExcluded}。域外条不入闸门。`)
  md.push('')

  md.push('## 二、参考指标（看趋势，非门槛）')
  md.push('')
  md.push(`- NDCG@${opts.k}（AI序 vs 金标分级，宏平均）：**${ndcgStr}**（${ndcg.storiesCounted} 故事）`)
  md.push(`- Kendall τ（每故事内秩一致，宏平均）：**${tauStr}**（${tau.storiesCounted} 故事）`)
  md.push(`- 稳定性（跨 ${opts.exports.length} 轮档位全一致）：**${stabStr}**`)
  md.push('')
  md.push('> NDCG / τ 仅用**已标候选**（可见区全 + 隐藏区 1/5），隐藏区不全，故为**近似**，未做加权还原（排序类指标加权无良定义）；参考定位，只看趋势。')
  md.push('')
  md.push('### 4×4 档位混淆矩阵（行=AI 档，列=金标档）')
  md.push('')
  md.push(`| AI＼金标 | ${TIERS.join(' | ')} |`)
  md.push(`|---|${TIERS.map(() => '---').join('|')}|`)
  for (const r of TIERS) md.push(`| **${r}**${r === '隐藏' ? '※' : ''} | ${TIERS.map((c) => matrix[r][c]).join(' | ')} |`)
  md.push('')
  md.push('> 对角线=判对；右上（AI 高于金标）=偏高倾向（虚高源）；左下（AI 低于金标）=偏低倾向（埋没源）。')
  md.push('> ※ 隐藏行为**抽样加权还原后的估计值**（非整数计数），CI 宽；高/中/低三行为可见区精确计数。')
  md.push('')

  md.push('## 三、诊断')
  md.push('')
  // 虚高榜
  const falseHighList = aligned.pairs
    .filter((p) => !p.isOutOfScope && p.ai === '高' && (p.gold === '低' || p.gold === '隐藏'))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  md.push(`### 虚高榜（AI 判高、金标≤低）：${falseHighList.length} 条`)
  md.push('')
  if (falseHighList.length === 0) md.push('（无）')
  else {
    md.push('| 故事 | AI分 | 金标 | 题目(中文) | AI理由 |')
    md.push('|---|---|---|---|---|')
    for (const p of falseHighList) md.push(`| ${p.storyId} | ${p.score} | ${p.gold} | ${cell(p.questionZh)} | ${cell(p.reason ?? '')} |`)
  }
  md.push('')
  // 埋没榜
  const burialList = aligned.pairs
    .filter((p) => !p.isOutOfScope && p.gold === '高' && p.ai === '隐藏')
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
  md.push(`### 埋没榜（金标高、AI 压到隐藏）：${burialList.length} 条`)
  md.push('')
  if (burialList.length === 0) md.push('（无）')
  else {
    md.push('| 故事 | AI分 | 题目(中文) | AI理由 |')
    md.push('|---|---|---|---|')
    for (const p of burialList) md.push(`| ${p.storyId} | ${p.score} | ${cell(p.questionZh)} | ${cell(p.reason ?? '')} |`)
  }
  md.push('')
  // 分观察点
  md.push('### 分观察点 · 可见区档位命中率')
  md.push('')
  const byPoint = new Map<string, { hit: number; total: number }>()
  for (const p of aligned.pairs) {
    if (p.isOutOfScope || p.ai === 'unscored') continue
    if (!(p.ai === '高' || p.ai === '中' || p.ai === '低')) continue
    const e = byPoint.get(p.pointName) ?? { hit: 0, total: 0 }
    e.total++
    if (p.ai === (p.gold as AiTier)) e.hit++
    byPoint.set(p.pointName, e)
  }
  if (byPoint.size === 0) md.push('（无可算数据）')
  else {
    md.push('| 观察点 | 命中率 |')
    md.push('|---|---|')
    for (const [name, e] of [...byPoint.entries()].sort((a, b) => a[1].hit / a[1].total - b[1].hit / b[1].total)) {
      md.push(`| ${cell(name)} | ${pct(e.hit, e.total)} |`)
    }
  }
  md.push('')

  md.push('## 四、金标覆盖（A 端到端固有风险：上游变动 → 覆盖衰减）')
  md.push('')
  md.push(`- **金标缺口率**：${(gap.gapRatio * 100).toFixed(1)}%（可见未标 ${aligned.goldGapVisible.length} / 可见共 ${gap.gapDenom}）${gap.gapWarn ? ` ⚠ 超 ${(GAP_WARN_RATIO * 100).toFixed(0)}%，该补标` : ''}`)
  md.push(`- **金标未召回项**（金标有、本轮没召回，移交召回评估）：${aligned.goldNotRecalled.length}`)
  if (aligned.goldNotRecalled.length > 0) {
    md.push('')
    md.push('| 故事 | 题id | 金标档 |')
    md.push('|---|---|---|')
    for (const x of aligned.goldNotRecalled) md.push(`| ${x.storyId} | ${cell(x.questionId)} | ${x.goldBucket} |`)
  }
  md.push('')
  md.push(`- **金标缺口项明细**（本轮可见、金标没标 → 补标对象）：${aligned.goldGapVisible.length}`)
  if (aligned.goldGapVisible.length > 0) {
    md.push('')
    md.push('| 故事 | 分数 | 题目(中文) |')
    md.push('|---|---|---|')
    for (const x of aligned.goldGapVisible) md.push(`| ${x.storyId} | ${x.score < 0 ? '—' : x.score} | ${cell(x.questionZh)} |`)
  }
  if (aligned.storiesGoldMissing.length > 0) {
    md.push('')
    md.push(`- ⚠ 金标有、导出缺的故事（error/未跑）：${aligned.storiesGoldMissing.join(', ')}`)
  }
  md.push('')

  const json = {
    goldVersion: gold.version,
    exports: opts.exports,
    k: opts.k,
    gates: {
      firstScreenPrecision: ratio(g.firstScreenPrecision),
      falseHigh: ratio(g.falseHigh),
      visibleTierAccuracy: ratio(g.visibleTierAccuracy),
      burial: g.burial,   // 含 point/lo/hi/还原细节；隐藏区抽样加权还原，CI 宽
      unscoredExcluded: g.unscoredExcluded,
    },
    reference: {
      ndcgAtK: ndcg.value, ndcgStories: ndcg.storiesCounted,
      kendallTau: tau.value, tauStories: tau.storiesCounted,
      stability: stab.value, stabilityAgreed: stab.agreed, stabilityTotal: stab.total,
      confusionMatrix: matrix,
    },
    coverage: {
      goldGapRatio: gap.gapRatio,
      goldGapWarn: gap.gapWarn,
      goldNotRecalled: aligned.goldNotRecalled,
      goldGapVisible: aligned.goldGapVisible,
      storiesGoldMissing: aligned.storiesGoldMissing,
    },
    diagnostics: { falseHigh: falseHighList, burial: burialList },
  }

  return { json, md: md.join('\n') + '\n', console: con.join('\n') }
}

/** {numer,denom} → {value,numer,denom}，供 JSON 输出 */
function ratio(r: { numer: number; denom: number }): { value: number | null; numer: number; denom: number } {
  return { value: r.denom === 0 ? null : r.numer / r.denom, numer: r.numer, denom: r.denom }
}

try {
  main()
} catch (e: unknown) {
  console.error('\n✗ 脚本异常：', e instanceof Error ? e.message : e)
  process.exit(1)
}
