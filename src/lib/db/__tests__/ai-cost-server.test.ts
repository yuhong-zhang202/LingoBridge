/**
 * @module   lib/db/ai-cost-server.test
 * @desc     今日全站 AI 花费取数口的守卫。逐条标注守的是【行为】还是【结构】：
 *           ①【结构】走的是迁移 0063 的 RPC（不是应用层分页求和 —— 那条路会因分页触顶静默少报，
 *              而「行数暴涨」正是熔断唯一要对付的场景）；且把内部账户名册作为参数传下去。
 *           ②【行为】numeric 被 PostgREST 回成字符串时也要正确解析（否则阈值比较恒不成立）。
 *           ③【行为】查询报错 / 解析不出有限数 → 返回 null（「读不到」），**绝不折成 0**——
 *              折成 0 等于把「不知道花了多少」伪装成「没花钱」，调用方就失去了选择失败方向的机会。
 * @author   LingoBridge
 * @created  2026-08-12
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))

import { readTodayAiCostCny } from '@/lib/db/ai-cost-server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { INTERNAL_ACCOUNT_IDS } from '@/lib/internal-accounts'

const mockGetServer = getSupabaseServer as unknown as jest.Mock
const rpc = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  mockGetServer.mockReturnValue({ rpc } as unknown as ReturnType<typeof getSupabaseServer>)
  // 失败路径本就该打告警（那是发现「熔断静默失效」的唯一手段），测试里只是别把它刷进输出
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('readTodayAiCostCny', () => {
  it('① 调 0063 的 RPC，并把内部账户名册作为参数传下去（SQL 侧不另抄一份名册）', async () => {
    rpc.mockResolvedValue({ data: 12.5, error: null })
    expect(await readTodayAiCostCny()).toBe(12.5)
    expect(rpc).toHaveBeenCalledWith('global_ai_cost_today_cny', {
      p_exclude_user_ids: [...INTERNAL_ACCOUNT_IDS],
    })
  })

  it('② numeric 回成字符串时照样解析', async () => {
    rpc.mockResolvedValue({ data: '61.2345', error: null })
    expect(await readTodayAiCostCny()).toBeCloseTo(61.2345, 4)
  })

  it('③ 查询报错 → null（不是 0）', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } })
    expect(await readTodayAiCostCny()).toBeNull()
  })

  it('③ 解析不出有限数 → null（绝不让 NaN 流进阈值比较，那会让熔断静默失效）', async () => {
    rpc.mockResolvedValue({ data: '不是数字', error: null })
    expect(await readTodayAiCostCny()).toBeNull()
  })

  it('③ RPC 抛异常 → null，不往上抛', async () => {
    rpc.mockRejectedValue(new Error('network down'))
    await expect(readTodayAiCostCny()).resolves.toBeNull()
  })
})
