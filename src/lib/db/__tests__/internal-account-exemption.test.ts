/**
 * @module   db/internal-account-exemption.test
 * @desc     内部账户日额度豁免的行为级守卫：钉死 bumpDailyUsageServer / readDailyUsageServer 对
 *           INTERNAL_ACCOUNT_IDS 里的 user_id 恒返 0 且【绝不触 supabase】（不递增 RPC、不查表），
 *           普通用户仍照常走 RPC/查询。同时守 isInternalAccount 纯函数的边界（null/未知 id 非内部）。
 *           这是「日额度一处收敛」的回归锚点：两函数是全部 12+ 付费接口防刷闸的唯一计数入口。
 * @author   LingoBridge
 * @created  2026-08-01
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))

import { bumpDailyUsageServer, readDailyUsageServer } from '@/lib/db/corpus-server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { isInternalAccount, INTERNAL_ACCOUNT_IDS } from '@/lib/internal-accounts'

const mockGetSupabaseServer = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

/** 名册里任取一个真实内部账户 id 做测试主体（避免测试写死具体 UUID、与名册解耦）。 */
const INTERNAL_ID = [...INTERNAL_ACCOUNT_IDS][0]

describe('isInternalAccount · 边界', () => {
  it('名册内 id 判为内部', () => {
    expect(isInternalAccount(INTERNAL_ID)).toBe(true)
  })
  it('null / undefined / 空串 / 未知 id 一律非内部', () => {
    expect(isInternalAccount(null)).toBe(false)
    expect(isInternalAccount(undefined)).toBe(false)
    expect(isInternalAccount('')).toBe(false)
    expect(isInternalAccount('00000000-0000-0000-0000-000000000000')).toBe(false)
  })
})

describe('bumpDailyUsageServer · 内部账户豁免', () => {
  beforeEach(() => jest.clearAllMocks())

  it('内部账户恒返 0 且绝不触 supabase（不递增计数 RPC）', async () => {
    // client 一旦被取用即断言失败：内部账户必须在触库之前就短路返回。
    mockGetSupabaseServer.mockImplementation(() => {
      throw new Error('内部账户不应触 supabase —— 日额度豁免须在 RPC 之前短路')
    })
    await expect(bumpDailyUsageServer(INTERNAL_ID, 'practice')).resolves.toBe(0)
    expect(mockGetSupabaseServer).not.toHaveBeenCalled()
  })

  it('普通用户照常走 bump_daily_usage RPC 并返回递增值', async () => {
    const rpc = jest.fn(() => Promise.resolve({ data: 3, error: null }))
    mockGetSupabaseServer.mockReturnValue({ rpc } as unknown as ReturnType<typeof getSupabaseServer>)
    await expect(bumpDailyUsageServer('normal-user', 'practice')).resolves.toBe(3)
    expect(rpc).toHaveBeenCalledWith('bump_daily_usage', { p_user_id: 'normal-user', p_kind: 'practice' })
  })
})

describe('readDailyUsageServer · 内部账户豁免（transcribe 只读早退闸同样放行）', () => {
  beforeEach(() => jest.clearAllMocks())

  it('内部账户恒返 0 且绝不触 supabase', async () => {
    mockGetSupabaseServer.mockImplementation(() => {
      throw new Error('内部账户不应触 supabase —— 只读早退闸须在查询之前短路')
    })
    await expect(readDailyUsageServer(INTERNAL_ID, 'transcribe')).resolves.toBe(0)
    expect(mockGetSupabaseServer).not.toHaveBeenCalled()
  })
})
