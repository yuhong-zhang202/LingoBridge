/**
 * @module   polish-fallback.test
 * @desc     polishSentence 降级契约单测：当 callLLMJson 解析用尽仍失败、走 fallback 时，
 *           polishSentence 必须返回诚实降级结果（needsWork:false + optimized 留空，不会写进优化历史），
 *           而非 throw→500→前端一律「优化失败」。守住修复不回退。LLM 调用全部 mock，不发真实请求。
 *           另附「必须显式给 timeoutMs / maxTokens」的护栏（输入上限放到 800 后，吃 30s 默认会被 abort）。
 * @author   LingoBridge
 * @created  2026-08-02
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/env-server', () => ({
  env: {
    dashscopeApiKey: 'test-key',
    dashscopeBaseUrl: 'https://example.invalid/v1',
    rawLogEnabled: false,
  },
}))
jest.mock('@/lib/llm')

import { polishSentence } from '@/services/practice'
import { callLLMJson } from '@/lib/llm'
import type { PolishResult } from '@/lib/types'

const mockCallLLMJson = callLLMJson as jest.MockedFunction<typeof callLLMJson>

describe('polishSentence 降级契约', () => {
  beforeEach(() => {
    mockCallLLMJson.mockReset()
  })

  it('解析失败走 fallback 时返回诚实降级结果、不 throw', async () => {
    // 模拟 llm 内部「用尽 maxAttempts 仍未通过校验 → 调 opts.fallback(末轮 raw, 末轮 jsonText)」
    mockCallLLMJson.mockImplementation((opts) => {
      if (!opts.fallback) throw new Error('polishSentence 必须给 callLLMJson 配 fallback')
      return Promise.resolve(opts.fallback('模型没吐合法 JSON', '不是 JSON'))
    })

    const result = (await polishSentence('I very like coffee')) as PolishResult

    // 不误报「已优化」：needsWork=false 且 optimized 留空（前端据此不写入优化历史）
    expect(result.needsWork).toBe(false)
    expect(result.optimized).toBe('')
    // note 为诚实、不吓人的降级文案（非空、非「优化失败」）
    expect(result.note.length).toBeGreaterThan(0)
    expect(result.note).not.toContain('优化失败')
  })

  it('正常解析成功时原样返回模型结果（不误触发 fallback）', async () => {
    const ok: PolishResult = { needsWork: true, optimized: 'I really enjoy a good coffee', note: '更地道' }
    mockCallLLMJson.mockResolvedValue(ok)

    const result = (await polishSentence('I very like coffee')) as PolishResult
    expect(result).toEqual(ok)
  })
})

// 输入上限从 500 放到 800 后，输出跟着变长。若谁删掉 timeoutMs/maxTokens 让本环节退回吃 llm.ts 的 30s 默认，
// 长句会在 fetch 层被 abort（一个字节都拿不到），用户要等满两轮才看到 fallback 的「请重试」——这里钉死不许退回。
describe('polishSentence 必须显式给超时与输出上限', () => {
  beforeEach(() => {
    mockCallLLMJson.mockReset()
    mockCallLLMJson.mockResolvedValue({ needsWork: false, optimized: '', note: '' } as PolishResult)
  })

  it('显式传了 timeoutMs 与 maxTokens（不吃 llm.ts 默认值）', async () => {
    await polishSentence('I very like coffee')
    const opts = mockCallLLMJson.mock.calls[0][0]
    expect(typeof opts.timeoutMs).toBe('number')
    expect(opts.timeoutMs).toBeGreaterThan(0)
    expect(opts.call.provider).toBe('dashscope')
    expect(opts.call.maxTokens).toBeGreaterThanOrEqual(1024)
  })

  it('超时预算随输入规模增长，且 800 字符上限处仍在可接受等待内', async () => {
    await polishSentence('short')
    const shortMs = mockCallLLMJson.mock.calls[0][0].timeoutMs as number

    await polishSentence('a'.repeat(800), 'What do you do to relax?')
    const longMs = mockCallLLMJson.mock.calls[1][0].timeoutMs as number

    expect(longMs).toBeGreaterThan(shortMs)
    // 上界守卫：callLLMJson 默认两轮，用户感知的最坏等待 = 2 × 预算。
    // 25s 这条线保证最坏等待不超过约 50s，即不会重演「等 60 秒才看到请重试」。
    expect(longMs).toBeLessThanOrEqual(25_000)
  })
})
