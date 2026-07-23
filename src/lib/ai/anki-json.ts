/**
 * @module   ai/anki-json
 * @desc     Anki 侧【本地】JSON LLM 调用器 + 平衡括号解析 —— 只服务 Anki 分点式生成（part1/2 例句生成器
 *           anki-answer.ts、part3 例句静态化 pregen）。为什么不用共享 llm.ts 的 callLLMJson：
 *
 *   ⚠️ 双发 JSON 兜底（本模块存在的核心理由，diagnostician 2026-07-24 归因）：
 *      qwen 对 part2 富语料【约 28% 概率把 JSON 输出两遍】（紧凑版 + 美化版直接拼接）。共享 llm.ts 的
 *      extractJson 是「贪切」——indexOf('{') 到 lastIndexOf('}')，会跨两个对象拼成非法 JSON，首解析必失败、
 *      只能靠重试兜、极端判死信、白烧 token。本模块改用【字符串感知的平衡括号解析】(firstJsonValue)：
 *      depth 归零即止，双发只取【第一个完整值】，一次解析成功。绝不改共享 llm.ts —— 那是全站基础设施
 *      （ranking / analysis / extraction 都在用），改它要全站回归；双发是全站潜在问题，另行单独评估。
 *      故此处是【Anki 侧局部兜】，代价是与 llm.ts 的 transport/retry 有一份可控的重复（已知债、已记录）。
 *
 *   另一必要理由：part3 例句 prompt（与探针 SYSTEM_PART3 逐字同源）输出【裸数组】[{idx,en}]，而 callLLMJson
 *   的 extractJson 只切 {…}、不认顶层数组；本模块的 firstJsonValue 对象/数组都认，故 part3 也走这里。
 *
 *   本模块【不依赖 server-only】：不 import env，端点/密钥由调用方传入，故可被 pregen 脚本 import、
 *   且 firstJsonValue 是纯函数可单测。dashscope-only（Anki 两处生成都走 dashscope），不引入 anthropic 分支。
 * @author   LingoBridge
 * @created  2026-07-24
 */
import type { LLMUsage } from '@/lib/llm'

/** 校验/解析失败时退回给模型的默认整改要求（针对 qwen 最常见的「字符串值里未转义英文双引号」）。 */
const ANKI_JSON_RETRY_INSTRUCTION =
  '你上次的输出无法被解析为合法 JSON。请重新输出一份合法 JSON —— 字符串值内部如需引用一律改用中文引号「」，' +
  '绝不使用英文双引号；只输出 JSON 本身，前后不要任何说明文字，也不要 markdown 代码块，不要重复输出两遍。'

/** dashscope（OpenAI 兼容）单次调用配置。 */
export interface AnkiLLMCall {
  endpoint: string
  apiKey: string
  model: string
  temperature?: number
  maxTokens?: number
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
}

/** callAnkiLLMJson 选项：契约对齐 callLLMJson 的子集（dashscope + 平衡括号解析，无 fallback / anthropic）。 */
export interface CallAnkiLLMJsonOptions<T> {
  call: AnkiLLMCall
  /** 类型守卫 + schema 校验二合一；返回 false 视同解析失败，触发一轮「整批重问」。 */
  validate: (v: unknown) => v is T
  /** 单次调用超时，默认 30s。长输出场景按规模显式传值（对齐 callLLMJson 语义）。 */
  timeoutMs?: number
  /** 最多尝试几轮（含首发），默认 2（首发 + 1 次重问）。 */
  maxAttempts?: number
  /** 日志前缀，如 '[AnkiAnswer]'。 */
  label?: string
  /** 校验失败时退回给模型的整改要求；缺省用 ANKI_JSON_RETRY_INSTRUCTION。 */
  retryInstruction?: string
  /** 拿到模型真实 token 用量后的回调（累加各轮，成功时一次性回调）；模型没吐 usage 则不触发。 */
  onUsage?: (usage: LLMUsage) => void
}

/**
 * 取原始文本里【第一个完整的 JSON 值】（对象或数组），字符串感知。
 * ⚠️ 与探针 scripts/anki-probe/example-probe.mjs 的 firstJsonValue 同款兜法（应对 qwen 双发 JSON）：
 *    从首个 { 或 [ 开始平衡括号计数，忽略字符串字面量内部的括号，depth 归零处即第一个完整值的结尾。
 *    双发（{…}{…} 或 […][…]）只取首个；截断（不平衡）尽力返回剩余，交 JSON.parse 报错。
 * @param raw  模型原始输出（可能前后带废话 / markdown / 双发）
 * @returns    第一个完整 JSON 值的子串；无 { 也无 [ 时返回 ''
 */
export function firstJsonValue(raw: string): string {
  let depth = 0
  let inStr = false
  let esc = false
  let start = -1
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (start === -1) {
      if (c === '{' || c === '[') {
        start = i
        depth = 1
      }
      continue
    }
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return start === -1 ? '' : raw.slice(start) // 不平衡（截断）→ 尽力返回，交 JSON.parse 报错
}

/** dashscope 响应里取真实 token 用量；字段缺失/类型不对返回 null（让调用方回退估算，绝不把 undefined 当 0）。 */
function extractUsage(data: unknown): LLMUsage | null {
  const u = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage
  if (u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number') {
    return { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens }
  }
  return null
}

/** 单次原始调用（fetch + 独立超时 + 取文本/用量）。HTTP 非 2xx 抛错，交上层决定是否重发。 */
async function rawCall(
  call: AnkiLLMCall,
  messages: AnkiLLMCall['messages'],
  timeoutMs: number,
  label: string,
): Promise<{ text: string; usage: LLMUsage | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body: Record<string, unknown> = { model: call.model, messages }
    if (call.temperature !== undefined) body.temperature = call.temperature
    if (call.maxTokens !== undefined) body.max_tokens = call.maxTokens
    const res = await fetch(call.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${call.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`${label} LLM 调用失败（HTTP ${res.status}）`)
    const data: unknown = await res.json()
    const text =
      (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content?.trim() ?? ''
    return { text, usage: extractUsage(data) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 调用 dashscope 并解析其返回的 JSON（平衡括号取首个完整值），最多 maxAttempts 轮。
 * · 调用本身失败（超时/网络/HTTP）→ 若还有轮次则原样重发，否则抛。
 * · 解析或校验失败 → 把模型上轮输出连同整改要求追加进会话，整批重问。
 * 轮次用尽仍失败：抛错（无 fallback —— 上层 drain 有任务级重试、pregen 可重跑，故不在此降级）。
 * @param opts  dashscope 配置、类型守卫校验、可选超时/轮数/日志前缀/用量回调
 * @returns     校验通过的 T
 * @throws      调用失败或解析用尽重试
 * @sideEffect  发起网络请求
 */
export async function callAnkiLLMJson<T>(opts: CallAnkiLLMJsonOptions<T>): Promise<T> {
  const { call, validate } = opts
  const timeoutMs = opts.timeoutMs ?? 30_000
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2)
  const label = opts.label ?? '[AnkiLLM]'
  const retryInstruction = opts.retryInstruction ?? ANKI_JSON_RETRY_INSTRUCTION

  let messages = [...call.messages]
  // 真实用量跨轮累加（每轮生成都烧了 token），成功时一次性回调。
  const usageTotal: LLMUsage = { promptTokens: 0, completionTokens: 0 }
  let hasUsage = false

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw: string
    try {
      const rr = await rawCall(call, messages, timeoutMs, label)
      raw = rr.text
      if (rr.usage) {
        usageTotal.promptTokens += rr.usage.promptTokens
        usageTotal.completionTokens += rr.usage.completionTokens
        hasUsage = true
      }
    } catch (e) {
      // 瞬时抖动（超时/网络/5xx）：还有轮次则原样重发（不退避），否则抛。
      if (attempt < maxAttempts) {
        console.warn(`${label} 调用失败，原样重发（第 ${attempt + 1}/${maxAttempts} 轮）`)
        continue
      }
      throw e
    }

    const jsonText = firstJsonValue(raw)
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      parsed = undefined
    }
    if (parsed !== undefined && validate(parsed)) {
      if (hasUsage) opts.onUsage?.({ ...usageTotal })
      return parsed
    }
    // 解析/校验失败：把模型输出 + 整改要求追加，整批重问（保持与 callLLMJson 一致的自愈行为）。
    messages = [...messages, { role: 'assistant', content: raw }, { role: 'user', content: retryInstruction }]
  }
  throw new Error(`${label} 输出无法解析为合法 JSON（已试 ${maxAttempts} 轮）`)
}
