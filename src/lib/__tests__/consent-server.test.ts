/**
 * @module   consent-server.test
 * @desc     服务端「真捕获同意」校验单测 —— 守卫第三方 AI 入口前置闸的核心不变式：
 *           1) 有当前版本同意记录 → 放行（true）；
 *           2) 无同意记录（查回空）→ 拒绝（false）；
 *           3) 版本过滤按当前 BETA_PRIVACY_VERSION（旧版本记录不算数）；
 *           4) 查库出错 → 抛错（交路由 500，不误判为「未同意」而回误导性提示）。
 *           全依赖 mock，不碰真实 DB。
 * @author   LingoBridge
 * @created  2026-07-18
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))

import { hasRecordedConsent } from '@/lib/consent-server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { BETA_PRIVACY_VERSION } from '@/lib/privacy-copy'

const mockGetSupabase = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

/** 记录 select 链最终落到的过滤条件，供断言「按 user_id + 当前版本查」 */
let eqCalls: Array<[string, unknown]>

/**
 * 造一个 supabase 查询链 mock：from().select().eq().eq().limit() → 返回给定结果。
 * @param result  limit() 兑现的 { data, error }
 */
function mockQuery(result: { data: unknown; error: unknown }): void {
  eqCalls = []
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return chain },
    limit: () => Promise.resolve(result),
  }
  mockGetSupabase.mockReturnValue({
    from: (table: string) => {
      if (table === 'consent_records') return chain
      throw new Error(`unexpected table ${table}`)
    },
  } as never)
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('hasRecordedConsent · 服务端同意闸', () => {
  test('1. 有当前版本同意记录 → true（放行）', async () => {
    mockQuery({ data: [{ id: 'c1' }], error: null })

    const ok = await hasRecordedConsent('u1')

    expect(ok).toBe(true)
    // 按 user_id + 当前披露版本过滤
    expect(eqCalls).toContainEqual(['user_id', 'u1'])
    expect(eqCalls).toContainEqual(['consent_version', BETA_PRIVACY_VERSION])
  })

  test('2. 无同意记录（查回空）→ false（拒绝）', async () => {
    mockQuery({ data: [], error: null })

    expect(await hasRecordedConsent('u1')).toBe(false)
  })

  test('3. data 为 null 也当未签 → false', async () => {
    mockQuery({ data: null, error: null })

    expect(await hasRecordedConsent('u1')).toBe(false)
  })

  test('4. 查库出错 → 抛错（交路由 500，不误判未同意）', async () => {
    mockQuery({ data: null, error: { message: 'db down' } })

    await expect(hasRecordedConsent('u1')).rejects.toBeDefined()
  })
})
