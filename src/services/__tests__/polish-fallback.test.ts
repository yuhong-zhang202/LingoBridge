/**
 * @module   polish-fallback.test
 * @desc     polishSentence 降级契约单测：当 callLLMJson 解析用尽仍失败、走 fallback 时，
 *           polishSentence 必须返回诚实降级结果（needsWork:false + optimized 留空，不会写进优化历史），
 *           而非 throw→500→前端一律「优化失败」。守住修复不回退。LLM 调用全部 mock，不发真实请求。
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
