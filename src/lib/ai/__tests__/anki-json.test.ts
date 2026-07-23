/**
 * @module   ai/anki-json.test
 * @desc     Anki 侧本地 JSON 解析/调用器单测：核心是【双发 JSON 兜底】——firstJsonValue 平衡括号只取
 *           第一个完整值（qwen 对富语料约 28% 概率把 JSON 输出两遍，共享 llm.ts 贪切会拼成非法 JSON）；
 *           以及 callAnkiLLMJson 端到端在收到双发输出时能正确解析首个、并累加真实 usage。纯 mock fetch。
 * @author   LingoBridge
 * @created  2026-07-24
 */
import { firstJsonValue, callAnkiLLMJson } from '@/lib/ai/anki-json'

describe('firstJsonValue · 平衡括号取第一个完整 JSON 值', () => {
  it('单个对象：原样返回', () => {
    expect(firstJsonValue('{"a":1}')).toBe('{"a":1}')
  })

  it('双发对象（紧凑+美化拼接）：只取第一个（这是核心 bug 场景）', () => {
    const compact = '{"points":[{"idx":0,"en":"hi","noMaterial":false}]}'
    const pretty = '{\n  "points": [\n    { "idx": 0, "en": "hi", "noMaterial": false }\n  ]\n}'
    const out = firstJsonValue(compact + pretty)
    expect(out).toBe(compact)
    expect(() => JSON.parse(out)).not.toThrow()
  })

  it('双发裸数组（part3 契约）：只取第一个', () => {
    const first = '[{"idx":0,"en":"a"}]'
    const out = firstJsonValue(first + '[{"idx":0,"en":"a"}]')
    expect(out).toBe(first)
  })

  it('字符串字面量里的括号不干扰计数', () => {
    const s = '{"en":"a } b ] c { d ["}'
    expect(firstJsonValue(s)).toBe(s)
  })

  it('字符串里的转义引号不误判字符串结束', () => {
    const s = '{"en":"she said \\"hi\\" today"}'
    expect(firstJsonValue(s)).toBe(s)
  })

  it('前后有 markdown / 废话：仍取到第一个完整值', () => {
    const obj = '{"points":[]}'
    expect(firstJsonValue('```json\n' + obj + '\n```')).toBe(obj)
    expect(firstJsonValue('这是结果：' + obj + ' 完毕')).toBe(obj)
  })

  it('既无 { 也无 [：返回空串', () => {
    expect(firstJsonValue('no json here')).toBe('')
    expect(firstJsonValue('')).toBe('')
  })

  it('截断（不平衡）：尽力返回剩余，交 JSON.parse 报错', () => {
    const truncated = '{"points":[{"idx":0'
    const out = firstJsonValue(truncated)
    expect(out).toBe(truncated)
    expect(() => JSON.parse(out)).toThrow()
  })
})

// ── callAnkiLLMJson 端到端（mock 全局 fetch，不真调 DashScope）──

interface Envelope {
  points: { idx: number; en: string | null }[]
}
const isEnvelope = (v: unknown): v is Envelope =>
  typeof v === 'object' && v !== null && Array.isArray((v as { points?: unknown }).points)

/** 造一个 dashscope 成功响应（给定 content + usage）。 */
function fetchOk(content: string, usage?: { prompt_tokens: number; completion_tokens: number }): jest.Mock {
  return jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content } }], usage }),
    } as unknown as Response),
  )
}

const baseCall = {
  endpoint: 'https://example.invalid/v1/chat/completions',
  apiKey: 'k',
  model: 'qwen-plus',
  messages: [{ role: 'system' as const, content: 'sys' }, { role: 'user' as const, content: 'u' }],
}

describe('callAnkiLLMJson（mock fetch）', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('双发 JSON 输入 → 正确取首个、解析成功', async () => {
    const one = '{"points":[{"idx":0,"en":"hello there"}]}'
    global.fetch = fetchOk(one + one, { prompt_tokens: 12, completion_tokens: 8 }) as unknown as typeof fetch
    let reported: { promptTokens: number; completionTokens: number } | null = null
    const out = await callAnkiLLMJson<Envelope>({
      call: baseCall,
      validate: isEnvelope,
      onUsage: (u) => { reported = u },
    })
    expect(out.points).toEqual([{ idx: 0, en: 'hello there' }])
    expect(reported).toEqual({ promptTokens: 12, completionTokens: 8 })
  })

  it('首轮解析失败 → 整批重问，累加两轮 usage', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ choices: [{ message: { content: 'not json' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '{"points":[]}' } }], usage: { prompt_tokens: 15, completion_tokens: 3 } }) })
    global.fetch = fetchMock as unknown as typeof fetch
    let reported: { promptTokens: number; completionTokens: number } | null = null
    const out = await callAnkiLLMJson<Envelope>({
      call: baseCall,
      validate: isEnvelope,
      onUsage: (u) => { reported = u },
    })
    expect(out.points).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // 两轮 usage 累加
    expect(reported).toEqual({ promptTokens: 25, completionTokens: 5 })
  })

  it('用尽重试仍失败 → 抛错', async () => {
    global.fetch = fetchOk('still not json') as unknown as typeof fetch
    await expect(
      callAnkiLLMJson<Envelope>({ call: baseCall, validate: isEnvelope, maxAttempts: 2 }),
    ).rejects.toThrow(/无法解析为合法 JSON/)
  })
})
