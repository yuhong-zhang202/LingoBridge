/**
 * @module   scheme3-dashscope.test
 * @desc     方案三北京 DashScope 请求与20位严格 Ranking 协议变异测试；不发真实网络请求。
 * @author   LingoBridge
 * @created  2026-09-02
 */
jest.mock('server-only', () => ({}))

import {
  createScheme3DashScopeRuntime,
  parseScheme3ScoreArguments,
  type Scheme3TransportCapture,
} from '@/services/scheme3-dashscope'
import { createHash } from 'node:crypto'

const VALID_SCORES = Array.from({ length: 20 }, (_, index) => index)
const VALID_ARGUMENTS = Object.fromEntries(VALID_SCORES.map((score, index) => [
  `s${String(index).padStart(2, '0')}`, score,
]))
type FetchArgs = [input: string | URL | Request, init?: RequestInit]

function toolCall(name = 'submit_scores', args: unknown = VALID_ARGUMENTS): Record<string, unknown> {
  return { id: 'call-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

function rankingResponse(toolCalls: unknown, content: unknown = null): Record<string, unknown> {
  return {
    choices: [{ message: { content, tool_calls: toolCalls } }],
    usage: { prompt_tokens: 30, completion_tokens: 20 },
  }
}

describe('方案三 Ranking 严格协议', () => {
  test('只接受 s00—s19 恰好20个整数，并按键位机械映射', () => {
    expect(parseScheme3ScoreArguments(JSON.stringify(VALID_ARGUMENTS))).toEqual(VALID_SCORES)
  })

  test.each([
    ['漏键', Object.fromEntries(Object.entries(VALID_ARGUMENTS).slice(0, 19))],
    ['多键', { ...VALID_ARGUMENTS, extra: 1 }],
    ['字符串', { ...VALID_ARGUMENTS, s00: '1' }],
    ['小数', { ...VALID_ARGUMENTS, s00: 1.5 }],
    ['null', { ...VALID_ARGUMENTS, s00: null }],
    ['-1', { ...VALID_ARGUMENTS, s00: -1 }],
    ['101', { ...VALID_ARGUMENTS, s00: 101 }],
    ['root数组', VALID_SCORES],
  ])('%s 必须拒绝', (_label, value) => {
    expect(() => parseScheme3ScoreArguments(JSON.stringify(value))).toThrow()
  })

  test('Markdown 包裹必须拒绝，不做花括号截取或repair', () => {
    expect(() => parseScheme3ScoreArguments(`\`\`\`json\n${JSON.stringify(VALID_ARGUMENTS)}\n\`\`\``)).toThrow()
  })
})

describe('方案三 DashScope 生产适配器', () => {
  test('Embedding 固定北京query/1024，并在业务校验前移交raw元数据与usage/latency', async () => {
    const order: string[] = []
    const capture: Scheme3TransportCapture[] = []
    const vector = Array.from({ length: 1024 }, () => 0.25)
    const fetcher = jest.fn<Promise<Response>, FetchArgs>(async () => new Response(JSON.stringify({
      output: { embeddings: [{ embedding: vector }] },
      usage: { total_tokens: 12 },
    }), { status: 200, headers: { 'x-request-id': 'req-1' } })) as unknown as jest.MockedFunction<typeof fetch>
    const runtime = createScheme3DashScopeRuntime({
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      fetcher,
      onTransportCapture: (record) => { order.push('capture'); capture.push(record) },
    })

    const call = await runtime.embedStory('故事', 'text-embedding-v3', 1024)
    order.push('return')
    const request = fetcher.mock.calls[0]
    const body = JSON.parse(String((request[1] as RequestInit).body)) as Record<string, unknown>

    expect(String(request[0])).toBe('https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding')
    expect(body).toEqual({
      model: 'text-embedding-v3',
      input: { texts: ['故事'] },
      parameters: { text_type: 'query', dimension: 1024, output_type: 'dense' },
    })
    expect(order).toEqual(['capture', 'return'])
    expect(capture[0]).toEqual(expect.objectContaining({ operation: 'embedding', status: 200, requestId: 'req-1' }))
    expect(call.value).toHaveLength(1024)
    expect(call.usage).toEqual({ promptTokens: 12, completionTokens: 0 })
    expect(call.latencyMs).toBeGreaterThanOrEqual(0)
  })

  test('Ranking 强制唯一submit_scores且不发送index/id，完整response/tool_calls/usage先capture', async () => {
    const captures: Scheme3TransportCapture[] = []
    const fetcher = jest.fn<Promise<Response>, FetchArgs>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: null, tool_calls: [toolCall()] } }],
      usage: { prompt_tokens: 30, completion_tokens: 20 },
    }), { status: 200, headers: { 'x-request-id': 'rank-1' } })) as unknown as jest.MockedFunction<typeof fetch>
    const runtime = createScheme3DashScopeRuntime({
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      fetcher,
      onTransportCapture: (capture) => { captures.push(capture) },
    })

    const call = await runtime.rank({
      story: '故事',
      model: 'qwen-plus',
      systemPrompt: '冻结Prompt',
      candidates: Array.from({ length: 20 }, (_, index) => ({ en: `Q${index}`, key: `K${index}` })),
    })
    const body = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body)) as {
      response_format?: unknown
      tools: Array<{ function: { name: string; parameters: { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> } } }>
      tool_choice: unknown
      messages: Array<{ content: string }>
    }
    expect(body.response_format).toBeUndefined()
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'submit_scores' } })
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0].function.name).toBe('submit_scores')
    expect(body.tools[0].function.parameters.required).toEqual(Object.keys(VALID_ARGUMENTS))
    expect(body.tools[0].function.parameters.additionalProperties).toBe(false)
    expect(Object.keys(body.tools[0].function.parameters.properties)).toEqual(Object.keys(VALID_ARGUMENTS))
    expect(createHash('sha256').update(JSON.stringify(body.tools[0])).digest('hex')).toBe(
      '88b8bec1bbe3b722405ee17f0e3fcc87968cf9b068433ec24505e3874bb9dc11',
    )
    expect(body.messages[1].content).not.toContain('"index"')
    expect(body.messages[1].content).not.toContain('"id"')
    expect(call.value).toEqual(VALID_SCORES)
    expect(call.usage).toEqual({ promptTokens: 30, completionTokens: 20 })
    expect(captures[0]).toEqual(expect.objectContaining({
      operation: 'ranking', requestId: 'rank-1', usage: { promptTokens: 30, completionTokens: 20 },
      response: expect.objectContaining({ choices: expect.any(Array) }),
    }))
  })

  test.each([
    ['错函数', rankingResponse([toolCall('wrong_name')])],
    ['多tool call', rankingResponse([toolCall(), { ...toolCall(), id: 'call-2' }])],
    ['content-only', rankingResponse(undefined, JSON.stringify(VALID_ARGUMENTS))],
    ['漏键arguments', rankingResponse([toolCall('submit_scores', Object.fromEntries(Object.entries(VALID_ARGUMENTS).slice(0, 19)))])],
    ['多键arguments', rankingResponse([toolCall('submit_scores', { ...VALID_ARGUMENTS, extra: 1 })])],
    ['类型错误arguments', rankingResponse([toolCall('submit_scores', { ...VALID_ARGUMENTS, s00: '1' })])],
    ['范围错误arguments', rankingResponse([toolCall('submit_scores', { ...VALID_ARGUMENTS, s19: 101 })])],
  ])('%s：capture后严格拒绝', async (_label, responseValue) => {
    const capture = jest.fn()
    const fetcher = jest.fn<Promise<Response>, FetchArgs>(async () => new Response(
      JSON.stringify(responseValue), { status: 200 },
    )) as unknown as jest.MockedFunction<typeof fetch>
    const runtime = createScheme3DashScopeRuntime({
      apiKey: 'test-key', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', fetcher,
      onTransportCapture: capture,
    })
    await expect(runtime.rank({
      story: '故事', model: 'qwen-plus', systemPrompt: '冻结Prompt',
      candidates: Array.from({ length: 20 }, (_, index) => ({ en: `Q${index}`, key: `K${index}` })),
    })).rejects.toThrow()
    expect(capture).toHaveBeenCalledTimes(1)
  })

  test('国际站base URL直接拒绝，不发请求', () => {
    const fetcher = jest.fn() as jest.MockedFunction<typeof fetch>
    expect(() => createScheme3DashScopeRuntime({
      apiKey: 'test-key',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      fetcher,
    })).toThrow('北京 DashScope')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
