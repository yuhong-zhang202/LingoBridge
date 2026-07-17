/**
 * @module   llm.test
 * @desc     callLLMJson 的失败面测试 —— 超时/网络/HTTP 失败事实必须被记录且异常重抛（不许吞）、
 *           瞬时抖动原样重发、校验失败整批重问最多 N 轮、轮次用尽走 fallback 拿最后一轮产物。
 *           全部在 fetch 层 mock，不发真实请求。
 * @author   LingoBridge
 * @created  2026-07-16
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/env-server', () => ({
  env: { dashscopeApiKey: 'k', dashscopeBaseUrl: 'https://example.invalid/v1', rawLogEnabled: false },
}))

import { callLLMJson, type LLMCall } from '@/lib/llm'

type Shape = { ok: string }
const isShape = (v: unknown): v is Shape =>
  typeof v === 'object' && v !== null && typeof (v as { ok?: unknown }).ok === 'string'

const CALL: LLMCall = {
  provider: 'dashscope',
  endpoint: 'https://example.invalid/v1/chat/completions',
  apiKey: 'k',
  model: 'qwen-plus',
  messages: [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: '【候选题】q1..q35 的完整原始输入' },
  ],
  temperature: 0,
  maxTokens: 4096,
}

/** 造一个 DashScope 成功响应，content 为给定原始文本 */
function reply(content: string): { ok: true; json: () => Promise<unknown> } {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) }
}

/** fetch 超时抛的是 DOMException（name=AbortError），不保证继承 Error */
function abortError(): unknown {
  return { name: 'AbortError', message: 'This operation was aborted' }
}

let fetchMock: jest.Mock

beforeEach(() => {
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  jest.restoreAllMocks()
})

/** 取出第 n 次 fetch 送出的 messages */
function sentMessages(n: number): { role: string; content: string }[] {
  const body = JSON.parse(fetchMock.mock.calls[n][1].body as string) as {
    messages: { role: string; content: string }[]
  }
  return body.messages
}

describe('callLLMJson · 失败事实必须留证且重抛（不许吞）', () => {
  test('1. 超时：记录 kind=timeout + 输入规模 + 超时预算，然后重抛', async () => {
    fetchMock.mockRejectedValue(abortError())

    await expect(
      callLLMJson<Shape>({ call: CALL, validate: isShape, label: '[Ranking]', timeoutMs: 67_500, maxAttempts: 1 }),
    ).rejects.toMatchObject({ name: 'AbortError' })  // 异常原样抛出，没被吞成 undefined

    expect(console.error).toHaveBeenCalledWith(
      '[Ranking] LLM 调用失败',
      expect.objectContaining({
        service: '[Ranking]',
        kind: 'timeout',
        status: null,
        timeoutMs: 67_500,
        attempt: 1,
        model: 'qwen-plus',
        inputChars: 'SYS'.length + '【候选题】q1..q35 的完整原始输入'.length,
      }),
    )
  })

  test('2. HTTP 非 2xx：记录 kind=http 且带状态码', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 })

    await expect(
      callLLMJson<Shape>({ call: CALL, validate: isShape, label: '[Ranking]', maxAttempts: 1 }),
    ).rejects.toThrow('429')

    expect(console.error).toHaveBeenCalledWith(
      '[Ranking] LLM 调用失败',
      expect.objectContaining({ kind: 'http', status: 429 }),
    )
  })

  test('3. 网络错误：记录 kind=network', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(
      callLLMJson<Shape>({ call: CALL, validate: isShape, maxAttempts: 1 }),
    ).rejects.toThrow('fetch failed')

    expect(console.error).toHaveBeenCalledWith(
      '[LLM] LLM 调用失败',
      expect.objectContaining({ kind: 'network', status: null }),
    )
  })

  test('4. 默认 30s：不传 timeoutMs 时预算就是 30000（回归护栏，证明默认值仍是全局隐患）', async () => {
    fetchMock.mockRejectedValue(abortError())
    await expect(
      callLLMJson<Shape>({ call: CALL, validate: isShape, maxAttempts: 1 }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(console.error).toHaveBeenCalledWith(
      '[LLM] LLM 调用失败',
      expect.objectContaining({ timeoutMs: 30_000 }),
    )
  })

  test('5. 轮次全部抛错：最终抛出，不吞、不走 fallback', async () => {
    fetchMock.mockRejectedValue(abortError())
    const fallback = jest.fn(() => ({ ok: 'fallback' }))

    await expect(
      callLLMJson<Shape>({ call: CALL, validate: isShape, maxAttempts: 3, fallback }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fallback).not.toHaveBeenCalled()  // 一个字节都没拿到，无从抢救
  })
})

describe('callLLMJson · 瞬时抖动原样重发', () => {
  test('6. 首发抖动、次轮成功：原样重发同一批输入，不退避、不缩量', async () => {
    fetchMock
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(reply('{"ok":"yes"}'))

    const r = await callLLMJson<Shape>({ call: CALL, validate: isShape, maxAttempts: 3 })

    expect(r).toEqual({ ok: 'yes' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // 重发的 messages 与首发完全一致：同样大小、同样内容（抖动重发即可，无需改造请求）
    expect(sentMessages(1)).toEqual(sentMessages(0))
    expect(sentMessages(1)).toEqual(CALL.messages)
  })
})

describe('callLLMJson · 整批重问最多 N 轮', () => {
  const RETRY_INS = '整改要求：逐题核对'

  test('7. 校验失败 → 最多 3 轮，每轮都整批重问（完整原始输入始终在场）', async () => {
    fetchMock.mockResolvedValue(reply('{"bad":1}'))

    await expect(
      callLLMJson<Shape>({ call: CALL, validate: isShape, maxAttempts: 3, retryInstruction: RETRY_INS }),
    ).rejects.toThrow('JSON 解析失败')

    expect(fetchMock).toHaveBeenCalledTimes(3)

    // 第 2 轮 = 原始输入 + 模型上轮输出 + 整改要求
    expect(sentMessages(1)).toEqual([
      ...CALL.messages,
      { role: 'assistant', content: '{"bad":1}' },
      { role: 'user', content: RETRY_INS },
    ])
    // 第 3 轮 = 继续累积（模型看得到自己两轮的错），且原始候选输入一字未少
    expect(sentMessages(2)).toHaveLength(6)
    expect(sentMessages(2)[1]).toEqual(CALL.messages[1])   // 35 道候选原样还在 → 尺子没变
    expect(sentMessages(2).filter((m) => m.content === RETRY_INS)).toHaveLength(2)
  })

  test('8. 第 3 轮补上 → 成功返回（S022/S030 漏 1 道重问即补的复刻）', async () => {
    fetchMock
      .mockResolvedValueOnce(reply('{"bad":1}'))
      .mockResolvedValueOnce(reply('{"bad":2}'))
      .mockResolvedValueOnce(reply('{"ok":"finally"}'))

    const r = await callLLMJson<Shape>({ call: CALL, validate: isShape, maxAttempts: 3 })

    expect(r).toEqual({ ok: 'finally' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('9. 默认 maxAttempts=2：未显式传轮数的调用方行为不变（extraction/analysis 等）', async () => {
    fetchMock.mockResolvedValue(reply('{"bad":1}'))

    await expect(callLLMJson<Shape>({ call: CALL, validate: isShape })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('10. 轮次用尽 + fallback：拿到【最后一轮】的产物，而非首轮', async () => {
    fetchMock
      .mockResolvedValueOnce(reply('{"bad":"第一轮"}'))
      .mockResolvedValueOnce(reply('{"bad":"第二轮"}'))
      .mockResolvedValueOnce(reply('{"bad":"第三轮"}'))
    const fallback = jest.fn((raw: string) => ({ ok: raw }))

    const r = await callLLMJson<Shape>({ call: CALL, validate: isShape, maxAttempts: 3, fallback })

    // 末轮是模型历经整改后最接近正确的一版；拿首轮抢救等于扔掉中间两轮的修正
    expect(r).toEqual({ ok: '{"bad":"第三轮"}' })
    expect(fallback).toHaveBeenCalledWith('{"bad":"第三轮"}', '{"bad":"第三轮"}')
  })

  test('11. 首发即通过：不重问、不打 error（正常路径零回归）', async () => {
    fetchMock.mockResolvedValueOnce(reply('{"ok":"yes"}'))

    await expect(callLLMJson<Shape>({ call: CALL, validate: isShape, maxAttempts: 3 })).resolves.toEqual({ ok: 'yes' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(console.error).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
  })
})

/** 造一个带真实 usage 的 DashScope 成功响应 */
function replyWithUsage(content: string, promptTokens: number, completionTokens: number): { ok: true; json: () => Promise<unknown> } {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } }) }
}

describe('callLLMJson · 真实用量上抛（onUsage）', () => {
  test('12. 首发即通过：onUsage 收到该次真实 usage', async () => {
    fetchMock.mockResolvedValueOnce(replyWithUsage('{"ok":"yes"}', 123, 45))
    const onUsage = jest.fn()

    await callLLMJson<Shape>({ call: CALL, validate: isShape, onUsage })
    expect(onUsage).toHaveBeenCalledTimes(1)
    expect(onUsage).toHaveBeenCalledWith({ promptTokens: 123, completionTokens: 45 })
  })

  test('13. 内部重问多轮：onUsage 累加各轮用量（不是只报最后一轮）', async () => {
    // 第 1 轮坏 JSON（烧了 100/10）→ 整批重问 → 第 2 轮通过（烧了 200/20）。合计应为 300/30。
    fetchMock
      .mockResolvedValueOnce(replyWithUsage('{"bad":1}', 100, 10))
      .mockResolvedValueOnce(replyWithUsage('{"ok":"yes"}', 200, 20))
    const onUsage = jest.fn()

    await callLLMJson<Shape>({ call: CALL, validate: isShape, maxAttempts: 3, onUsage })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onUsage).toHaveBeenCalledTimes(1)
    expect(onUsage).toHaveBeenCalledWith({ promptTokens: 300, completionTokens: 30 })
  })

  test('14. 轮次用尽走 fallback：onUsage 仍报累加用量（fallback 也是花了钱的）', async () => {
    fetchMock
      .mockResolvedValueOnce(replyWithUsage('{"bad":1}', 50, 5))
      .mockResolvedValueOnce(replyWithUsage('{"bad":2}', 60, 6))
    const onUsage = jest.fn()

    await callLLMJson<Shape>({
      call: CALL, validate: isShape, maxAttempts: 2, onUsage,
      fallback: (raw) => ({ ok: raw }),
    })
    expect(onUsage).toHaveBeenCalledWith({ promptTokens: 110, completionTokens: 11 })
  })

  test('15. 模型没吐 usage：onUsage 不触发（调用方据此回退到估算）', async () => {
    fetchMock.mockResolvedValueOnce(reply('{"ok":"yes"}'))  // reply 不带 usage 字段
    const onUsage = jest.fn()

    await callLLMJson<Shape>({ call: CALL, validate: isShape, onUsage })
    expect(onUsage).not.toHaveBeenCalled()
  })

  test('16. 全程失败抛错：onUsage 不触发（没有可信的成功用量）', async () => {
    fetchMock.mockRejectedValue(abortError())
    const onUsage = jest.fn()

    await expect(
      callLLMJson<Shape>({ call: CALL, validate: isShape, maxAttempts: 2, timeoutMs: 100, onUsage }),
    ).rejects.toBeDefined()
    expect(onUsage).not.toHaveBeenCalled()
  })
})
