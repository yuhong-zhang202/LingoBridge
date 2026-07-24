/**
 * @module   pregen-analyses
 * @desc     题目静态分析预生成器 —— 遍历「当季全库（含 Part3）」，为每道题生成一份静态分析
 *           （与用户无关、全站共享），写入 question_analyses（question_id / season / analysis jsonb）。
 *           题卡展示时直接读档、不再实时调 AI（方案 §3）。
 *
 *           严格沿用 import-season.ts 惯例：
 *             · service-role REST 通道（getSupabaseServer），本仓库无 supabase CLI；
 *             · 默认 dry-run 只统计不写库、不调 AI；加 --commit 才真跑 AI + 写库；
 *             · 幂等续跑：question_analyses 已有「当季」分析的题跳过（命中判定 = 该行 season 与
 *               questions.season 一致，与 0032 迁移头的失效语义一致）。
 *
 *           Part3 分析框架（方案 §12 硬约束「独立框架，非在现 prompt 加 if 分支」）：
 *             现有 src/services/analysis.ts 的 generateAnalysis SYSTEM_PROMPT 写死「本页只有 Part1/Part2，
 *             Part3 不会走到这里」。为不污染它、也为 Part3 后续能单独金标，本脚本内置一套【独立】的 Part3
 *             分析 prompt（PART3_SYSTEM_PROMPT）+ generatePart3Analysis，与 generateAnalysis 完全分离：
 *               · Part1/Part2 题 → 复用 services/analysis.ts 的 generateAnalysis；
 *               · Part3 题       → 走本脚本 generatePart3Analysis。
 *             两者都产出同一 QuestionAnalysis 结构（structureLabel/focusPoints/phrases），令展示层同一套渲染。
 *             ⚠ TODO（交产品方 / 后续金标）：Part3 prompt 目前是「先跑通结构」的初版框架，其分析质量需
 *               单独金标校准（Part3 是观点追问、评分侧重与 Part1/2 不同）。本轮只保证结构可写入、可渲染。
 *
 *           不真跑全库 AI（省钱）：dry-run 只打印将处理多少题、Part 分布、幂等跳过多少；真实 commit（逐题
 *           调 qwen-plus）留后续按需分批跑。
 *
 *           运行：npm run pregen:analyses            （dry-run：只统计，不调 AI、不写库）
 *                 npm run pregen:analyses -- --commit （真跑 AI + 写库；逐题串行，失败可重跑续做）
 *           底层：npx tsx --conditions=react-server --env-file=.env.local scripts/pregen-analyses.ts
 * @author   LingoBridge
 * @created  2026-07-23
 */
import { getSupabaseServer } from '@/lib/supabase-server'
import { env } from '@/lib/env-server'
import { callLLMJson } from '@/lib/llm'
import { callAnkiLLMJson } from '@/lib/ai/anki-json'
import { cleanEn } from '@/lib/ai/anki-answer'
import { PART3_EXAMPLE_SYSTEM, part3ExampleUserPrompt } from '@/lib/ai/part3-example-prompt'
import { CURRENT_SEASON, MODEL_ANALYSIS } from '@/lib/constants'
import { generateAnalysis } from '@/services/analysis'
import type { QuestionAnalysis } from '@/lib/types'

// ── 常量 ──────────────────────────────────────────────────────────────────────

const QUESTIONS_TABLE = 'questions'
const ANALYSES_TABLE = 'question_analyses'

// ── 类型（DB 侧）──────────────────────────────────────────────────────────────

interface QRow {
  id: string
  part: 1 | 2 | 3
  question_text: string
  question_text_zh: string | null
  season: string
}

// ── Part3 独立分析框架（方案 §12：不碰 generateAnalysis）────────────────────────
// ⚠ 初版框架，先跑通结构；质量待单独金标（见模块头 TODO）。产出结构与 QuestionAnalysis 一致。

const PART3_SYSTEM_PROMPT = `你是 LingoBridge 的雅思口语备考助手。给定一道雅思口语 Part 3 追问题，为中国考生生成「答题侧重点」和「可用词组」。

Part 3 和 Part 1/2 不同：它考的是【就一个话题展开观点、给理由、比较权衡、推测影响】的能力，不是讲自己的一段亲身经历。所以分析要把考生往「表明立场 → 给出理由/例子 → 适当延伸（比较、让步、推测）」这条线上引，而不是引导他记流水账。

# 怎么分析（每次按这三样想）
1) 这道题在追问什么类型：是问「你怎么看/同不同意」（观点）、「为什么会这样」（原因）、「以前和现在有什么不同」（比较变化）、「将来会怎样」（推测）、还是「利弊/影响」（权衡）？structureLabel 要扣住这个真实追问类型。
2) 怎么答得有深度：Part 3 拿分靠「有一个清楚的立场 + 至少一条讲得透的理由 + 一个具体例子或延伸」。侧重点要提醒考生别只给结论，要把「为什么」讲开、能举例就举例、能比较/让步就顺带说一句。
3) 口语评分标准：内部依据流利连贯、词汇资源、语法多样、发音判断；输出给用户【绝不出现】fluency、band、评分这类术语，一律大白话（如「先亮明看法」「把理由讲透一点」）。

# 输出：严格 JSON（不要 markdown 代码块，不要任何解释）
{
  "structureLabel": "答题结构标签，用 · 分隔，扣住这道 Part 3 的实际追问",
  "focusPoints": [{ "title": "4 到 8 字短名词小标题", "desc": "中文说明 1 到 2 句，具体可操作" }],
  "phrases": [{ "group": "简洁名词标签，如「立场」「理由」「举例」「比较」「推测」", "items": [{ "text": "纯英文短词块", "meaning": "中文释义", "scene": "中文，真实英语里什么场合会用到它" }] }]
}

# focusPoints 规则（Part 3 固定 3 点，按这道题套，不要写死成某个题）
- 点 1 = 先亮立场：提醒用一句话直接给出自己的看法/答案，别绕。
- 点 2 = 把理由讲透：提醒挑一个主要理由讲清楚「为什么」，能配一个具体例子最好，别停在一句结论上。
- 点 3 = 适当延伸：提醒顺带补一句比较、让步或对将来的推测（如「以前……现在……」「虽然……但……」「以后可能……」），让回答更完整。
- title 是 4 到 8 字短名词小标题（如「先亮明看法」「把理由讲透」「补一句延伸」），【绝不能是一句话或带逗号的句子】；具体说明放 desc。
- title/desc 用中文；可引用题干英文词，但【不要】给用户答案该用的英文句子/词组（答案英文放进 phrases）。
- 语气平和是建议不是命令；没有用户故事时给这道题通用的对题思路。

# phrases 规则（给能直接开口用的短词块）
- 每个词组含 text（纯英文短词块，2 到 5 个词，不写整句）、meaning（中文释义，不超过 15 字）、scene（中文，脱离具体题目讲通用用法）。
- text 必须是纯英文，绝不夹中文；感受/观点类也给短词块（如 it really depends、to some extent、the bigger issue）。
- 分组用简洁名词标签（如 立场、理由、举例、比较、推测），通常分 3 组左右，每组 3 到 5 个。
- 默认按雅思 6.0 出词：自然日常口语、朴素为主，不堆高级词、不长难句。

# 全局
- 全部紧扣这道具体 Part 3 题目。
- 【不要使用破折号】：任何地方不出现「—」或「–」，需要停顿或连接用逗号、句号或 and、so、but、like。

【JSON 格式硬约束】
只能输出合法 JSON，前后不得有任何说明文字或 markdown 代码块。
字符串值内部禁止出现英文双引号 " ，如需引用一律改用中文引号「」。`

// ── Part3 例句（通用示范论据句）静态化（方案 §8/§10）───────────────────────────
// part3 无用户语料，例句是「这个论点可以怎么用一句话论证」的通用范例；随 focusPoints 一起 pregen 静态存进
// focusPoint.example，不进 anki_cards、不走 drain（part3 恒 null 不变式不动）。prompt 与探针 SYSTEM_PART3
// 逐字同源（见 src/lib/ai/part3-example-prompt.ts 头，有漂移测试互锁）。
// ⚠ 对齐探针 example-probe part3 的采样参数：qwen-plus / temp 0.7 / maxTokens 512。
const PART3_EXAMPLE_TEMPERATURE = 0.7
const PART3_EXAMPLE_MAX_TOKENS = 512

/** part3 例句单点（模型返回裸数组 [{idx,en}]，逐点对齐 focusPoints）。 */
interface Part3ExamplePoint {
  idx: number
  en: string
}

/** part3 例句点的运行时守卫：idx 数字、en 字符串。 */
function isPart3ExamplePoint(v: unknown): v is Part3ExamplePoint {
  if (typeof v !== 'object' || v === null) return false
  const p = v as { idx?: unknown; en?: unknown }
  return typeof p.idx === 'number' && typeof p.en === 'string'
}

/**
 * 为 part3 的每个 focusPoint 生成一句通用示范论据句。走 callAnkiLLMJson（平衡括号解析裸数组、兜双发 JSON）；
 * 不走共享 callLLMJson —— 那的 extractJson 只切 {…}、不认 SYSTEM_PART3 契约要求的裸数组。
 * @param questionText part3 英文题面
 * @param focusPoints  该题 focusPoints（title/desc）
 * @returns            逐点对齐的例句数组；缺失/空串留 null（part3 理论上每点都有，防御性兜空）
 * @throws             LLM 调用失败 / 用尽重试
 * @sideEffect         调 qwen-plus（付费）
 */
async function generatePart3Examples(
  questionText: string,
  focusPoints: { title: string; desc: string }[],
): Promise<(string | null)[]> {
  const user = part3ExampleUserPrompt(questionText, focusPoints)
  const points = await callAnkiLLMJson<Part3ExamplePoint[]>({
    label: '[Part3Example]',
    call: {
      endpoint: `${env.dashscopeBaseUrl}/chat/completions`,
      apiKey: env.dashscopeApiKey,
      model: MODEL_ANALYSIS,
      temperature: PART3_EXAMPLE_TEMPERATURE,
      maxTokens: PART3_EXAMPLE_MAX_TOKENS,
      messages: [
        { role: 'system', content: PART3_EXAMPLE_SYSTEM },
        { role: 'user', content: user },
      ],
    },
    validate: (v): v is Part3ExamplePoint[] => Array.isArray(v) && v.every(isPart3ExamplePoint),
  })
  return focusPoints.map((_, i) => {
    // 复用 part1/2 生成器的同源 cleanEn（破折号→逗号）：part3 例句静态落库、展示给所有用户，
    // 不清洗会把 H3 硬规则违规的破折号原样烤进卡面。保持「找不到该 idx → null」语义不变，只在有值时清洗。
    const raw = points.find((p) => p.idx === i)?.en
    if (raw === undefined) return null
    const cleaned = cleanEn(raw)
    return cleaned ? cleaned : null
  })
}

/**
 * Part3 独立分析生成（不复用 generateAnalysis，见模块头 §12）。产出 QuestionAnalysis 结构，
 * 并为每个 focusPoint 补一句通用示范论据句（方案 §10：随分析静态预生成、存进 focusPoint.example）。
 * @param input  { en, zh } —— Part3 题面英文 + 中文（静态分析、无用户故事）
 * @returns      QuestionAnalysis（focusPoints 已带 example）
 * @throws       Error —— 未配置 key 或 LLM 调用失败
 * @sideEffect   调 qwen-plus（付费）两次：分析 + 例句
 */
async function generatePart3Analysis(input: { en: string; zh: string | null }): Promise<QuestionAnalysis> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }
  const userMsg = `Part 3\n英文题目：${input.en}\n中文：${input.zh ?? ''}`
  // 超时预算参照 services/analysis.ts：静态题面无用户故事、输入短，55s 基线足够宽。
  const analysis = await callLLMJson<QuestionAnalysis>({
    label: '[Part3Analysis]',
    call: {
      provider: 'dashscope',
      endpoint: `${env.dashscopeBaseUrl}/chat/completions`,
      apiKey: env.dashscopeApiKey,
      model: MODEL_ANALYSIS,
      messages: [
        { role: 'system', content: PART3_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      maxTokens: 2560,
    },
    timeoutMs: 55_000 + 40 * userMsg.length,
    validate: (v): v is QuestionAnalysis =>
      typeof v === 'object' && v !== null &&
      Array.isArray((v as { focusPoints?: unknown }).focusPoints) &&
      Array.isArray((v as { phrases?: unknown }).phrases),
  })
  // 第二次调用：为每个 focusPoint 补例句，逐点写进 focusPoint.example（缺失则不写、保持可选空）。
  const examples = await generatePart3Examples(input.en, analysis.focusPoints)
  return {
    ...analysis,
    focusPoints: analysis.focusPoints.map((p, i) => {
      const ex = examples[i]
      return ex ? { ...p, example: ex } : p
    }),
  }
}

/** 按 part 分发到对应分析框架（Part1/2 复用 generateAnalysis，Part3 走独立框架）。 */
async function analyzeQuestion(q: QRow): Promise<QuestionAnalysis> {
  if (q.part === 3) {
    return generatePart3Analysis({ en: q.question_text, zh: q.question_text_zh })
  }
  // 静态分析无用户故事：不传 story。
  return generateAnalysis({ part: q.part, en: q.question_text, zh: q.question_text_zh })
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const commit = args.includes('--commit')
  const unknown = args.filter((a) => a !== '--commit' && a !== '--dry-run')
  if (unknown.length > 0) {
    console.error(`未知参数：${unknown.join(', ')}（仅支持 --dry-run(默认) / --commit）`)
    process.exit(1)
  }

  const missingEnv = (['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const).filter((k) => !process.env[k])
  if (missingEnv.length > 0) {
    console.error(`✗ 缺少环境变量：${missingEnv.join(', ')}。请用 npm run pregen:analyses（底层带 --env-file=.env.local）。`)
    process.exit(1)
  }

  const sb = getSupabaseServer()

  // 1) 取当季全库（含 Part3）。
  const { data: qData, error: qErr } = await sb
    .from(QUESTIONS_TABLE)
    .select('id, part, question_text, question_text_zh, season')
    .eq('season', CURRENT_SEASON)
  if (qErr) throw new Error(`读取 questions 失败：${qErr.message}`)
  const questions = (qData ?? []) as QRow[]

  // 2) 取已有「当季」分析的 question_id（幂等续跑跳过）。
  const { data: aData, error: aErr } = await sb
    .from(ANALYSES_TABLE)
    .select('question_id, season')
    .eq('season', CURRENT_SEASON)
  if (aErr) throw new Error(`读取 ${ANALYSES_TABLE} 失败：${aErr.message}`)
  const done = new Set(((aData ?? []) as { question_id: string }[]).map((r) => r.question_id))

  const pending = questions.filter((q) => !done.has(q.id))

  // 3) 统计报告（dry-run 与 commit 都先打印）。
  const byPart = (rows: QRow[]): Record<1 | 2 | 3, number> => {
    const acc: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 }
    for (const r of rows) acc[r.part] += 1
    return acc
  }
  const totalDist = byPart(questions)
  const pendingDist = byPart(pending)

  console.log('# pregen-analyses 预生成计划报告\n')
  console.log(`当季 CURRENT_SEASON = ${CURRENT_SEASON}`)
  console.log(`当季全库题数：${questions.length}（Part1 ${totalDist[1]} / Part2 ${totalDist[2]} / Part3 ${totalDist[3]}）`)
  console.log(`已有当季分析（跳过）：${done.size}`)
  console.log(`待生成：${pending.length}（Part1 ${pendingDist[1]} / Part2 ${pendingDist[2]} / Part3 ${pendingDist[3]}）`)
  console.log(`  · Part1/Part2 → services/analysis.ts generateAnalysis`)
  console.log(`  · Part3       → 本脚本 generatePart3Analysis（独立框架，质量待单独金标）`)

  if (!commit) {
    console.log('\n———')
    console.log(`本次为 dry-run，未调 AI、未写库。确认无误后加 --commit 逐题生成并写入 ${ANALYSES_TABLE}。`)
    console.log('（--commit 会逐题串行调 qwen-plus，产生真实 AI 费用；中断后重跑自动跳过已完成题。）')
    return
  }

  // 4) --commit：逐题串行生成 + 写库（失败即中止，已写入的保留，重跑续做）。
  console.log(`\n⚙ --commit：开始逐题生成（共 ${pending.length} 题）……\n`)
  let ok = 0
  let fail = 0
  for (const q of pending) {
    try {
      const analysis = await analyzeQuestion(q)
      const now = new Date().toISOString()
      const { error: upErr } = await sb
        .from(ANALYSES_TABLE)
        .upsert(
          { question_id: q.id, season: q.season, analysis, updated_at: now },
          { onConflict: 'question_id' },
        )
      if (upErr) throw new Error(upErr.message)
      ok += 1
      console.log(`  ✓ [Part${q.part}] ${q.id} → 已写入（${ok}/${pending.length}）`)
    } catch (e) {
      fail += 1
      console.error(`  ✗ [Part${q.part}] ${q.id} 生成/写入失败：${e instanceof Error ? e.message : e}`)
      // 单题失败不拖垮整轮：记账后继续下一题，末尾汇总。重跑会自动跳过已成功题、重试失败题。
    }
  }
  console.log(`\n✓ 完成：成功 ${ok} ／ 失败 ${fail}（失败题下次重跑自动重试；成功题已入库不再重复）。`)
}

main().then(() => process.exit(0)).catch((e: unknown) => {
  console.error('\n✗ 脚本异常：', e instanceof Error ? e.message : e)
  process.exit(1)
})
