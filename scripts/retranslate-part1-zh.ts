/**
 * @module   retranslate-part1-zh
 * @desc     重译 questions 表 Part 1 的 question_text_zh（224 行系统性错位）。
 *           只读数据库，不写库。产物输出到 scripts/out/。
 *           运行：node --env-file=.env.local --import=tsx/esm scripts/retranslate-part1-zh.ts
 *           或：  npx tsx --env-file=.env.local scripts/retranslate-part1-zh.ts
 * @author   LingoBridge
 * @created  2026-06-06
 *
 * 注意：src/lib/llm.ts 含 `import 'server-only'`，该包在 Next.js 之外会无条件抛错，
 * 因此本脚本直接内联同等的 DashScope HTTP 调用逻辑，不 import callLLMJson。
 *
 * 2026-08-03：读库由「anon key + signInAnonymously()」改为 service_role 直连。
 * 本脚本纯读、不验证 RLS 语义，此前的匿名登录只为拿一个 authenticated 角色，
 * 却让每次运行都在生产 auth.users 里留下一个与真实用户无法区分的匿名账号
 * （污染匿名用户数/漏斗统计）。改后【一个账号都不建】。
 * 需要的环境变量随之从 NEXT_PUBLIC_SUPABASE_ANON_KEY 改为 SUPABASE_SERVICE_ROLE_KEY。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// ── 路径 ──────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, 'out')

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface QuestionRow {
  id: string
  question_text: string
  question_text_zh: string
}

interface TranslationItem {
  id: string
  zh: string
}

interface ReviewRow {
  id: string
  en: string
  old_zh: string
  new_zh: string
}

interface DashScopeResult {
  text: string
  promptTokens: number
  completionTokens: number
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const TRANSLATE_MODEL = 'qwen-flash'
const BATCH_SIZE = 30
const TIMEOUT_MS = 60_000

const DASHSCOPE_BASE_URL =
  process.env.DASHSCOPE_BASE_URL ??
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'

// 每 1K token 估算成本（qwen-flash，单位：人民币）
const COST_PER_1K_INPUT_CNY  = 0.00015
const COST_PER_1K_OUTPUT_CNY = 0.0006

// ── Prompt ────────────────────────────────────────────────────────────────────

const TRANSLATE_SYSTEM_PROMPT = `你是雅思口语题目翻译助手。用户会给你一批雅思口语题目（英文），每条带一个 id。
你的任务：将每条英文题目忠实翻译成自然的中文口语疑问句。

【翻译要求】
- 保持疑问句句式，对应英文句型（do you / have you / how often / when 等）
- 使用自然的中文口语表达，贴近雅思口试对话风格
- 忠实翻译，不增删语义，不解释，不加括号说明
- 严格一一对应每个 id，不得跳过任何条目

【三条硬性约束——违反视为翻译错误】
1. 核心名词/动词必须准确对译，不得替换为语义不同的近义词。
   示例：views=风景/景观，不能译成"待在哪里"；know about=了解/知道关于，不能译成"会不会做"；
   spend on=花费在……上，不能窄化为"买"；rule-free=没有规则/校规的，不能笼统译成"混乱的"。
2. 原句的主语和提问对象不得改变。
   示例：Do you know any famous people in your area → 主语是"你认不认识"，不能译成"你所在地区有没有名人"。
3. 并列形容词或名词要全部译出，一个都不能漏。
   示例：nice and friendly → 需译出两个词（如"和善又友好"），不能只留"友善"。

【输出格式】只返回合法 JSON 数组，不要 markdown 代码块围栏，不要任何前后缀文字，字符串值内部禁止使用英文双引号：
[{"id":"...","zh":"翻译后的中文"},...]
覆盖用户给出的全部 id，一个都不漏。`

const RETRY_FIX = '你上次的输出无法被解析为合法 JSON 数组。请只输出合法 JSON 数组，' +
  '字符串值内部禁止使用英文双引号，不要 markdown 代码块，不要任何前后缀文字。'

// ── DashScope 内联调用 ────────────────────────────────────────────────────────

/**
 * 单次 DashScope chat completions 调用
 * @param messages  对话消息列表
 * @returns         模型回复文本 + token 用量
 */
async function callDashScope(
  messages: Array<{ role: string; content: string }>,
): Promise<DashScopeResult> {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) throw new Error('缺少 DASHSCOPE_API_KEY 环境变量')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: TRANSLATE_MODEL,
        messages,
        max_tokens: 4096,
        temperature: 0.1,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`DashScope 调用失败 (${res.status}): ${errText.slice(0, 300)}`)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }

    const text = data.choices?.[0]?.message?.content?.trim() ?? ''
    const promptTokens = data.usage?.prompt_tokens ?? 0
    const completionTokens = data.usage?.completion_tokens ?? 0

    return { text, promptTokens, completionTokens }
  } finally {
    clearTimeout(timer)
  }
}

// ── JSON 解析工具 ─────────────────────────────────────────────────────────────

function extractJsonArray(raw: string): string {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  return start >= 0 && end > start ? raw.slice(start, end + 1) : ''
}

function isTranslationArray(v: unknown): v is TranslationItem[] {
  if (!Array.isArray(v)) return false
  return v.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).id === 'string' &&
      typeof (item as Record<string, unknown>).zh === 'string',
  )
}

// ── 翻译单批 ──────────────────────────────────────────────────────────────────

/**
 * 翻译一批题目（~30 条），失败时退回模型自修重试一次
 * @param batch       本批题目
 * @param batchLabel  日志标识
 * @returns           翻译结果 + token 统计
 */
async function translateBatch(
  batch: QuestionRow[],
  batchLabel: string,
): Promise<{ items: TranslationItem[]; promptTokens: number; completionTokens: number }> {
  const userContent = JSON.stringify(
    batch.map((q) => ({ id: q.id, en: q.question_text })),
    null,
    2,
  )
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]

  // 第一次调用
  const r1 = await callDashScope(messages)
  console.log(
    `  ${batchLabel} 首次调用 — prompt:${r1.promptTokens} completion:${r1.completionTokens}`,
  )
  const json1 = extractJsonArray(r1.text)
  try {
    const parsed = JSON.parse(json1) as unknown
    if (isTranslationArray(parsed)) {
      return { items: parsed, promptTokens: r1.promptTokens, completionTokens: r1.completionTokens }
    }
  } catch {
    /* fall through to retry */
  }

  // 第一次解析失败 → 退回重试
  console.warn(`  ${batchLabel} JSON 解析失败，退回重试`, { preview: r1.text.slice(0, 120) })
  const retryMessages = [
    ...messages,
    { role: 'assistant', content: r1.text },
    { role: 'user', content: RETRY_FIX },
  ]
  const r2 = await callDashScope(retryMessages)
  const totalPrompt = r1.promptTokens + r2.promptTokens
  const totalCompletion = r1.completionTokens + r2.completionTokens
  console.log(
    `  ${batchLabel} 重试调用 — prompt:${r2.promptTokens} completion:${r2.completionTokens}`,
  )
  const json2 = extractJsonArray(r2.text)
  try {
    const parsed = JSON.parse(json2) as unknown
    if (isTranslationArray(parsed)) {
      return { items: parsed, promptTokens: totalPrompt, completionTokens: totalCompletion }
    }
  } catch {
    /* fall through */
  }

  // 重试仍失败 → 抛错（不静默降级，让脚本中止，避免写出空 SQL）
  throw new Error(`${batchLabel} 翻译失败（两次解析均无效）: ${r2.text.slice(0, 200)}`)
}

// ── SQL 生成 ──────────────────────────────────────────────────────────────────

/**
 * 将单引号转义为两个单引号（PostgreSQL 字符串字面量规范）
 * @param s  原始字符串
 * @returns  转义后可安全嵌入 SQL 单引号字面量的字符串
 */
function escapeSqlStr(s: string): string {
  return s.replace(/'/g, "''")
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═'.repeat(64))
  console.log('  retranslate-part1-zh — Part 1 question_text_zh 重译脚本')
  console.log('═'.repeat(64))

  // ── Step 1: Supabase 读取 ─────────────────────────────────────────────────
  // 用 service_role 直连（绕 RLS 只读 questions），【不再 signInAnonymously】：
  // 本脚本纯读、且不验证任何 RLS 语义，此前的匿名登录只是为了拿一个 authenticated 角色，
  // 代价却是每跑一次就在生产 auth.users 里留下一个与真实用户无法区分的匿名账号。
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 环境变量')
  }

  const sb: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  console.log('\n[Step 1] 连接 Supabase（service_role，只读）…')
  console.log('  ✅ 已连接')

  console.log('\n[Step 2] 读取 Part 1 / question_text_zh 非 null 的题目…')
  const { data: rows, error: fetchErr } = await sb
    .from('questions')
    .select('id, question_text, question_text_zh')
    .eq('part', 1)
    .not('question_text_zh', 'is', null)
    .order('id')

  if (fetchErr) throw new Error(`读取题目失败：${fetchErr.message}`)
  const questions = (rows ?? []) as QuestionRow[]
  console.log(`  ✅ 读到 ${questions.length} 行`)

  if (questions.length === 0) {
    console.log('  没有需要重译的行，脚本结束。')
    return
  }

  // ── Step 3: 批量翻译 ──────────────────────────────────────────────────────
  const batchCount = Math.ceil(questions.length / BATCH_SIZE)
  console.log(`\n[Step 3] 分 ${batchCount} 批翻译（每批 ≤${BATCH_SIZE} 条）…`)

  const translationMap = new Map<string, string>()
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let translatedCount = 0

  for (let i = 0; i < batchCount; i++) {
    const batch = questions.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
    const label = `[批次 ${i + 1}/${batchCount}, ${batch.length} 条]`
    console.log(`\n  ${label}`)

    const { items, promptTokens, completionTokens } = await translateBatch(batch, label)

    totalPromptTokens += promptTokens
    totalCompletionTokens += completionTokens

    // 校对：模型返回的 id 必须是本批 id 的子集
    const batchIds = new Set(batch.map((q) => q.id))
    let matched = 0
    for (const item of items) {
      if (batchIds.has(item.id) && item.zh.trim().length > 0) {
        translationMap.set(item.id, item.zh.trim())
        matched++
      }
    }
    translatedCount += matched
    console.log(`  ✅ 收到 ${items.length} 条，有效匹配 ${matched} 条`)

    // 丢失条目提示（若模型漏了某些 id）
    const missing = batch.filter((q) => !translationMap.has(q.id)).map((q) => q.id)
    if (missing.length > 0) {
      console.warn(`  ⚠️  ${missing.length} 条未收到翻译: ${missing.slice(0, 5).join(', ')}`)
    }
  }

  console.log(`\n  翻译完成：${translatedCount}/${questions.length} 条有译文`)

  // ── Step 4: 生成产物 ──────────────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true })

  // — review JSON —
  const review: ReviewRow[] = questions.map((q) => ({
    id: q.id,
    en: q.question_text,
    old_zh: q.question_text_zh,
    new_zh: translationMap.get(q.id) ?? '（未译）',
  }))
  const reviewPath = join(OUT_DIR, 'part1-zh-review.json')
  writeFileSync(reviewPath, JSON.stringify(review, null, 2), 'utf-8')
  console.log(`\n[Step 4] review JSON → ${reviewPath}`)

  // — update SQL —
  const sqlLines: string[] = [
    '-- Part 1 question_text_zh 重译更新',
    `-- 生成时间：${new Date().toISOString()}`,
    `-- 共 ${translationMap.size} 条`,
    '',
  ]
  for (const [id, zh] of translationMap.entries()) {
    sqlLines.push(
      `UPDATE questions SET question_text_zh = '${escapeSqlStr(zh)}' WHERE id = '${id}';`,
    )
  }
  const sqlPath = join(OUT_DIR, 'part1-zh-update.sql')
  writeFileSync(sqlPath, sqlLines.join('\n') + '\n', 'utf-8')
  console.log(`         update SQL  → ${sqlPath}`)

  // — rollback SQL（用 old_zh 还原，作为 update.sql 的安全网）—
  const rollbackLines: string[] = [
    '-- Part 1 question_text_zh 回滚（还原到重译前的 old_zh）',
    `-- 生成时间：${new Date().toISOString()}`,
    `-- 共 ${review.length} 条`,
    '',
  ]
  for (const row of review) {
    rollbackLines.push(
      `UPDATE questions SET question_text_zh = '${escapeSqlStr(row.old_zh)}' WHERE id = '${row.id}';`,
    )
  }
  const rollbackPath = join(OUT_DIR, 'part1-zh-rollback.sql')
  writeFileSync(rollbackPath, rollbackLines.join('\n') + '\n', 'utf-8')
  console.log(`         rollback SQL → ${rollbackPath}`)

  // ── Step 5: 汇总统计 ──────────────────────────────────────────────────────
  const totalTokens = totalPromptTokens + totalCompletionTokens
  const estimatedCost =
    (totalPromptTokens / 1000) * COST_PER_1K_INPUT_CNY +
    (totalCompletionTokens / 1000) * COST_PER_1K_OUTPUT_CNY

  console.log('\n' + '─'.repeat(64))
  console.log('  汇总')
  console.log('─'.repeat(64))
  console.log(`  读取行数   : ${questions.length}`)
  console.log(`  翻译行数   : ${translatedCount}`)
  console.log(`  SQL 条数   : ${translationMap.size}（update）+ ${review.length}（rollback）`)
  console.log(`  总 token   : ${totalTokens}（prompt:${totalPromptTokens} / completion:${totalCompletionTokens}）`)
  console.log(`  估算成本   : ¥${estimatedCost.toFixed(4)} 人民币（qwen-flash 价格）`)
  console.log('')
}

main().catch((err: unknown) => {
  console.error('[致命错误]', err instanceof Error ? err.message : err)
  process.exit(1)
})
