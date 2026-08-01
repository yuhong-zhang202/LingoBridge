/**
 * @module   llm
 * @desc     统一的 LLM JSON 调用层：封装 Anthropic / DashScope 两种 provider 的请求、
 *           文本提取、JSON 花括号切片、解析+校验，以及一次"把坏 JSON 退回让模型自己修"
 *           的重试。供 extraction / analysis / practice(polish) / restructure 复用。
 *           coachReply 多轮纯文本不走这里。
 *           「原始输出留证」已抽到 lib/raw-log.ts（RAW_LOG_ENABLED 开关，默认关闭，与 ASR 留证共用同一
 *           入库路径，落进 llm_raw_logs / asr_raw_logs），供离线复盘模型输出。
 * @author   LingoBridge
 * @created  2026-06-04
 */
import 'server-only'
import { env } from '@/lib/env-server'
import { appendRawLog } from '@/lib/raw-log'

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'
// ⚠️ 必须与 extraction.ts/analysis.ts 现用的 anthropic-version 一致
const ANTHROPIC_VERSION = '2023-06-01'

const RETRY_FIX_INSTRUCTION =
  '你上次的输出无法被解析为合法 JSON。最常见原因是：JSON 字符串值内部出现了未转义的英文双引号 " 。' +
  '请重新输出一份合法 JSON——字符串值内部如需引用或强调，一律改用中文引号「」，绝不使用英文双引号；' +
  '并且只输出 JSON 本身，前后不要任何说明文字，也不要 markdown 代码块。'

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

/**
 * 模型返回的真实 token 用量（provider 无关的归一化形状）。
 * dashscope 的 prompt_tokens/completion_tokens、anthropic 的 input_tokens/output_tokens 统一映射到这里。
 */
export interface LLMUsage {
  promptTokens: number
  completionTokens: number
}

/** HTTP 非 2xx。带状态码，供失败事实分类用（裸 Error 分不出是 429 还是 500） */
class LLMHttpError extends Error {
  constructor(label: string, readonly status: number) {
    super(`${label} LLM 调用失败（${status}）`)
    this.name = 'LLMHttpError'
  }
}

/** 失败事实的分类：超时 / HTTP 非 2xx / 网络或其他 */
type LLMFailureKind = 'timeout' | 'http' | 'network'

/**
 * 归类一次调用失败的原因。
 * 不用 instanceof 判 AbortError：fetch 超时在 Node 里抛的是 DOMException，跨 runtime 不保证继承 Error。
 * @param e  catch 到的异常
 * @returns  失败类型 + HTTP 状态码（非 http 类为 null）
 */
function classifyFailure(e: unknown): { kind: LLMFailureKind; status: number | null } {
  if (e instanceof LLMHttpError) return { kind: 'http', status: e.status }
  const name = (e as { name?: unknown } | null)?.name
  if (name === 'AbortError' || name === 'TimeoutError') return { kind: 'timeout', status: null }
  return { kind: 'network', status: null }
}

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
  /** 仅 restructure / ranking 用：轮次用尽仍失败时不抛错、返回降级值。传了就不抛，不传就抛。收到最后一轮的 raw/jsonText */
  fallback?: (raw: string, jsonText: string) => T
  /**
   * 单次调用超时，默认 30s。
   * ⚠️ 30s 是给短输出定的。输出越长生成越久，长输出场景必须按规模显式传值，
   * 否则会在 fetch 层被 abort —— 一个字节都拿不到，fallback 的截断抢救也无从下手。
   */
  timeoutMs?: number
  /**
   * 最多尝试几轮（含首发），默认 2（= 首发 + 1 次重试，保持既有行为）。
   * 每轮都是「整批重问」：把完整原始请求 + 模型历次输出 + 整改要求一起发回去，
   * 让模型始终在同一批输入上横向比较。绝不改成只问失败的那几项——那会让模型看不到其余候选，
   * 换了把尺，引入无指标可测的偏差。
   */
  maxAttempts?: number
  /** 日志前缀，如 '[Extraction]' */
  label?: string
  /**
   * 校验失败时退回给模型的整改要求。缺省用 RETRY_FIX_INSTRUCTION（针对"JSON 语法坏了"）。
   * 若 validate 失败的真正原因是语义层（如 ranking 的 id↔题干对不上），务必传入贴合的指令，
   * 否则模型会被误导去修引号，白白浪费一次重试。
   */
  retryInstruction?: string
  /**
   * 拿到模型真实 token 用量后的回调（供 route 记真实账，替代写死常量估算）。
   * · 仅在拿到【真实】usage 时触发一次；模型没吐 usage 就不触发（调用方据此回退到估算）。
   * · 内部重试多轮时【累加各轮】用量再回调一次（不是只报最后一轮）——每轮生成都真实烧了 token。
   * · 不关心用量的调用点不传即可，零改动、零开销。
   */
  onUsage?: (usage: LLMUsage) => void
}

/**
 * 调用 LLM 并解析其返回的 JSON，最多 maxAttempts 轮（默认 2）。
 * 每轮两类失败各自处理：
 * · 调用本身失败（超时/网络/HTTP）→ 记录失败事实后原样重发，不退避；
 * · 解析或校验失败 → 把模型上轮输出连同整改要求追加进会话，整批重问。
 * 轮次用尽：有 fallback 则返回 fallback（收到【最后一轮】的 raw/jsonText），否则抛错。
 * @param opts  provider 配置、类型守卫校验、可选 fallback / 超时 / 轮数 / 日志前缀
 * @returns     校验通过的 T
 * @sideEffect  发起网络请求；失败/重试/超时时打印 warn/error 日志；
 *              RAW_LOG_ENABLED=1 时把每轮 prompt 与原始输出入库（llm_raw_logs）
 */
export async function callLLMJson<T>(opts: CallLLMJsonOptions<T>): Promise<T> {
  const { call, validate, fallback } = opts
  const timeoutMs = opts.timeoutMs ?? 30_000
  const label = opts.label ?? '[LLM]'

  /** 本次请求送出的字符量（anthropic 的 system 走顶层字段，不在 messages 里，得单独加） */
  function inputChars(messages: Msg[]): number {
    const body = messages.reduce((n, m) => n + m.content.length, 0)
    return body + (call.provider === 'anthropic' ? call.system.length : 0)
  }

  /**
   * 从原始响应体里取真实 token 用量（按 provider 取不同字段名）。字段缺失/类型不对一律返回 null，
   * 让调用方回退到估算——绝不把 undefined 当 0 记账污染成本看板。
   * @param data  已 json() 的原始响应
   * @returns     归一化用量或 null
   */
  function extractUsage(data: unknown): LLMUsage | null {
    if (call.provider === 'anthropic') {
      const u = (data as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage
      if (u && typeof u.input_tokens === 'number' && typeof u.output_tokens === 'number') {
        return { promptTokens: u.input_tokens, completionTokens: u.output_tokens }
      }
      return null
    }
    const u = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage
    if (u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number') {
      return { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens }
    }
    return null
  }

  // 单次原始调用（按 provider 取文本 + 真实用量），各自带独立超时
  async function rawCall(messages: Msg[], attempt: number): Promise<{ text: string; usage: LLMUsage | null }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = Date.now()
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
        if (!res.ok) throw new LLMHttpError(label, res.status)
        const data: unknown = await res.json()
        const blocks =
          (data as { content?: Array<{ type?: string; text?: string }> }).content ?? []
        const text = blocks.find((b) => b.type === 'text')?.text?.trim() ?? ''
        return { text, usage: extractUsage(data) }
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
        if (!res.ok) throw new LLMHttpError(label, res.status)
        const data: unknown = await res.json()
        const text =
          (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
            ?.message?.content?.trim() ?? ''
        return { text, usage: extractUsage(data) }
      }
    } catch (e) {
      // 失败事实必须永远留证，与 RAW_LOG_ENABLED（留证入库、opt-in）无关：
      // 原先这里只有 finally，异常直接抛穿，下游 record() 根本没机会执行，
      // 超时因此在日志里完全隐形——这正是 6 个大候选故事全挂却无人察觉的直接原因。
      // 记录后原样重抛：不吞、不改变既有控制流。字段结构化，为以后接监控留口子。
      const { kind, status } = classifyFailure(e)
      console.error(`${label} LLM 调用失败`, {
        service: label,
        provider: call.provider,
        model: call.model,
        attempt,
        kind,
        status,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        inputChars: inputChars(messages),
        message: e instanceof Error ? e.message : String(e),
      })
      throw e
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

  // 默认只打长度，避免模型输出（可能含故事片段）泄漏到日志；env.llmDebug 为 true 时再带完整内容。
  // ⚠️ env.llmDebug 在生产环境【恒为 false】（见 env-server.ts），不靠任何人记得关。
  //    此前这里直读 process.env.LLM_DEBUG，绕过 env 校验层。2026-07-17 加固。
  function logPayload(jsonText: string, raw: string): Record<string, unknown> {
    const base = { jsonTextLen: jsonText.length, rawLen: raw.length }
    return env.llmDebug ? { ...base, jsonText, raw } : base
  }

  // 每次尝试都留存原始输出（成功也留），否则「模型把 reason 贴错 id」这类语义错位事后无从复盘
  async function record(attempt: number, messages: Msg[], raw: string, jsonText: string, ok: boolean): Promise<void> {
    await appendRawLog({
      kind: 'llm',
      ts: new Date().toISOString(),
      label,
      provider: call.provider,
      model: call.model,
      attempt,
      system: call.provider === 'anthropic' ? call.system : null,
      messages,
      raw,
      jsonText,
      parsed: ok ? 'ok' : 'fail',
    })
  }

  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2)
  // 整批重问的会话：每轮把模型上轮输出 + 整改要求追加进去，让它看着自己的错改，
  // 且始终带着完整的原始输入（全部候选），尺子每轮都一样。
  let messages: Msg[] = call.messages
  let lastRaw = ''
  let lastJson = ''

  // 真实用量累加器：跨全部尝试轮次累加（每轮生成都烧了 token），末尾成功/fallback 时一次性回调。
  const usageTotal: LLMUsage = { promptTokens: 0, completionTokens: 0 }
  let hasUsage = false
  /** 把累加到的真实用量回调给调用方（仅在确有真实用量时触发，让调用方对无 usage 场景走估算） */
  function emitUsage(): void {
    if (hasUsage) opts.onUsage?.({ ...usageTotal })
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw: string
    try {
      const rr = await rawCall(messages, attempt)
      raw = rr.text
      if (rr.usage) {
        usageTotal.promptTokens += rr.usage.promptTokens
        usageTotal.completionTokens += rr.usage.completionTokens
        hasUsage = true
      }
    } catch (e) {
      // 瞬时抖动（超时 / 网络 / 5xx）：原样重发同样大小的请求，不做指数退避——
      // 退避治不了超时（重发的请求还是那么大、还是要那么久），它治的是抖动，而抖动重发即可。
      // 失败事实已由 rawCall 的 catch 记录，这里只决定还试不试。
      if (attempt < maxAttempts) {
        console.warn(`${label} 调用失败，原样重发（第 ${attempt + 1}/${maxAttempts} 轮）`)
        continue
      }
      throw e
    }

    const json = extractJson(raw)
    const r = parseValidate(json)
    await record(attempt, messages, raw, json, r.ok)
    if (r.ok) {
      emitUsage()
      return r.value
    }

    lastRaw = raw
    lastJson = json
    if (attempt < maxAttempts) {
      console.warn(
        `${label} JSON 解析/校验失败，退回模型整批重问（第 ${attempt + 1}/${maxAttempts} 轮）`,
        logPayload(json, raw),
      )
      messages = [
        ...messages,
        { role: 'assistant', content: raw },
        { role: 'user', content: opts.retryInstruction ?? RETRY_FIX_INSTRUCTION },
      ]
    }
  }

  // —— 轮次用尽 ——
  // 交给 fallback 的是【最后一轮】的产物：模型历经整改，末轮通常最接近正确；
  // 拿首轮去抢救等于把中间几轮的修正成果全扔了。
  if (fallback) {
    console.warn(`${label} 已用尽 ${maxAttempts} 轮仍未通过，使用 fallback`, logPayload(lastJson, lastRaw))
    emitUsage()
    return fallback(lastRaw, lastJson)
  }
  console.error(`${label} JSON 解析失败（已用尽 ${maxAttempts} 轮）`, logPayload(lastJson, lastRaw))
  throw new Error(`${label} JSON 解析失败（已重试）`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 流式原语（新增，与 callLLMJson 完全并列，互不影响）
// callLLMJson 是一次性缓冲（await res.json()），无法做「逐行到达即消费」。
// ranking 的单一总分路径按分降序逐行吐 NDJSON，可流式保序，故这里提供 DashScope 的 SSE 行级流式读取。
// 仅新增导出，不改动 callLLMJson 及其任何辅助。
// ─────────────────────────────────────────────────────────────────────────────

/** 流式 DashScope（OpenAI 兼容）调用配置：字段同 DashScopeCall 的请求要素 + 超时/日志/用量回调 */
export interface StreamDashScopeConfig {
  endpoint: string
  apiKey: string
  model: string
  messages: Msg[]
  temperature?: number
  maxTokens?: number
  /**
   * 单次流式调用超时，默认 30s。
   * ⚠️ 与 callLLMJson 同理：输出越长生成越久，长输出场景必须按规模显式传值，否则会在 fetch 层被 abort。
   */
  timeoutMs?: number
  /** 日志前缀，如 '[Ranking-Stream]' */
  label?: string
  /**
   * 末块 usage 回调（body 带 stream_options.include_usage=true 时，上游在结束前发一帧仅含 usage、choices 空）。
   * 仅在拿到【真实】usage 时触发；模型没吐就不触发，让调用方回退估算。
   */
  onUsage?: (usage: LLMUsage) => void
}

/**
 * 从一帧 SSE 事件里取真实 token 用量（DashScope 字段名）。字段缺失/类型不对一律返回 null。
 * 与 callLLMJson 内部的 extractUsage 同口径，但那是私有闭包，流式路独立实现一份、互不牵连。
 * @param evt  已 JSON.parse 的单帧 SSE 事件
 * @returns    归一化用量或 null
 */
function extractStreamUsage(evt: unknown): LLMUsage | null {
  const u = (evt as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } | null }).usage
  if (u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number') {
    return { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens }
  }
  return null
}

/**
 * 流式调用 DashScope，按模型输出文本里的换行【逐行】产出（async generator）。
 * 两层缓冲：
 *  1) SSE 帧缓冲——把字节流按 `\n` 切成 SSE 行，取 `data: {...}` 帧里的 choices[0].delta.content 追加到内容缓冲；
 *     `data: [DONE]` 为结束帧；半帧（尾段不完整）留到下次读取再拼。
 *  2) 内容缓冲——把 delta 累积出的模型文本按 `\n` 切出【完整行】yield；不完整尾段留到下次；
 *     流结束时把最后一段（无尾随换行的完整行）flush 出去。
 * 调用方对每行自行 JSON.parse + 校验；本原语只负责「把完整的一行交出来」，不理解行内内容。
 * @param cfg  endpoint/apiKey/model/messages/temperature/maxTokens + timeoutMs/label/onUsage
 * @yields     模型输出里的一整行文本（已 trim；空行跳过）
 * @sideEffect 发起流式网络请求；失败按 classifyFailure 归类后打 error 日志并重抛（与缓冲路同风格）
 */
export async function* streamDashScopeLines(cfg: StreamDashScopeConfig): AsyncGenerator<string, void, unknown> {
  const label = cfg.label ?? '[LLM-Stream]'
  const timeoutMs = cfg.timeoutMs ?? 30_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  try {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: cfg.messages,
      stream: true,
      // 让上游在结束前发一帧仅含 usage（否则流式模式默认不返回 usage）
      stream_options: { include_usage: true },
    }
    if (cfg.temperature !== undefined) body.temperature = cfg.temperature
    if (cfg.maxTokens !== undefined) body.max_tokens = cfg.maxTokens

    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) throw new LLMHttpError(label, res.status)
    if (!res.body) throw new Error(`${label} 流式响应无 body（上游可能不支持流式）`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let sseBuffer = ''      // SSE 字节流按行切分的缓冲
    let contentBuffer = ''  // delta.content 累积出的模型文本，按 \n 切 NDJSON 行

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      sseBuffer += decoder.decode(value, { stream: true })

      let nl: number
      while ((nl = sseBuffer.indexOf('\n')) >= 0) {
        const rawLine = sseBuffer.slice(0, nl)
        sseBuffer = sseBuffer.slice(nl + 1)
        const sseLine = rawLine.trim()
        if (sseLine === '' || sseLine.startsWith(':')) continue  // 空行 / SSE 注释
        if (!sseLine.startsWith('data:')) continue
        const payload = sseLine.slice('data:'.length).trim()
        if (payload === '[DONE]') continue  // 结束帧；剩余内容在循环外统一 flush
        let evt: unknown
        try {
          evt = JSON.parse(payload)
        } catch {
          continue  // 半帧或噪声，跳过（正常情况下 SSE 已按 \n 切完整）
        }
        const delta = (evt as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) {
          contentBuffer += delta
          let cnl: number
          while ((cnl = contentBuffer.indexOf('\n')) >= 0) {
            const contentLine = contentBuffer.slice(0, cnl).trim()
            contentBuffer = contentBuffer.slice(cnl + 1)
            if (contentLine !== '') yield contentLine
          }
        }
        const usage = extractStreamUsage(evt)
        if (usage) cfg.onUsage?.(usage)
      }
    }

    // 末尾 flush：模型已结束，contentBuffer 里若有剩余即最后一行完整内容（无尾随换行）
    const tail = contentBuffer.trim()
    if (tail !== '') yield tail
  } catch (e) {
    const { kind, status } = classifyFailure(e)
    console.error(`${label} 流式调用失败`, {
      service: label,
      provider: 'dashscope',
      model: cfg.model,
      kind,
      status,
      timeoutMs,
      elapsedMs: Date.now() - startedAt,
      message: e instanceof Error ? e.message : String(e),
    })
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 流式原始文本原语（新增，与 streamDashScopeLines 完全并列）
// streamDashScopeLines 面向 NDJSON「逐行」场景（ranking 单一总分按分降序逐行吐）。
// 分析是「单个 JSON 逐段冒」——不能按行切，须拿到未经切分的 delta 文本交给增量解析器。
// 故这里把「SSE 字节 → data 帧 → choices[0].delta.content」抽成新增私有生成器 readDashScopeDeltas，
// streamDashScopeText 从它 yield 原始 delta 文本块。
// ⚠️ 本阶段只增不改：streamDashScopeLines 保持自有实现字节不动，不 DRY 到 readDashScopeDeltas 上（未来再说）。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 私有：流式读取 DashScope 的 SSE，逐帧产出【原始 delta.content 文本块】（不按行、不按结构切分）。
 * 只做一层缓冲：把字节流按 `\n` 切成 SSE 行，取 `data: {...}` 帧里的 choices[0].delta.content 直接 yield；
 * `data: [DONE]` 为结束帧；半帧（尾段不完整）留到下次读取再拼。usage/超时/错误分类与 streamDashScopeLines 同口径。
 * 消费方（streamDashScopeText → 增量解析器）自行拼接与解析，本原语不理解块内内容。
 * @param cfg  endpoint/apiKey/model/messages/temperature/maxTokens + timeoutMs/label/onUsage
 * @yields     一帧的 delta.content 原始文本块（可能是半个 token；空块跳过）
 * @sideEffect 发起流式网络请求；失败按 classifyFailure 归类后打 error 日志并重抛
 */
async function* readDashScopeDeltas(cfg: StreamDashScopeConfig): AsyncGenerator<string, void, unknown> {
  const label = cfg.label ?? '[LLM-Stream]'
  const timeoutMs = cfg.timeoutMs ?? 30_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  try {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: cfg.messages,
      stream: true,
      // 让上游在结束前发一帧仅含 usage（否则流式模式默认不返回 usage）
      stream_options: { include_usage: true },
    }
    if (cfg.temperature !== undefined) body.temperature = cfg.temperature
    if (cfg.maxTokens !== undefined) body.max_tokens = cfg.maxTokens

    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) throw new LLMHttpError(label, res.status)
    if (!res.body) throw new Error(`${label} 流式响应无 body（上游可能不支持流式）`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let sseBuffer = ''  // SSE 字节流按行切分的缓冲

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      sseBuffer += decoder.decode(value, { stream: true })

      let nl: number
      while ((nl = sseBuffer.indexOf('\n')) >= 0) {
        const rawLine = sseBuffer.slice(0, nl)
        sseBuffer = sseBuffer.slice(nl + 1)
        const sseLine = rawLine.trim()
        if (sseLine === '' || sseLine.startsWith(':')) continue  // 空行 / SSE 注释
        if (!sseLine.startsWith('data:')) continue
        const payload = sseLine.slice('data:'.length).trim()
        if (payload === '[DONE]') continue  // 结束帧
        let evt: unknown
        try {
          evt = JSON.parse(payload)
        } catch {
          continue  // 半帧或噪声，跳过（正常情况下 SSE 已按 \n 切完整）
        }
        const delta = (evt as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) yield delta
        const usage = extractStreamUsage(evt)
        if (usage) cfg.onUsage?.(usage)
      }
    }
  } catch (e) {
    const { kind, status } = classifyFailure(e)
    console.error(`${label} 流式调用失败`, {
      service: label,
      provider: 'dashscope',
      model: cfg.model,
      kind,
      status,
      timeoutMs,
      elapsedMs: Date.now() - startedAt,
      message: e instanceof Error ? e.message : String(e),
    })
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 流式调用 DashScope，逐块产出模型输出的【原始文本】（async generator）。
 * 与 streamDashScopeLines 的区别：不按 `\n` 切行，原样吐出每一帧的 delta.content 文本块，
 * 供调用方（分析增量解析器）自行拼接、增量解析单个 JSON。超时/[DONE]/onUsage/错误分类沿用同口径。
 * @param cfg  与 streamDashScopeLines 相同的 StreamDashScopeConfig
 * @yields     模型输出的原始文本块（顺序、可能被 chunk 边界切断）
 * @sideEffect 发起流式网络请求；失败时打 error 日志并重抛（与 streamDashScopeLines 同风格）
 */
export async function* streamDashScopeText(cfg: StreamDashScopeConfig): AsyncGenerator<string, void, unknown> {
  for await (const delta of readDashScopeDeltas(cfg)) yield delta
}
