/**
 * @module   run-extraction
 * @desc     故事萃取准确率回归脚本 —— 读金标集，按并发批量调用【真实线上链路】extractCorpus，
 *           计算严格/宽容/维度命中、副维度增漏、稳定性等指标，产出 JSON 原始数据 + Markdown 报告。
 *           运行：npm run eval:extraction -- [--runs=N | --quick] [--only=S014,S037]
 *           底层：npx tsx --conditions=react-server --env-file=.env.local scripts/eval/run-extraction.ts
 *           说明：extraction.ts / llm.ts 含 `import 'server-only'`，该包在 Next 之外默认抛错；
 *           传 --conditions=react-server 令其解析到空实现（server-only 官方 exports 的 react-server 分支），
 *           从而可在脚本里直接 import 真实 extractCorpus，杜绝复制 prompt 另写调用逻辑。
 * @author   LingoBridge
 * @created  2026-07-13
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { extractCorpus, type ExtractionResult } from '@/services/extraction'

// ── 类型 ──────────────────────────────────────────────────────────────────────

type GoldType = '基础' | '边界陷阱' | '超短文本' | '域外观察条'

interface GoldItem {
  id: string
  type: GoldType
  story: string
  primary: string
  accept: string[]
  secondary: string | null
  countInAccuracy: boolean
}

interface GoldSet {
  version: string
  items: GoldItem[]
}

/** 单次运行的判定（仅对计入准确率、且调用成功的运行有意义） */
interface Judged {
  strictHit: boolean
  lenientHit: boolean
  dimHit: boolean
  goldHasSecondary: boolean
  predHasSecondary: boolean
  /** 双方都有副维度时是否命中；任一方无副维度则为 null */
  secondaryHit: boolean | null
}

/** 一条 story 的一次运行的完整记录（成功含 prediction+judged；失败含 error） */
interface RunRecord {
  itemId: string
  type: GoldType
  run: number
  status: 'ok' | 'error'
  prediction: ExtractionResult | null
  errorMessage: string | null
  judged: Judged | null
}

interface CliOptions {
  runs: number
  only: Set<string> | null
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const CONCURRENCY = 4
const DEFAULT_RUNS = 3
const __dirname = dirname(fileURLToPath(import.meta.url))
const GOLDEN_PATH = join(__dirname, 'golden', 'extraction.v1.json')
const RESULTS_DIR = join(__dirname, 'results')

/** 维度前缀 → 中文维度名（用于分组与报告） */
const DIM_NAMES: Record<string, string> = {
  EMO: '情绪内核 emotion',
  REL: '人际羁绊 relationship',
  SPA: '空间感知 space',
  SPI: '精神栖所 spirit',
  GRO: '成长演进 growth',
  VAL: '价值底色 value',
}
const DIM_ORDER = ['EMO', 'REL', 'SPA', 'SPI', 'GRO', 'VAL']
const TYPE_ORDER: GoldType[] = ['基础', '边界陷阱', '超短文本']

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 取观察点 code 的维度前缀（下划线前部分，如 EMO_04 → EMO） */
function dimOf(code: string): string {
  return code.split('_')[0] ?? code
}

/**
 * 解析 CLI 参数
 * @param argv  process.argv.slice(2)
 * @returns     { runs, only }（--quick 等价 --runs=1；--only 缺省为 null）
 */
function parseArgs(argv: string[]): CliOptions {
  let runs = DEFAULT_RUNS
  let only: Set<string> | null = null
  for (const arg of argv) {
    if (arg === '--quick') runs = 1
    else if (arg.startsWith('--runs=')) {
      const n = Number.parseInt(arg.slice('--runs='.length), 10)
      if (!Number.isFinite(n) || n < 1) throw new Error(`--runs 需为 ≥1 的整数，收到：${arg}`)
      runs = n
    } else if (arg.startsWith('--only=')) {
      const ids = arg.slice('--only='.length).split(',').map((s) => s.trim()).filter((s) => s !== '')
      only = new Set(ids)
    } else {
      throw new Error(`未知参数：${arg}（支持 --runs=N / --quick / --only=S014,S037）`)
    }
  }
  return { runs, only }
}

/** 文件名安全的时间戳（ISO，冒号/点换成短横） */
function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * 并发上限的任务池（保序返回）
 * @param items   任务输入数组
 * @param limit   并发上限
 * @param worker  单任务处理器（(item, index) => Promise<R>）
 * @returns       与 items 同序的结果数组
 */
async function runPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  async function lane(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  }
  const lanes = Array.from({ length: Math.min(limit, items.length) }, () => lane())
  await Promise.all(lanes)
  return results
}

/**
 * 调 extractCorpus，失败重试 1 次（共两次尝试）
 * @param story  故事全文
 * @returns      成功 { ok:true, result } / 失败 { ok:false, message }
 * @sideEffect   调用真实 DashScope LLM（extractCorpus 内部）
 */
async function extractWithRetry(story: string): Promise<{ ok: true; result: ExtractionResult } | { ok: false; message: string }> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { ok: true, result: await extractCorpus(story) }
    } catch (e) {
      lastErr = e
    }
  }
  return { ok: false, message: lastErr instanceof Error ? lastErr.message : String(lastErr) }
}

/** 对一次成功运行做判定（gold 为该条金标） */
function judge(gold: GoldItem, pred: ExtractionResult): Judged {
  const predPrimary = pred.primary.pointCode
  const strictHit = predPrimary === gold.primary
  const lenientHit = strictHit || gold.accept.includes(predPrimary)
  const dimHit = dimOf(predPrimary) === dimOf(gold.primary)
  const goldHasSecondary = gold.secondary !== null
  const predHasSecondary = pred.secondary !== null
  const secondaryHit = goldHasSecondary && predHasSecondary
    ? pred.secondary!.pointCode === gold.secondary
    : null
  return { strictHit, lenientHit, dimHit, goldHasSecondary, predHasSecondary, secondaryHit }
}

/** 百分比字符串："xx.x% (num/denom)"；denom 为 0 时 "—  (0)" */
function pct(num: number, denom: number): string {
  if (denom === 0) return '—  (0)'
  return `${((num / denom) * 100).toFixed(1)}%  (${num}/${denom})`
}

// ── 主流程 ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.DASHSCOPE_API_KEY) {
    console.error('✗ 未检测到 DASHSCOPE_API_KEY。请用 npm run eval:extraction（底层带 --env-file=.env.local），并在 .env.local 中配置 DASHSCOPE_API_KEY。')
    process.exit(1)
  }

  const opts = parseArgs(process.argv.slice(2))
  const gold = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8')) as GoldSet

  // 选取要跑的条目（--only 过滤）
  let items = gold.items
  if (opts.only) {
    const known = new Set(gold.items.map((it) => it.id))
    for (const id of opts.only) if (!known.has(id)) console.warn(`⚠ --only 指定的 ${id} 不在金标集中，已忽略`)
    items = gold.items.filter((it) => opts.only!.has(it.id))
    if (items.length === 0) throw new Error('--only 未匹配到任何条目')
  }

  // 展开成 (item, run) 扁平任务列表
  const tasks: { item: GoldItem; run: number }[] = []
  for (const item of items) for (let r = 1; r <= opts.runs; r++) tasks.push({ item, run: r })

  console.log(`金标集 ${gold.version}｜条目 ${items.length}｜每条 ${opts.runs} 次｜共 ${tasks.length} 次调用｜并发 ${CONCURRENCY}`)
  const t0 = Date.now()
  let done = 0

  const records = await runPool(tasks, CONCURRENCY, async ({ item, run }): Promise<RunRecord> => {
    const outcome = await extractWithRetry(item.story)
    done++
    if (done % CONCURRENCY === 0 || done === tasks.length) {
      process.stdout.write(`\r进度 ${done}/${tasks.length}`)
    }
    if (!outcome.ok) {
      return { itemId: item.id, type: item.type, run, status: 'error', prediction: null, errorMessage: outcome.message, judged: null }
    }
    return {
      itemId: item.id,
      type: item.type,
      run,
      status: 'ok',
      prediction: outcome.result,
      errorMessage: null,
      judged: item.countInAccuracy ? judge(item, outcome.result) : null,
    }
  })
  const elapsedMs = Date.now() - t0
  process.stdout.write('\n')
  console.log(`完成，用时 ${(elapsedMs / 1000).toFixed(1)}s`)

  const report = buildReport(gold, items, records, opts, elapsedMs)

  mkdirSync(RESULTS_DIR, { recursive: true })
  const base = `extraction-${fileStamp()}`
  const jsonPath = join(RESULTS_DIR, `${base}.json`)
  const mdPath = join(RESULTS_DIR, `${base}.md`)
  writeFileSync(jsonPath, JSON.stringify(report.json, null, 2), 'utf-8')
  writeFileSync(mdPath, report.md, 'utf-8')

  console.log('\n' + report.summaryTable)
  console.log(`\nJSON:  ${jsonPath}`)
  console.log(`报告:  ${mdPath}`)
}

// ── 报告构建 ──────────────────────────────────────────────────────────────────

interface BuiltReport {
  json: unknown
  md: string
  summaryTable: string
}

/** 由金标 + 运行记录汇总指标并生成 JSON/MD 报告 */
function buildReport(gold: GoldSet, items: GoldItem[], records: RunRecord[], opts: CliOptions, elapsedMs: number): BuiltReport {
  const itemById = new Map(gold.items.map((it) => [it.id, it]))

  // 计入准确率的成功运行（分母基础：countInAccuracy=true 且 status=ok）
  const accRuns = records.filter((r) => r.status === 'ok' && r.judged !== null)

  // ── 微平均指标 ──
  let strict = 0, lenient = 0, dim = 0
  let faNum = 0, faDenom = 0      // 副维度误增
  let msNum = 0, msDenom = 0      // 副维度漏检
  let shNum = 0, shDenom = 0      // 副维度命中
  for (const r of accRuns) {
    const j = r.judged!
    if (j.strictHit) strict++
    if (j.lenientHit) lenient++
    if (j.dimHit) dim++
    if (!j.goldHasSecondary) { faDenom++; if (j.predHasSecondary) faNum++ }
    if (j.goldHasSecondary) { msDenom++; if (!j.predHasSecondary) msNum++ }
    if (j.goldHasSecondary && j.predHasSecondary) { shDenom++; if (j.secondaryHit) shNum++ }
  }
  const accDenom = accRuns.length

  // ── 稳定性（按故事：全部成功运行的主观察点一致；无成功运行的条目不计入分母）──
  let stableNum = 0, stableDenom = 0
  for (const item of items) {
    if (!item.countInAccuracy) continue
    const oks = records.filter((r) => r.itemId === item.id && r.status === 'ok' && r.prediction !== null)
    if (oks.length === 0) continue
    stableDenom++
    const codes = new Set(oks.map((r) => r.prediction!.primary.pointCode))
    if (codes.size === 1) stableNum++
  }

  // ── 分组：按 type ──
  const byType = TYPE_ORDER.map((t) => {
    const rs = accRuns.filter((r) => r.type === t)
    return { key: t, denom: rs.length, strict: rs.filter((r) => r.judged!.strictHit).length, lenient: rs.filter((r) => r.judged!.lenientHit).length }
  })

  // ── 分组：按金标主维度 ──
  const byDim = DIM_ORDER.map((d) => {
    const rs = accRuns.filter((r) => dimOf(itemById.get(r.itemId)!.primary) === d)
    return { key: d, name: DIM_NAMES[d], denom: rs.length, strict: rs.filter((r) => r.judged!.strictHit).length, lenient: rs.filter((r) => r.judged!.lenientHit).length }
  })

  // ── 错例（计入准确率、且至少一次运行非「完全正确」的条目；完全正确 = 宽容命中 且 副维度正确）──
  function fullyCorrect(j: Judged): boolean {
    const secOk = (!j.goldHasSecondary && !j.predHasSecondary) || j.secondaryHit === true
    return j.lenientHit && secOk
  }
  const errorCaseItems = items.filter((item) => {
    if (!item.countInAccuracy) return false
    const oks = records.filter((r) => r.itemId === item.id && r.status === 'ok' && r.judged !== null)
    return oks.length > 0 && oks.some((r) => !fullyCorrect(r.judged!))
  })

  // ── 域外观察条 & error 清单 ──
  const domainOutItems = items.filter((it) => !it.countInAccuracy)
  const errorRuns = records.filter((r) => r.status === 'error')

  // ── 指标总表（同时用于控制台） ──
  const summaryTable = [
    '## 指标总表（微平均，分母已排除 域外条目 与 error 运行）',
    '',
    '| 指标 | 值 |',
    '|---|---|',
    `| 严格命中率 | ${pct(strict, accDenom)} |`,
    `| 宽容命中率 | ${pct(lenient, accDenom)} |`,
    `| 维度命中率 | ${pct(dim, accDenom)} |`,
    `| 副维度误增率 | ${pct(faNum, faDenom)} |`,
    `| 副维度漏检率 | ${pct(msNum, msDenom)} |`,
    `| 副维度命中率 | ${pct(shNum, shDenom)} |`,
    `| 稳定性（按故事，R=${opts.runs}） | ${pct(stableNum, stableDenom)} |`,
  ].join('\n')

  // ── Markdown 报告 ──
  const md: string[] = []
  md.push(`# 故事萃取准确率报告`)
  md.push('')
  md.push(`- 金标集：${gold.version}`)
  md.push(`- 条目数：${items.length}（其中域外观察条 ${domainOutItems.length}，不计入指标）`)
  md.push(`- 每条运行次数 R：${opts.runs}${opts.only ? `｜--only：${[...opts.only].join(', ')}` : ''}`)
  md.push(`- 总调用：${records.length}｜成功 ${records.length - errorRuns.length}｜error ${errorRuns.length}`)
  md.push(`- 用时：${(elapsedMs / 1000).toFixed(1)}s`)
  md.push('')
  md.push(summaryTable)
  md.push('')

  md.push('## 分组表')
  md.push('')
  md.push('### 按题型（严格 / 宽容）')
  md.push('')
  md.push('| 题型 | 严格命中率 | 宽容命中率 |')
  md.push('|---|---|---|')
  for (const g of byType) md.push(`| ${g.key} | ${pct(g.strict, g.denom)} | ${pct(g.lenient, g.denom)} |`)
  md.push('')
  md.push('### 按金标主维度（严格 / 宽容）')
  md.push('')
  md.push('| 维度 | 严格命中率 | 宽容命中率 |')
  md.push('|---|---|---|')
  for (const g of byDim) md.push(`| ${g.name} | ${pct(g.strict, g.denom)} | ${pct(g.lenient, g.denom)} |`)
  md.push('')

  md.push('## 错例明细')
  md.push('')
  md.push(`错例 = 计入准确率、且至少一次运行未「完全正确」（宽容命中 且 副维度正确）的条目，共 ${errorCaseItems.length} 条。`)
  md.push('')
  for (const item of errorCaseItems) {
    const oks = records.filter((r) => r.itemId === item.id && r.status === 'ok' && r.judged !== null).sort((a, b) => a.run - b.run)
    md.push(`### ${item.id}（${item.type}）`)
    md.push('')
    md.push(`- 故事全文：${item.story}`)
    md.push(`- 金标：主 = \`${item.primary}\`｜备选 = ${item.accept.length ? item.accept.map((c) => `\`${c}\``).join(', ') : '（无）'}｜副 = ${item.secondary ? `\`${item.secondary}\`` : 'null'}`)
    md.push('- 各次预测：')
    for (const r of oks) {
      const p = r.prediction!
      const mark = fullyCorrect(r.judged!) ? '✓' : '✗'
      const sec = p.secondary ? `\`${p.secondary.pointCode}\`（${p.secondary.reason}）` : 'null'
      md.push(`  - [运行 ${r.run}] ${mark} 主 = \`${p.primary.pointCode}\`（${p.primary.reason}）｜副 = ${sec}`)
    }
    md.push('')
  }

  md.push('## 域外观察条（countInAccuracy=false，不计入任何分母，供人工检查）')
  md.push('')
  for (const item of domainOutItems) {
    const runs = records.filter((r) => r.itemId === item.id).sort((a, b) => a.run - b.run)
    md.push(`### ${item.id}`)
    md.push('')
    md.push(`- 故事全文：${item.story}`)
    md.push(`- 金标参考：主 = \`${item.primary}\`｜副 = ${item.secondary ? `\`${item.secondary}\`` : 'null'}`)
    md.push('- 各次预测：')
    for (const r of runs) {
      if (r.status === 'error') { md.push(`  - [运行 ${r.run}] error：${r.errorMessage}`); continue }
      const p = r.prediction!
      const sec = p.secondary ? `\`${p.secondary.pointCode}\`（${p.secondary.reason}）` : 'null'
      md.push(`  - [运行 ${r.run}] 主 = \`${p.primary.pointCode}\`（${p.primary.reason}）｜副 = ${sec}`)
    }
    md.push('')
  }

  md.push('## error 清单')
  md.push('')
  if (errorRuns.length === 0) md.push('（无）')
  else {
    md.push('| 条目 | 运行 | 错误 |')
    md.push('|---|---|---|')
    for (const r of errorRuns) md.push(`| ${r.itemId} | ${r.run} | ${r.errorMessage} |`)
  }
  md.push('')

  // ── JSON：完整原始记录 + 汇总 ──
  const json = {
    version: gold.version,
    generatedAt: new Date().toISOString(),
    options: { runs: opts.runs, only: opts.only ? [...opts.only] : null },
    elapsedMs,
    metrics: {
      accDenom,
      strictHit: strict,
      lenientHit: lenient,
      dimHit: dim,
      secondaryFalseAdd: { num: faNum, denom: faDenom },
      secondaryMissed: { num: msNum, denom: msDenom },
      secondaryHit: { num: shNum, denom: shDenom },
      stability: { num: stableNum, denom: stableDenom },
      byType,
      byDim,
    },
    runs: records,
    errorRuns,
  }

  return { json, md: md.join('\n') + '\n', summaryTable }
}

main().catch((e: unknown) => {
  console.error('\n✗ 脚本异常：', e instanceof Error ? e.message : e)
  process.exit(1)
})
