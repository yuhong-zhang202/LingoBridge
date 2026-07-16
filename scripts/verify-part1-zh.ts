/**
 * @module   verify-part1-zh
 * @desc     核对 Part 1 question_text_zh 重译质量：读 part1-zh-review.json，
 *           让千问 qwen-plus 逐条判断 new_zh 是否准确翻译了 en，把可疑项列出。
 *           只读，不写库，不改 review.json，不碰应用代码。
 *           运行：npx tsx --env-file=.env.local scripts/verify-part1-zh.ts
 * @author   LingoBridge
 * @created  2026-06-06
 *
 * 注意：src/lib/llm.ts 含 `import 'server-only'`（该包在 Next.js 之外无条件抛错），
 * 因此本脚本内联同等的 DashScope HTTP 调用逻辑，不 import callLLMJson。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// ── 路径 ──────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR    = join(__dirname, 'out')
const REVIEW_PATH  = join(OUT_DIR, 'part1-zh-review.json')
const VERIFY_PATH  = join(OUT_DIR, 'part1-zh-verify.json')

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface ReviewRow {
  id: string
  en: string
  old_zh: string
  new_zh: string
}

type Verdict = 'ok' | 'suspect'

interface VerifyItem {
  id: string
  verdict: Verdict
  issue: string
}

interface DashScopeResult {
  text: string
  promptTokens: number
  completionTokens: number
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const VERIFY_MODEL  = 'qwen-plus'
const BATCH_SIZE    = 20
const TIMEOUT_MS    = 60_000

const DASHSCOPE_BASE_URL =
  process.env.DASHSCOPE_BASE_URL ??
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'

// qwen-plus 估算成本（人民币 / 1K token）
const COST_PER_1K_INPUT_CNY  = 0.0008
const COST_PER_1K_OUTPUT_CNY = 0.002

// ── Prompt ────────────────────────────────────────────────────────────────────

const VERIFY_SYSTEM_PROMPT = `你是雅思口语题目翻译审核员。用户会给你一批条目，每条包含：
- id：题目唯一标识
- en：英文题目原文
- new_zh：该题目的中文翻译

你的任务：逐条判断 new_zh 是否准确、忠实地翻译了 en。

【判定标准——从严，只有完全对等才算 ok】
以下任一情况判为 suspect：
- 句子类型变了（英文是疑问句，中文变成陈述句；或反之）
- 问的主体/对象变了（英文问"你"，中文改成了"人们"；或问"朋友"变成"父母"）
- 关键动作或场景变了（如英文问"会游泳吗"，中文翻成"喜欢游泳吗"）
- 明显漏译一个关键限定词或时间状语（如 "when you were a child" 漏掉）
- 语义整体偏移，用这个中文答不了英文题

完全对等（语义相同、句型对应、没有漏关键成分）才判 ok；允许自然的中文表达差异（如语序调整、省略主语"你"等）。

【输出格式】只返回合法 JSON 数组，不要 markdown 代码块围栏，不要任何前后缀文字，字符串值内部禁止使用英文双引号：
[{"id":"...","verdict":"ok","issue":""},{"id":"...","verdict":"suspect","issue":"一句话说哪里不对"},...]
覆盖用户给出的全部 id，一个都不漏。issue 字段：ok 时留空字符串，suspect 时用一句中文说清具体偏差。`

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
        model: VERIFY_MODEL,
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
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }

    const text = data.choices?.[0]?.message?.content?.trim() ?? ''
    const promptTokens     = data.usage?.prompt_tokens     ?? 0
    const completionTokens = data.usage?.completion_tokens ?? 0

    return { text, promptTokens, completionTokens }
  } finally {
    clearTimeout(timer)
  }
}

// ── JSON 解析工具 ─────────────────────────────────────────────────────────────

function extractJsonArray(raw: string): string {
  const start = raw.indexOf('[')
  const end   = raw.lastIndexOf(']')
  return start >= 0 && end > start ? raw.slice(start, end + 1) : ''
}

function isVerifyArray(v: unknown): v is VerifyItem[] {
  if (!Array.isArray(v)) return false
  return v.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).id      === 'string' &&
      ((item as Record<string, unknown>).verdict === 'ok' ||
       (item as Record<string, unknown>).verdict === 'suspect') &&
      typeof (item as Record<string, unknown>).issue   === 'string',
  )
}

// ── 核对单批 ──────────────────────────────────────────────────────────────────

/**
 * 对一批条目做翻译核对，失败时退回模型自修重试一次
 * @param batch       本批 review 行
 * @param batchLabel  日志标识
 * @returns           核对结果 + token 统计
 */
async function verifyBatch(
  batch: ReviewRow[],
  batchLabel: string,
): Promise<{ items: VerifyItem[]; promptTokens: number; completionTokens: number }> {
  const userContent = JSON.stringify(
    batch.map((r) => ({ id: r.id, en: r.en, new_zh: r.new_zh })),
    null,
    2,
  )
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: VERIFY_SYSTEM_PROMPT },
    { role: 'user',   content: userContent },
  ]

  // 第一次调用
  const r1 = await callDashScope(messages)
  console.log(
    `  ${batchLabel} 首次调用 — prompt:${r1.promptTokens} completion:${r1.completionTokens}`,
  )
  const json1 = extractJsonArray(r1.text)
  try {
    const parsed = JSON.parse(json1) as unknown
    if (isVerifyArray(parsed)) {
      return { items: parsed, promptTokens: r1.promptTokens, completionTokens: r1.completionTokens }
    }
  } catch { /* fall through to retry */ }

  // 第一次解析失败 → 退回重试
  console.warn(`  ${batchLabel} JSON 解析失败，退回重试`, { preview: r1.text.slice(0, 120) })
  const retryMessages = [
    ...messages,
    { role: 'assistant', content: r1.text },
    { role: 'user',      content: RETRY_FIX },
  ]
  const r2 = await callDashScope(retryMessages)
  const totalPrompt     = r1.promptTokens + r2.promptTokens
  const totalCompletion = r1.completionTokens + r2.completionTokens
  console.log(
    `  ${batchLabel} 重试调用 — prompt:${r2.promptTokens} completion:${r2.completionTokens}`,
  )
  const json2 = extractJsonArray(r2.text)
  try {
    const parsed = JSON.parse(json2) as unknown
    if (isVerifyArray(parsed)) {
      return { items: parsed, promptTokens: totalPrompt, completionTokens: totalCompletion }
    }
  } catch { /* fall through */ }

  throw new Error(`${batchLabel} 核对失败（两次解析均无效）: ${r2.text.slice(0, 200)}`)
}

// ── 终端对齐打印 ──────────────────────────────────────────────────────────────

/** 截断超长字符串，末尾加 … */
function trunc(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═'.repeat(72))
  console.log('  verify-part1-zh — Part 1 question_text_zh 翻译核对脚本')
  console.log('═'.repeat(72))

  // ── 读取 review.json ──────────────────────────────────────────────────────
  let rows: ReviewRow[]
  try {
    const raw = readFileSync(REVIEW_PATH, 'utf-8')
    rows = JSON.parse(raw) as ReviewRow[]
  } catch (e) {
    throw new Error(`读取 ${REVIEW_PATH} 失败：${e instanceof Error ? e.message : e}`)
  }
  console.log(`\n读取 ${REVIEW_PATH}：${rows.length} 条`)

  // ── 批量核对 ──────────────────────────────────────────────────────────────
  const batchCount = Math.ceil(rows.length / BATCH_SIZE)
  console.log(`分 ${batchCount} 批核对（每批 ≤${BATCH_SIZE} 条，模型：${VERIFY_MODEL}）\n`)

  const allResults: VerifyItem[] = []
  let totalPromptTokens     = 0
  let totalCompletionTokens = 0

  for (let i = 0; i < batchCount; i++) {
    const batch = rows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
    const label = `[批次 ${i + 1}/${batchCount}, ${batch.length} 条]`
    console.log(`  ${label}`)

    const { items, promptTokens, completionTokens } = await verifyBatch(batch, label)

    totalPromptTokens     += promptTokens
    totalCompletionTokens += completionTokens

    // 校验：模型必须覆盖本批所有 id
    const batchIds   = new Set(batch.map((r) => r.id)  )
    const returnedIds = new Set(items.map((it) => it.id))
    const missing = [...batchIds].filter((id) => !returnedIds.has(id))
    if (missing.length > 0) {
      console.warn(`  ⚠️  ${missing.length} 条未收到判定，补为 suspect: ${missing.slice(0, 3).join(', ')}`)
      for (const id of missing) {
        items.push({ id, verdict: 'suspect', issue: '（模型未返回判定，需人工复核）' })
      }
    }

    allResults.push(...items)
    const suspects = items.filter((it) => it.verdict === 'suspect').length
    console.log(`  ✅ 收到 ${items.length} 条，suspect ${suspects} 条\n`)
  }

  // ── 保存 verify.json ──────────────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(VERIFY_PATH, JSON.stringify(allResults, null, 2), 'utf-8')

  // ── 汇总打印 ──────────────────────────────────────────────────────────────
  const okList      = allResults.filter((it) => it.verdict === 'ok')
  const suspectList = allResults.filter((it) => it.verdict === 'suspect')

  // 用 review 建 id → row 的查找表，方便打印 en / new_zh
  const reviewMap = new Map(rows.map((r) => [r.id, r]))

  console.log('─'.repeat(72))
  console.log(`  总览：共 ${allResults.length} 条，ok ${okList.length} 条，suspect ${suspectList.length} 条`)
  console.log('─'.repeat(72))

  if (suspectList.length === 0) {
    console.log('\n  ✅ 全部通过，无可疑项\n')
  } else {
    console.log('\n  ⚠️  可疑项列表（需人工复核）：\n')
    // 列宽
    const COL_ID    = 38
    const COL_EN    = 46
    const COL_ZH    = 32
    const COL_ISSUE = 36
    const header =
      'id'.padEnd(COL_ID) +
      'en'.padEnd(COL_EN) +
      'new_zh'.padEnd(COL_ZH) +
      'issue'
    console.log('  ' + header)
    console.log('  ' + '─'.repeat(COL_ID + COL_EN + COL_ZH + COL_ISSUE))

    for (const item of suspectList) {
      const row = reviewMap.get(item.id)
      const en     = trunc(row?.en     ?? '', COL_EN    - 2)
      const new_zh = trunc(row?.new_zh ?? '', COL_ZH    - 2)
      const issue  = trunc(item.issue  ?? '', COL_ISSUE - 2)
      console.log(
        '  ' +
        item.id.padEnd(COL_ID) +
        en.padEnd(COL_EN) +
        new_zh.padEnd(COL_ZH) +
        issue,
      )
    }
    console.log('')
  }

  // token 与成本
  const totalTokens   = totalPromptTokens + totalCompletionTokens
  const estimatedCost =
    (totalPromptTokens     / 1000) * COST_PER_1K_INPUT_CNY +
    (totalCompletionTokens / 1000) * COST_PER_1K_OUTPUT_CNY

  console.log('─'.repeat(72))
  console.log(`  verify.json → ${VERIFY_PATH}`)
  console.log(`  总 token    : ${totalTokens}（prompt:${totalPromptTokens} / completion:${totalCompletionTokens}）`)
  console.log(`  估算成本    : ¥${estimatedCost.toFixed(4)} 人民币（qwen-plus 价格）`)
  console.log('')
}

main().catch((err: unknown) => {
  console.error('[致命错误]', err instanceof Error ? err.message : err)
  process.exit(1)
})
