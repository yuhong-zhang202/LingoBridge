/**
 * @module   db/anki-cards-server.test
 * @desc     换/删语料 lib 的行为级守卫（审计 C，§11 正确性红线）：钉死 swapAnkiCorpus / unbindCorpus
 *           【只经单条原子 RPC 派发】（swap_anki_corpus / unbind_anki_corpus），而非退回旧的多条独立
 *           app 层 DML（那会有中间失败留半成品的原子性缺口）。真正的事务原子性由 0035 plpgsql 保证、
 *           须真实 PG 验证（本轮无就绪库，留下轮）；这里只锁「lib 不再自己拆 DML、参数正确传给 RPC」。
 * @author   LingoBridge
 * @created  2026-07-23
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/srs', () => ({ nextBox: jest.fn(), nextDue: jest.fn() }))

import { swapAnkiCorpus, unbindCorpus } from '@/lib/db/anki-cards-server'
import { getSupabaseServer } from '@/lib/supabase-server'

const mockGetSupabaseServer = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

/** 装一个只暴露 rpc 的假 client；from() 若被调到即断言失败（证明未退回多条独立 DML）。 */
function mockClient(rpc: jest.Mock): void {
  const from = jest.fn(() => {
    throw new Error('不应再走 .from() 多条 DML —— 换/删语料须收敛为单条原子 RPC')
  })
  mockGetSupabaseServer.mockReturnValue({ rpc, from } as unknown as ReturnType<typeof getSupabaseServer>)
}

describe('swapAnkiCorpus · 只经 swap_anki_corpus 原子 RPC', () => {
  beforeEach(() => jest.clearAllMocks())

  it('传参正确并回卡行 id；不触碰 .from()', async () => {
    const rpc = jest.fn(() => Promise.resolve({ data: 'card-1', error: null }))
    mockClient(rpc)
    const cardId = await swapAnkiCorpus('u1', 'q1', 'c-new')
    expect(cardId).toBe('card-1')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('swap_anki_corpus', {
      p_user_id: 'u1',
      p_question_id: 'q1',
      p_corpus_id: 'c-new',
    })
  })

  it('RPC 报错 → 抛出（交端点落 500，绝不静默留半成品）', async () => {
    const rpc = jest.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } }))
    mockClient(rpc)
    await expect(swapAnkiCorpus('u1', 'q1', 'c-new')).rejects.toThrow('换语料失败：boom')
  })
})

describe('unbindCorpus · 只经 unbind_anki_corpus 原子 RPC', () => {
  beforeEach(() => jest.clearAllMocks())

  it('传参正确；不触碰 .from()', async () => {
    const rpc = jest.fn(() => Promise.resolve({ data: null, error: null }))
    mockClient(rpc)
    await unbindCorpus('u1', 'q1')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('unbind_anki_corpus', { p_user_id: 'u1', p_question_id: 'q1' })
  })

  it('RPC 报错 → 抛出', async () => {
    const rpc = jest.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } }))
    mockClient(rpc)
    await expect(unbindCorpus('u1', 'q1')).rejects.toThrow('删语料失败：boom')
  })
})
