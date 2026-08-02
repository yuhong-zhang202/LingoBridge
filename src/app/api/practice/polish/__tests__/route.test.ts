/**
 * @module   api/practice/polish/route.test
 * @desc     polish 路由输入上限契约：800 字符放行、801 字符 400 早退（且不调模型、不计次）。
 *           上限从 500 放到 800 是为覆盖真实练习转写的 p95（实测 n=147：p90 430、p95 611），
 *           但 800 这条线本身要钉死——越过它 POLISH_SYSTEM 的「一句话」假设会失效。
 *           全部依赖 mock，不发真实请求、不碰 DB。
 * @author   LingoBridge
 * @created  2026-08-03
 */
jest.mock('server-only', () => ({}))
jest.mock('@/services/practice', () => ({ polishSentence: jest.fn() }))
jest.mock('@/lib/api-logger', () => ({ logApiUsage: jest.fn(), qwenPlusCostCny: jest.fn(() => 0.001) }))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(() => Promise.resolve({ userId: 'u1', isAnonymous: false })),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({ requireConsent: jest.fn(() => Promise.resolve(null)) }))
jest.mock('@/lib/db/corpus-server', () => ({ bumpDailyUsageServer: jest.fn(() => Promise.resolve(1)) }))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

import { POST } from '@/app/api/practice/polish/route'
import { polishSentence } from '@/services/practice'
import { bumpDailyUsageServer } from '@/lib/db/corpus-server'

const mockPolish = polishSentence as jest.MockedFunction<typeof polishSentence>
const mockBump = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>

/**
 * 造一个 polish 请求
 * @param sentence  待优化句子
 * @returns         可直接喂给 POST 的 Request
 */
function makeReq(sentence: string): Request {
  return new Request('http://localhost/api/practice/polish', {
    method: 'POST',
    body: JSON.stringify({ sentence }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPolish.mockResolvedValue({ needsWork: false, optimized: '', note: '' })
  mockBump.mockResolvedValue(1)
})

describe('polish 输入上限 800', () => {
  test('恰好 800 字符 → 放行，调模型', async () => {
    const res = await POST(makeReq('a'.repeat(800)))
    expect(res.status).toBe(200)
    expect(mockPolish).toHaveBeenCalledTimes(1)
    expect((mockPolish.mock.calls[0][0] as string).length).toBe(800)
  })

  test('801 字符 → 400，且不调模型、不计次（不能白扣用户额度）', async () => {
    const res = await POST(makeReq('a'.repeat(801)))
    expect(res.status).toBe(400)
    expect(mockPolish).not.toHaveBeenCalled()
    expect(mockBump).not.toHaveBeenCalled()
  })

  test('空句子仍是 400（与上限无关的既有契约）', async () => {
    const res = await POST(makeReq('   '))
    expect(res.status).toBe(400)
    expect(mockPolish).not.toHaveBeenCalled()
  })
})
