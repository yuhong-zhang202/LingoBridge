/**
 * @module   api/anki/cards/corpus/route.test
 * @desc     换语料 PUT 的【防脚本滥用限流】守卫（审计 B / P0-2）：钉死核心安全不变式——
 *           超 REG_ANKI_SWAP_DAILY_LIMIT 时【返回 429 且绝不触达重生成（swapAnkiCorpus 一次都不被调）】，
 *           即限流在付费 AI 之前、超限零成本；未超限时正常派发原子 RPC。走独立 kind='anki_swap' 计次，
 *           与「换语料不计【存对子】配额」不矛盾（那是另一个额度）。全部 mock，不碰真实 DB/AI/鉴权。
 * @author   LingoBridge
 * @created  2026-07-23
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/api-auth', () => ({
  requireRegistered: jest.fn(() => Promise.resolve({ userId: 'u1' })),
  assertCorpusOwner: jest.fn(() => Promise.resolve()),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({ requireConsent: jest.fn(() => Promise.resolve(null)) }))
jest.mock('@/lib/db/questions', () => ({ getQuestionById: jest.fn(() => Promise.resolve({ id: 'q1', part: 2 })) }))
jest.mock('@/lib/db/corpus-server', () => ({ bumpDailyUsageServer: jest.fn() }))
jest.mock('@/lib/db/anki-cards-server', () => ({
  swapAnkiCorpus: jest.fn(() => Promise.resolve('card-1')),
  unbindCorpus: jest.fn(() => Promise.resolve()),
}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

import { PUT } from '@/app/api/anki/cards/corpus/route'
import { bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { swapAnkiCorpus } from '@/lib/db/anki-cards-server'
import { REG_ANKI_SWAP_DAILY_LIMIT } from '@/lib/constants'

const mockBump = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>
const mockSwap = swapAnkiCorpus as jest.MockedFunction<typeof swapAnkiCorpus>

function putReq(body: unknown): Request {
  return new Request('http://x/api/anki/cards/corpus', { method: 'PUT', body: JSON.stringify(body) })
}

describe('PUT 换语料 · 防滥用限流（kind=anki_swap，先限流后 AI）', () => {
  beforeEach(() => jest.clearAllMocks())

  it('计次走独立 kind=anki_swap（不占用存对子的 anki 额度）', async () => {
    mockBump.mockResolvedValue(1)
    await PUT(putReq({ questionId: 'q1', corpusId: 'c-new' }))
    expect(mockBump).toHaveBeenCalledWith('u1', 'anki_swap')
  })

  it('超上限 → 429，且重生成（swapAnkiCorpus）一次都不被调（零成本）', async () => {
    mockBump.mockResolvedValue(REG_ANKI_SWAP_DAILY_LIMIT + 1)
    const res = await PUT(putReq({ questionId: 'q1', corpusId: 'c-new' }))
    expect(res.status).toBe(429)
    expect(mockSwap).not.toHaveBeenCalled()
  })

  it('未超限 → 200，派发原子 RPC 并回 cardId', async () => {
    mockBump.mockResolvedValue(REG_ANKI_SWAP_DAILY_LIMIT)
    const res = await PUT(putReq({ questionId: 'q1', corpusId: 'c-new' }))
    expect(res.status).toBe(200)
    expect(mockSwap).toHaveBeenCalledWith('u1', 'q1', 'c-new')
    expect(await res.json()).toEqual({ cardId: 'card-1' })
  })

  it('恰好等于上限那次仍放行（超过才拦，边界 = 上限）', async () => {
    mockBump.mockResolvedValue(REG_ANKI_SWAP_DAILY_LIMIT)
    const res = await PUT(putReq({ questionId: 'q1', corpusId: 'c-new' }))
    expect(res.status).toBe(200)
  })
})
