/**
 * @module   llm
 * @desc     统一的 LLM JSON 调用层：封装 Anthropic / DashScope 两种 provider 的请求、
 *           文本提取、JSON 花括号切片、解析+校验，以及一次"把坏 JSON 退回让模型自己修"
 *           的重试。供 extraction / analysis / practice(polish) / restructure 复用。
 *           coachReply 多轮纯文本不走这里。
 * @author   LingoBridge
 * @created  2026-06-04
 */
import 'server-only'

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'
// ⚠️ 必须与 extraction.ts/analysis.ts 现用的 anthropic-version 一致
const ANTHROPIC_VERSION = '2023-06-01'

const RETRY_FIX_INSTRUCTION =
  '你上次的输出无法被解析为合法 JSON。最常见原因是：JSON 字符串值内部出现了未转义的英文双引号 " 。' +
  '请重新输出一份合法 JSON——字符串值内部如需引用或强调，一律改用中文引号「」，绝不使用英文双引号；' +
  '并且只输出 JSON 本身，前后不要任何说明文字，也不要 markdown 代码块。'

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

/** Anthropic 调用配置（system 走顶层字段） */
export interface AnthropicCall {
  provider: 'anthropic'
  apiKey: string
  model: string
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens: number
}

/** DashScope（OpenAI 兼容）调用配置（system 由调用方拼进 messages[0]） */
export interface DashScopeCall {
  provider: 'dashscope'
  endpoint: string
  apiKey: string
  model: string
  messages: Msg[]
  temperature?: number
  maxTokens?: number
}

export type LLMCall = AnthropicCall | DashScopeCall

export interface CallLLMJsonOptions<T> {
  call: LLMCall
  /** 类型守卫 + schema 校验二合一；返回 false 视同解析失败，触发重试 */
  validate: (v: unknown) => v is T
  /** 仅 restructure 用：重试后仍失败时不抛错、返回降级值。传了就不抛，不传就抛 */
  fallback?: (raw: string, jsonText: string) => T
  /** 单次调用超时，默认 30s */
  timeoutMs?: number
  /** 日志前缀，如 '[Extraction]' */
  label?: string
}

/**
 * 调用 LLM 并解析其返回的 JSON。解析或校验失败时，把上次输出连同修复要求退回模型重试一次；
 * 重试仍失败：有 fallback 则返回 fallback（收到第一次的 raw/jsonText），否则抛错。
 * @param opts  provider 配置、类型守卫校验、可选 fallback / 超时 / 日志前缀
 * @returns     校验通过的 T
 * @sideEffect  发起网络请求；失败/重试时打印 warn/error 日志
 */
export async function callLLMJson<T>(opts: CallLLMJsonOptions<T>): Promise<T> {
  const { call, validate, fallback } = opts
  const timeoutMs = opts.timeoutMs ?? 30_000
  const label = opts.label ?? '[LLM]'

  // 单次原始调用（按 provider 取文本），各自带独立超时
  async function rawCall(messages: Msg[]): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      if (call.provider === 'anthropic') {
        const res = await fetch(ANTHROPIC_ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': call.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: call.model,
            max_tokens: call.maxTokens,
            system: call.system,
            messages,
          }),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`${label} LLM 调用失败（${res.status}）`)
        const data: unknown = await res.json()
        const blocks =
          (data as { content?: Array<{ type?: string; text?: string }> }).content ?? []
        return blocks.find((b) => b.type === 'text')?.text?.trim() ?? ''
      } else {
        const dsBody: Record<string, unknown> = { model: call.model, messages }
        if (call.temperature !== undefined) dsBody.temperature = call.temperature
        if (call.maxTokens !== undefined) dsBody.max_tokens = call.maxTokens
        const res = await fetch(call.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${call.apiKey}`,
          },
          body: JSON.stringify(dsBody),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`${label} LLM 调用失败（${res.status}）`)
        const data: unknown = await res.json()
        return (
          (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
            ?.message?.content?.trim() ?? ''
        )
      }
    } finally {
      clearTimeout(timer)
    }
  }

  // 花括号切片：对前后任意废话/markdown 健壮
  function extractJson(raw: string): string {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    return start >= 0 && end > start ? raw.slice(start, end + 1) : ''
  }

  function parseValidate(jsonText: string): { ok: true; value: T } | { ok: false } {
    try {
      const parsed: unknown = JSON.parse(jsonText)
      if (validate(parsed)) return { ok: true, value: parsed }
    } catch {
      /* 落到下面返回 ok:false */
    }
    return { ok: false }
  }

  // 默认只打长度，避免模型输出（可能含故事片段）泄漏到日志；LLM_DEBUG=1 时再带完整内容
  function logPayload(jsonText: string, raw: string): Record<string, unknown> {
    const base = { jsonTextLen: jsonText.length, rawLen: raw.length }
    return process.env.LLM_DEBUG === '1' ? { ...base, jsonText, raw } : base
  }

  // —— 第一次 ——
  const raw1 = await rawCall(call.messages)
  const json1 = extractJson(raw1)
  const r1 = parseValidate(json1)
  if (r1.ok) return r1.value

  // —— 退回让模型自己修，重试一次 ——
  console.warn(`${label} JSON 解析/校验失败，退回模型重试`, logPayload(json1, raw1))
  const retryMessages: Msg[] = [
    ...call.messages,
    { role: 'assistant', content: raw1 },
    { role: 'user', content: RETRY_FIX_INSTRUCTION },
  ]
  const raw2 = await rawCall(retryMessages)
  const json2 = extractJson(raw2)
  const r2 = parseValidate(json2)
  if (r2.ok) return r2.value

  // —— 重试仍失败 ——
  if (fallback) {
    console.warn(`${label} 重试后仍失败，使用 fallback`, logPayload(json1, raw1))
    return fallback(raw1, json1)
  }
  console.error(`${label} JSON 解析失败（已重试）`, logPayload(json2, raw2))
  throw new Error(`${label} JSON 解析失败（已重试）`)
}
