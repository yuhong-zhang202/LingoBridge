/**
 * @module   run-ranking
 * @desc     题目匹配 + 重排全量体检脚本 —— 读金标集 100 个故事，跑【真实线上链路】matchByStory
 *           （萃取→三层召回漏斗→相关性重排），把每条故事召回并打分排序后的候选题导出成两份文件：
 *           结构化 JSON（供后续算分）+ 人工「两级标注」用的 Markdown 标注表。本脚本只做数据导出，不算准确率。
 *           运行：npm run eval:ranking -- [--only=S001,S050] [--limit=N]
 *           底层：npx tsx --conditions=react-server --env-file=.env.local scripts/eval/run-ranking.ts
 *           说明：matching.ts / extraction.ts 含 `import 'server-only'`，该包在 Next 之外默认抛错；
 *           传 --conditions=react-server 令其解析到空实现（server-only 官方 exports 的 react-server 分支），
 *           从而可在脚本里直接 import 真实 matchByStory，杜绝重写召回 / 打分逻辑。
 * @author   LingoBridge
 * @created  2026-07-13
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { matchByStory, type FunnelMatchResult } from '@/services/matching'
import { SCORE_HIGH, SCORE_MID, SCORE_LOW } from '@/lib/constants'

// ── 类型 ──────────────────────────────────────────────────────────────────────

/** 金标条目（本脚本只取 id / story / countInAccuracy；金标文件其余字段忽略） */
interface GoldItemLite {
  id: string
  story: string
  countInAccuracy: boolean
}

interface GoldSet {
  version: string
  items: GoldItemLite[]
}

/** 导出的单个候选题（已随 matchByStory 按 relevanceScore 降序） */
interface CandidateExport {
  questionId: string
  part: 1 | 2 | 3
  questionEn: string
  questionZh: string
  pointName: string
  isPrimaryMatch: boolean
  relevanceScore: number | null
  relevanceReason: string | null
}

/** 一条故事的完整导出结果（成功） */
interface StoryResult {
  storyId: string
  story: string
  primaryPoint: { code: string; name: string } | null
  secondaryPoint: { code: string; name: string } | null
  matchedViaSecondary: boolean
  noMatch: boolean
  isOutOfScope: boolean
  candidates: CandidateExport[]
}

/** 一次运行的结局：成功含 StoryResult；失败含 error 及最小元信息（供 error 清单展示） */
type StoryOutcome =
  | { status: 'ok'; data: StoryResult }
  | { status: 'error'; storyId: string; story: string; isOutOfScope: boolean; message: string }

interface CliOptions {
  only: Set<string> | null
  limit: number | null
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const CONCURRENCY = 3
const __dirname = dirname(fileURLToPath(import.meta.url))
const GOLDEN_PATH = join(__dirname, 'golden', 'extraction.v2.json')
const RESULTS_DIR = join(__dirname, 'results')

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/**
 * 解析 CLI 参数
 * @param argv  process.argv.slice(2)
 * @returns     { only, limit }（缺省均为 null）
 */
function parseArgs(argv: string[]): CliOptions {
  let only: Set<string> | null = null
  let limit: number | null = null
  for (const arg of argv) {
    if (arg.startsWith('--only=')) {
      const ids = arg.slice('--only='.length).split(',').map((s) => s.trim()).filter((s) => s !== '')
      only = new Set(ids)
    } else if (arg.startsWith('--limit=')) {
      const n = Number.parseInt(arg.slice('--limit='.length), 10)
      if (!Number.isFinite(n) || n < 1) throw new Error(`--limit 需为 ≥1 的整数，收到：${arg}`)
      limit = n
    } else {
      throw new Error(`未知参数：${arg}（支持 --only=S001,S050 / --limit=N）`)
    }
  }
  return { only, limit }
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
 * 调 matchByStory，失败重试 1 次（共两次尝试）
 * @param story  故事全文
 * @returns      成功 { ok:true, result } / 失败 { ok:false, message }
 * @sideEffect   调用真实链路：DashScope 萃取/重排 + Supabase 题库读取（matchByStory 内部）
 */
async function matchWithRetry(story: string): Promise<{ ok: true; result: FunnelMatchResult } | { ok: false; message: string }> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { ok: true, result: await matchByStory(story) }
    } catch (e) {
      lastErr = e
    }
  }
  return { ok: false, message: lastErr instanceof Error ? lastErr.message : String(lastErr) }
}

/** 生产四档展示分桶键；unscored=重排降级未打分（生产按漏斗序仍展示，归入可见区） */
type Bucket = 'high' | 'mid' | 'low' | 'hidden' | 'unscored'

/** 分数 → 生产展示分桶（复用阈值：高 ≥85 / 中 ≥60 / 低 ≥40 / 隐藏 <40；null=未打分） */
function bucketOf(score: number | null): Bucket {
  if (score === null) return 'unscored'
  if (score >= SCORE_HIGH) return 'high'
  if (score >= SCORE_MID) return 'mid'
  if (score >= SCORE_LOW) return 'low'
  return 'hidden'
}

/** Markdown 表格单元格安全化：转义竖线、压平换行 */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
}

// ── 主流程 ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 预检：matchByStory 需要 DashScope（萃取+重排）+ Supabase service_role（题库读取）
  const missing = (['DASHSCOPE_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const)
    .filter((k) => !process.env[k])
  if (missing.length > 0) {
    console.error(`✗ 缺少环境变量：${missing.join(', ')}。请用 npm run eval:ranking（底层带 --env-file=.env.local），并在 .env.local 配齐上述变量。`)
    process.exit(1)
  }

  const opts = parseArgs(process.argv.slice(2))
  const gold = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8')) as GoldSet

  // 选取要跑的条目：先 --only 过滤，再 --limit 取前 N
  let items = gold.items
  if (opts.only) {
    const known = new Set(gold.items.map((it) => it.id))
    for (const id of opts.only) if (!known.has(id)) console.warn(`⚠ --only 指定的 ${id} 不在金标集中，已忽略`)
    items = gold.items.filter((it) => opts.only!.has(it.id))
    if (items.length === 0) throw new Error('--only 未匹配到任何条目')
  }
  if (opts.limit !== null) items = items.slice(0, opts.limit)

  console.log(`金标集 ${gold.version}｜故事 ${items.length}｜并发 ${CONCURRENCY}`)
  const t0 = Date.now()
  let done = 0

  const outcomes = await runPool(items, CONCURRENCY, async (item): Promise<StoryOutcome> => {
    const isOutOfScope = !item.countInAccuracy
    const res = await matchWithRetry(item.story)
    done++
    process.stdout.write(`\r进度 ${done}/${items.length}`)
    if (!res.ok) {
      return { status: 'error', storyId: item.id, story: item.story, isOutOfScope, message: res.message }
    }
    const r = res.result
    const candidates: CandidateExport[] = r.questions.map((q) => ({
      questionId: q.id,
      part: q.part,
      questionEn: q.cue_card_title ?? q.question_text,
      questionZh: q.cue_card_title_zh ?? q.question_text_zh ?? '',
      pointName: q.pointName,
      isPrimaryMatch: q.isPrimaryMatch,
      relevanceScore: q.relevanceScore ?? null,
      relevanceReason: q.relevanceReason ?? null,
    }))
    return {
      status: 'ok',
      data: {
        storyId: item.id,
        story: item.story,
        primaryPoint: r.primary ? { code: r.primary.pointCode, name: r.primary.pointName } : null,
        secondaryPoint: r.secondary ? { code: r.secondary.pointCode, name: r.secondary.pointName } : null,
        matchedViaSecondary: r.matchedViaSecondary,
        noMatch: r.noMatch,
        isOutOfScope,
        candidates,
      },
    }
  })
  const elapsedMs = Date.now() - t0
  process.stdout.write('\n')
  console.log(`完成，用时 ${(elapsedMs / 1000).toFixed(1)}s`)

  const report = buildReport(gold, outcomes, opts, elapsedMs)

  mkdirSync(RESULTS_DIR, { recursive: true })
  const stamp = fileStamp()
  const jsonPath = join(RESULTS_DIR, `ranking-${stamp}.json`)
  const mdPath = join(RESULTS_DIR, `ranking-${stamp}-标注表.md`)
  writeFileSync(jsonPath, JSON.stringify(report.json, null, 2), 'utf-8')
  writeFileSync(mdPath, report.md, 'utf-8')

  console.log('\n' + report.consoleSummary)
  if (report.suspectedEmptyBank) console.log('\n' + report.emptyBankNotice)
  console.log(`\nJSON:    ${jsonPath}`)
  console.log(`标注表:  ${mdPath}`)
}

// ── 报告构建 ──────────────────────────────────────────────────────────────────

interface BuiltReport {
  json: unknown
  md: string
  consoleSummary: string
  suspectedEmptyBank: boolean
  emptyBankNotice: string
}

/** 标注表开头的固定说明文案（两级标注规则 + 可见区/隐藏区重点 + 档位参考） */
const ANNOTATION_GUIDE = [
  '> 本表用于题目匹配+重排的人工体检。**重点标【用户可见区】（≥40 分），尤其高匹配（≥85）**——它们是用户首屏第一眼看到的题，最影响第一印象，虚高伤害最大。【隐藏区】（<40 分）用户看不到，只需扫一眼查有没有「本该高分却被压下去」的题，不必逐题标。',
  '> 分两级标注：',
  '> 第一级（每个故事必做）：在『整体判断』处填 🟢合理 / 🟡个别不对 / 🔴有大问题（主要看【用户可见区】排得对不对）。绝大多数合理的，扫一眼填🟢即过。',
  '> 第二级（仅🟡🔴故事做）：在候选题的『标注』列，对判断不对的题标记：『高分虚高』(AI给了高分但其实答不了/要大改故事)、『低分埋没』(AI给了低分但其实能直接答)、或『档位偏差』(高中低档位判得不对)。合理的题留空即可。',
  '> 档位参考：高匹配=故事直接能答(≥85，首屏展示)；中匹配=切换角度或补充信息才能答(60-84，折叠)；低匹配=得换个故事(40-59，折叠)；<40 不展示、不入库。',
].join('\n')

/** 由运行结局汇总控制台摘要并生成 JSON / Markdown 标注表 */
function buildReport(gold: GoldSet, outcomes: StoryOutcome[], opts: CliOptions, elapsedMs: number): BuiltReport {
  const oks = outcomes.filter((o): o is Extract<StoryOutcome, { status: 'ok' }> => o.status === 'ok')
  const errs = outcomes.filter((o): o is Extract<StoryOutcome, { status: 'error' }> => o.status === 'error')

  const noMatchCount = oks.filter((o) => o.data.noMatch).length
  const totalCandidates = oks.reduce((sum, o) => sum + o.data.candidates.length, 0)
  const avgCandidates = oks.length > 0 ? totalCandidates / oks.length : 0

  // 分数分布（跨所有候选题）；json 的 scoreDistribution 沿用旧口径（low = <60，含隐藏），不改。
  let high = 0, mid = 0, low = 0, unscored = 0
  // 展示口径附加统计：hidden = <40（用户不可见）；可见 = 总数 - hidden。firstScreenHigh 即 high（≥85 首屏）。
  let hiddenCount = 0
  for (const o of oks) {
    for (const c of o.data.candidates) {
      if (c.relevanceScore === null) unscored++
      else if (c.relevanceScore >= SCORE_HIGH) high++
      else if (c.relevanceScore >= SCORE_MID) mid++
      else low++
      if (c.relevanceScore !== null && c.relevanceScore < SCORE_LOW) hiddenCount++
    }
  }
  const firstScreenHigh = high
  const visibleTotal = totalCandidates - hiddenCount
  const avgVisible = oks.length > 0 ? visibleTotal / oks.length : 0

  // 疑似题库为空：有成功故事、但候选题总数为 0（普遍召回 0）
  const suspectedEmptyBank = oks.length > 0 && totalCandidates === 0
  const emptyBankNotice = [
    '⚠⚠ 疑似题库未导入或连接异常：所有成功故事召回 0 候选题。',
    '诊断建议：',
    '  1) 确认 Supabase 题库表 questions / question_observation_links 已导入数据（非空）；',
    '  2) 确认 .env.local 的 NEXT_PUBLIC_SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY 指向正确项目；',
    '  3) 抽查单条：npm run eval:ranking -- --only=S001，观察是否仍为 0；',
    '  4) 数据确认前，本次导出仅供诊断，请勿据此算分——请先确认题库状态再重跑。',
  ].join('\n')

  // ── 控制台摘要 ──
  const consoleSummary = [
    '## 摘要',
    `- 总故事数：${outcomes.length}（成功 ${oks.length}｜error ${errs.length}）`,
    `- noMatch 故事数：${noMatchCount}`,
    `- 平均每故事候选数：${avgCandidates.toFixed(2)}（候选总数 ${totalCandidates}）`,
    `- 分数分布（候选题）：高 ${high}｜中 ${mid}｜低 ${low}｜未打分 ${unscored}`,
    `- 首屏高匹配题总数（≥85）：${firstScreenHigh}`,
    `- 平均每故事可见候选数（≥40，含未打分）：${avgVisible.toFixed(2)}（可见总数 ${visibleTotal}｜隐藏 ${hiddenCount}）`,
    `- 耗时：${(elapsedMs / 1000).toFixed(1)}s`,
  ].join('\n')

  // ── Markdown 标注表 ──
  const md: string[] = []
  md.push('# 题目匹配 + 重排 人工标注表')
  md.push('')
  md.push(`- 金标集：${gold.version}`)
  md.push(`- 故事数：${outcomes.length}（成功 ${oks.length}｜error ${errs.length}｜noMatch ${noMatchCount}）`)
  md.push(`- 选项：${opts.only ? `--only=${[...opts.only].join(',')} ` : ''}${opts.limit !== null ? `--limit=${opts.limit}` : ''}`.trim() || '- 选项：（全量）')
  md.push(`- 用时：${(elapsedMs / 1000).toFixed(1)}s`)
  md.push('')
  if (suspectedEmptyBank) {
    md.push('> ⚠⚠ **疑似题库未导入或连接异常**：所有成功故事召回 0 候选题。请先按控制台诊断建议确认题库状态，勿据此标注。')
    md.push('')
  }
  md.push('## 标注说明')
  md.push('')
  md.push(ANNOTATION_GUIDE)
  md.push('')
  md.push('---')
  md.push('')

  // 保持金标顺序输出（outcomes 已按 items 顺序）
  for (const o of outcomes) {
    if (o.status === 'error') {
      md.push(`## ${o.storyId}${o.isOutOfScope ? '（域外条）' : ''}　⚠ error`)
      md.push('')
      md.push(`- 故事全文：${o.story}`)
      md.push(`- 运行失败：${o.message}`)
      md.push('- 整体判断：________')
      md.push('')
      md.push('---')
      md.push('')
      continue
    }
    const d = o.data
    md.push(`## ${d.storyId}${d.isOutOfScope ? '（域外条）' : ''}`)
    md.push('')
    md.push(`- 故事全文：${d.story}`)
    md.push(`- 主观察点：${d.primaryPoint ? `\`${d.primaryPoint.code}\` ${d.primaryPoint.name}` : '（无）'}`)
    md.push(`- 副观察点：${d.secondaryPoint ? `\`${d.secondaryPoint.code}\` ${d.secondaryPoint.name}` : 'null'}`)
    // 按生产四档分桶，保留候选在全局降序里的名次
    const ranked = d.candidates.map((c, i) => ({ c, rank: i + 1, bucket: bucketOf(c.relevanceScore) }))
    const g = {
      high: ranked.filter((x) => x.bucket === 'high'),
      mid: ranked.filter((x) => x.bucket === 'mid'),
      low: ranked.filter((x) => x.bucket === 'low'),
      unscored: ranked.filter((x) => x.bucket === 'unscored'),
      hidden: ranked.filter((x) => x.bucket === 'hidden'),
    }
    const visibleCount = g.high.length + g.mid.length + g.low.length + g.unscored.length
    const unscoredNote = g.unscored.length > 0 ? ` ｜ 未打分 ${g.unscored.length}` : ''
    md.push(`- 可见候选：高 ${g.high.length} ｜ 中 ${g.mid.length} ｜ 低 ${g.low.length}${unscoredNote} ｜（隐藏 ${g.hidden.length}）`)
    md.push(`- 是否 noMatch：${d.noMatch ? '是' : '否'}｜是否经副维度召回：${d.matchedViaSecondary ? '是' : '否'}｜是否域外条：${d.isOutOfScope ? '是' : '否'}`)
    md.push('- 整体判断（主要看【用户可见区】排得对不对）：______ （🟢合理 / 🟡个别不对 / 🔴有大问题）')
    md.push('')

    if (d.noMatch || d.candidates.length === 0) {
      md.push('**无候选题（走 noMatch 收尾）** —— 待人工确认这是否合理。')
      md.push('')
    } else {
      // 用户可见区（≥40 分）：按高/中/低（+ 未打分）分组，某档为空则不显示
      md.push('### 【用户可见区】≥40 分（重点标注）')
      md.push('')
      if (visibleCount === 0) {
        md.push('（无 ≥40 分候选——用户首屏 / 查看更多均无题，本身是待确认信号）')
        md.push('')
      } else {
        const visGroups = [
          { title: '▲ 高匹配（≥85，首屏直接展示）', rows: g.high },
          { title: '● 中匹配（60-84，折叠查看更多）', rows: g.mid },
          { title: '○ 低匹配（40-59，折叠查看更多）', rows: g.low },
          { title: '– 未打分（重排降级，按漏斗序展示）', rows: g.unscored },
        ]
        for (const grp of visGroups) {
          if (grp.rows.length === 0) continue
          md.push(`#### ${grp.title}`)
          md.push('')
          md.push('| 排名 | 分数 | Part | 题目(英文) | 题目(中文) | 所属观察点 | AI理由 | 标注 |')
          md.push('|---|---|---|---|---|---|---|---|')
          for (const { c, rank } of grp.rows) {
            const scoreStr = c.relevanceScore === null ? '—' : String(c.relevanceScore)
            md.push(`| ${rank} | ${scoreStr} | ${c.part} | ${cell(c.questionEn)} | ${cell(c.questionZh)} | ${cell(c.pointName)} | ${cell(c.relevanceReason ?? '')} |  |`)
          }
          md.push('')
        }
      }
      // 隐藏区（<40 分）：折叠成精简列表，仅供「低分埋没」扫查
      md.push('### 【隐藏区】<40 分（用户看不到，无需逐题标注，仅供「低分埋没」扫查）')
      md.push('')
      md.push('> 以下题目分数低于展示阈值，用户不可见。只需扫一眼确认没有『本该高分却被压到这里』的题；若有，在对应行标『低分埋没』。')
      md.push('')
      if (g.hidden.length === 0) {
        md.push('（无 <40 分候选）')
        md.push('')
      } else {
        md.push('| 分数 | 题目(中文) | AI理由 | 标注 |')
        md.push('|---|---|---|---|')
        for (const { c } of g.hidden) {
          const scoreStr = c.relevanceScore === null ? '—' : String(c.relevanceScore)
          md.push(`| ${scoreStr} | ${cell(c.questionZh)} | ${cell(c.relevanceReason ?? '')} |  |`)
        }
        md.push('')
      }
    }
    md.push('---')
    md.push('')
  }

  // ── JSON：结构化导出（供后续算分脚本读）──
  const json = {
    version: gold.version,
    generatedAt: new Date().toISOString(),
    options: { only: opts.only ? [...opts.only] : null, limit: opts.limit },
    suspectedEmptyBank,
    summary: {
      total: outcomes.length,
      ok: oks.length,
      error: errs.length,
      noMatch: noMatchCount,
      avgCandidates,
      scoreDistribution: { high, mid, low, unscored },
      elapsedMs,
    },
    stories: oks.map((o) => o.data),
    errors: errs.map((o) => ({ storyId: o.storyId, story: o.story, isOutOfScope: o.isOutOfScope, message: o.message })),
  }

  return { json, md: md.join('\n') + '\n', consoleSummary, suspectedEmptyBank, emptyBankNotice }
}

main().catch((e: unknown) => {
  console.error('\n✗ 脚本异常：', e instanceof Error ? e.message : e)
  process.exit(1)
})
