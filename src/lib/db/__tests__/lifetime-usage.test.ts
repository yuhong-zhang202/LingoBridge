/**
 * @module   db/lifetime-usage.test
 * @desc     readLifetimeUsageServer（终身用量累计读）单测 —— 守卫三条不变式：
 *           ① 终身值 = 同 user_id + kind 跨【所有 day】的 count 之和（每日额度天天清零，总量必须跨天累加）；
 *           ② 内部账户恒返 0 且不查库 —— 漏了这条会用产品方自用账户的历史累计把自己永久锁死
 *             （终身闸没有「明天再来」这条退路）；
 *           ③ 读失败一律返回 0（失败开放）且不抛 —— 宁可多花一笔 ASR，也不把「试用次数已用完」
 *             误发给第一次用产品的匿名用户。
 *           全依赖 mock，不碰真实 DB。
 * @author   LingoBridge
 * @created  2026-08-07
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))

import { readLifetimeUsageServer } from '@/lib/db/corpus-server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { INTERNAL_ACCOUNT_IDS } from '@/lib/internal-accounts'

const mockGetSupabase = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

/** 记录本次查询落到的表名与过滤条件，供断言「按 user_id + kind 查、不按 day 过滤」 */
let queriedTable: string | null
let eqCalls: Array<[string, unknown]>

/**
 * 造一个 supabase 查询链 mock：from().select().eq().eq() 直接 await 出结果（PostgREST 链本身是 thenable）
 * @param result  await 链末端时兑现的 { data, error }
 */
function mockQuery(result: { data: unknown; error: unknown }): void {
  queriedTable = null
  eqCalls = []
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return chain },
    // 链末端不调 .single()/.limit()，直接 await → 走 thenable 协议
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  }
  mockGetSupabase.mockReturnValue({
    from: (table: string) => { queriedTable = table; return chain },
  } as never)
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('readLifetimeUsageServer · 跨天累加', () => {
  test('多天记录求和（3 + 20 + 2 = 25），且只按 user_id + kind 过滤、不按 day', async () => {
    mockQuery({ data: [{ count: 3 }, { count: 20 }, { count: 2 }], error: null })

    const total = await readLifetimeUsageServer('u1', 'transcribe')

    expect(total).toBe(25)
    expect(queriedTable).toBe('daily_usage_counts')
    expect(eqCalls).toEqual([['user_id', 'u1'], ['kind', 'transcribe']])
    // 一旦有人给查询加上 day 过滤，终身闸就退化成每日闸 —— 这条断言就是防那件事
    expect(eqCalls.some(([col]) => col === 'day')).toBe(false)
  })

  test('从未用过（查回空数组）→ 0', async () => {
    mockQuery({ data: [], error: null })

    await expect(readLifetimeUsageServer('u1', 'transcribe')).resolves.toBe(0)
  })
})

describe('readLifetimeUsageServer · 内部账户豁免', () => {
  test('内部账户恒返 0，且根本不查库（不会被历史累计锁死）', async () => {
    mockQuery({ data: [{ count: 9999 }], error: null })
    const internalId = [...INTERNAL_ACCOUNT_IDS][0]

    const total = await readLifetimeUsageServer(internalId, 'transcribe')

    expect(total).toBe(0)
    expect(mockGetSupabase).not.toHaveBeenCalled()
  })
})

describe('readLifetimeUsageServer · 读失败口径（失败开放）', () => {
  test('查询返回 error → 0，不抛（最坏只是退回改动前的水位，仍有每日闸限速）', async () => {
    mockQuery({ data: null, error: { message: 'connection reset' } })

    await expect(readLifetimeUsageServer('u1', 'transcribe')).resolves.toBe(0)
  })

  test('client 构造直接抛错 → 0，不抛', async () => {
    mockGetSupabase.mockImplementation(() => { throw new Error('service_role 未配置') })

    await expect(readLifetimeUsageServer('u1', 'transcribe')).resolves.toBe(0)
  })
})
