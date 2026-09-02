/**
 * @module   scheme3-dashscope
 * @desc     方案三北京 DashScope 的单次 Embedding/Ranking 适配器；严格协议、零 retry/repair/fallback。
 * @author   LingoBridge
 * @created  2026-09-02
 */
import 'server-only'
import type { LLMUsage } from '@/lib/llm'
import type {
  Scheme3ModelCallResult,
  Scheme3RankingCandidate,
  Scheme3RuntimeDependencies,
} from '@/services/scheme3-matching'

const BEIJING_HOST = 'dashscope.aliyuncs.com'
const REQUEST_TIMEOUT_MS = 120_000
const SCORE_TOOL_NAME = 'submit_scores'
const SCORE_KEYS = Array.from({ length: 20 }, (_, index) => `s${String(index).padStart(2, '0')}`)

export interface Scheme3TransportCapture {
  operation: 'embedding' | 'ranking'
  status: number
  requestId: string | null
  latencyMs: number
  raw: string
  response: unknown | null
  usage: LLMUsage | null
}

export interface Scheme3DashScopeOptions {
  apiKey: string
  baseUrl: string
  fetcher?: typeof fetch
  onTransportCapture?: (capture: Scheme3TransportCapture) => void | Promise<void>
}

function endpoint(baseUrl: string, suffix: 'embedding' | 'ranking'): string {
  const url = new URL(baseUrl)
  if (url.protocol !== 'https:' || url.hostname !== BEIJING_HOST) {
    throw new Error('方案三只允许北京 DashScope HTTPS endpoint')
  }
  if (suffix === 'embedding') {
    return `${url.origin}/api/v1/services/embeddings/text-embedding/text-embedding`
  }
  return `${url.origin}/compatible-mode/v1/chat/completions`
}

function usageFrom(value: unknown): LLMUsage | null {
  const usage = (value as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } } | null)?.usage
  if (!usage) return null
  if (typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
    return { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens }
  }
  if (typeof usage.total_tokens === 'number') return { promptTokens: usage.total_tokens, completionTokens: 0 }
  return null
}

/**
 * 严格解析 submit_scores.arguments；只接受 s00—s19 恰好20键与0—100整数。
 * @param  raw  唯一 tool call 的 function.arguments 原文
 * @returns     与冻结候选位置一一绑定的20个分数
 * @throws      任何包装、额外字段、类型/范围/长度错误均拒绝
 */
export function parseScheme3ScoreArguments(raw: string): number[] {
  const value = JSON.parse(raw) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('方案三 submit_scores arguments 根必须是对象')
  }
  const record = value as Record<string, unknown>
  const actualKeys = Object.keys(record).sort()
  if (actualKeys.length !== SCORE_KEYS.length || actualKeys.some((key, index) => key !== SCORE_KEYS[index])) {
    throw new Error('方案三 submit_scores 必须恰好包含 s00—s19')
  }
  const scores = SCORE_KEYS.map((key) => record[key])
  if (!scores.every((score) => Number.isInteger(score) && (score as number) >= 0 && (score as number) <= 100)) {
    throw new Error('方案三 Ranking 分数必须是0—100整数')
  }
  return scores as number[]
}

function scoreTool(): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: SCORE_TOOL_NAME,
      description: '提交二十道冻结候选题的匹配分数。',
      parameters: {
        type: 'object',
        properties: Object.fromEntries(SCORE_KEYS.map((key, index) => [key, {
          type: 'integer', minimum: 0, maximum: 100, description: `候选i=${index}的分数`,
        }])),
        required: SCORE_KEYS,
        additionalProperties: false,
      },
    },
  }
}

function rankingScoresFrom(value: unknown): number[] {
  const choices = (value as { choices?: unknown } | null)?.choices
  if (!Array.isArray(choices) || choices.length !== 1) throw new Error('方案三 Ranking 必须恰好返回一个 choice')
  const toolCalls = (choices[0] as { message?: { tool_calls?: unknown } } | null)?.message?.tool_calls
  if (!Array.isArray(toolCalls) || toolCalls.length !== 1) {
    throw new Error('方案三 Ranking 必须恰好返回一个 tool call')
  }
  const functionCall = (toolCalls[0] as { function?: { name?: unknown; arguments?: unknown } } | null)?.function
  if (functionCall?.name !== SCORE_TOOL_NAME || typeof functionCall.arguments !== 'string') {
    throw new Error('方案三 Ranking tool call 名称或 arguments 不合法')
  }
  return parseScheme3ScoreArguments(functionCall.arguments)
}

function embeddingFrom(value: unknown, dimensions: number): number[] {
  const vector = (value as { output?: { embeddings?: Array<{ embedding?: unknown }> } } | null)?.output?.embeddings?.[0]?.embedding
  if (!Array.isArray(vector)
    || vector.length !== dimensions
    || !vector.every((number) => typeof number === 'number' && Number.isFinite(number))) {
    throw new Error('方案三 Embedding 响应向量不合法')
  }
  return vector
}

async function postOnce<T>(options: {
  operation: 'embedding' | 'ranking'
  url: string
  apiKey: string
  body: Record<string, unknown>
  fetcher: typeof fetch
  onTransportCapture?: Scheme3DashScopeOptions['onTransportCapture']
  parse: (value: unknown) => T
}): Promise<Scheme3ModelCallResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()
  try {
    const response = await options.fetcher(options.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body),
      signal: controller.signal,
    })
    const raw = await response.text()
    const latencyMs = Date.now() - startedAt
    let responseValue: unknown | null = null
    try { responseValue = JSON.parse(raw) as unknown } catch { /* 原文照样先 capture，随后 fail-closed。 */ }
    const usage = usageFrom(responseValue)
    // 完整 HTTP 体、tool_calls/arguments（均在 responseValue）、request-id 与 usage 先交给留证口，再做协议校验。
    await options.onTransportCapture?.({
      operation: options.operation,
      status: response.status,
      requestId: response.headers.get('x-request-id'),
      latencyMs,
      raw,
      response: responseValue,
      usage,
    })
    if (!response.ok) throw new Error(`方案三 ${options.operation} HTTP ${response.status}`)
    if (responseValue === null) throw new Error(`方案三 ${options.operation} HTTP response 不是合法JSON`)
    return { value: options.parse(responseValue), usage, latencyMs }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 创建方案三北京 DashScope 生产适配器。
 * @param  options  密钥、北京 base URL、可选测试 fetch 与原始留证回调
 * @returns         单次调用、无修复/重试/降级的运行时依赖
 */
export function createScheme3DashScopeRuntime(options: Scheme3DashScopeOptions): Scheme3RuntimeDependencies {
  if (!options.apiKey) throw new Error('方案三缺少 DASHSCOPE_API_KEY')
  const fetcher = options.fetcher ?? fetch
  const embeddingUrl = endpoint(options.baseUrl, 'embedding')
  const rankingUrl = endpoint(options.baseUrl, 'ranking')
  return {
    embedStory: async (story, model, dimensions) => postOnce({
      operation: 'embedding',
      url: embeddingUrl,
      apiKey: options.apiKey,
      fetcher,
      onTransportCapture: options.onTransportCapture,
      body: {
        model,
        input: { texts: [story] },
        parameters: { text_type: 'query', dimension: dimensions, output_type: 'dense' },
      },
      parse: (value) => embeddingFrom(value, dimensions),
    }),
    rank: async ({ story, model, systemPrompt, candidates }) => postOnce({
      operation: 'ranking',
      url: rankingUrl,
      apiKey: options.apiKey,
      fetcher,
      onTransportCapture: options.onTransportCapture,
      body: {
        model,
        temperature: 0,
        max_tokens: 4096,
        tools: [scoreTool()],
        tool_choice: { type: 'function', function: { name: SCORE_TOOL_NAME } },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `【故事】\n${story}\n\n【候选题】\n${JSON.stringify(candidatesForTransport(candidates))}` },
        ],
      },
      parse: rankingScoresFrom,
    }),
  }
}

function candidatesForTransport(candidates: Scheme3RankingCandidate[]): Array<{ en: string; key: string }> {
  return candidates.map((candidate) => ({ en: candidate.en, key: candidate.key }))
}
