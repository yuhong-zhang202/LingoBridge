/**
 * @module   db/daily-usage-day-key.test
 * @desc     readDailyUsageServer 查 daily_usage_counts 时用的 `day` 键必须是**东八区**当天 ——
 *           与迁移 0062 里 RPC 写入端的 `(now() at time zone 'Asia/Shanghai')::date` 同口径。
 *           读写差一个口径，香港 00:00–08:00 就会去查一个不存在的桶（旧代码正是如此）。
 *
 *           时钟一律用 jest 假时钟注入，**不依赖跑测试时的真实时间**：这条 bug 只在香港凌晨
 *           0 点到 8 点发作，靠真实钟测等于绝大多数时候什么都没测、半夜跑 CI 才随机变红。
 * @author   LingoBridge
 * @created  2026-08-12
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))

import { readDailyUsageServer } from '@/lib/db/corpus-server'
import { getSupabaseServer } from '@/lib/supabase-server'

const mockGetSupabaseServer = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

/** 记录下查询实际用了哪个 day 键的 supabase 链式桩（其余方法原样返回 this）。 */
function stubClient(): { dayKeys: string[] } {
  const captured: { dayKeys: string[] } = { dayKeys: [] }
  const chain = {
    select: () => chain,
    eq: (col: string, val: string) => {
      if (col === 'day') captured.dayKeys.push(val)
      return chain
    },
    maybeSingle: () => Promise.resolve({ data: { count: 7 }, error: null }),
  }
  mockGetSupabaseServer.mockReturnValue({
    from: () => chain,
  } as unknown as ReturnType<typeof getSupabaseServer>)
  return captured
}

describe('readDailyUsageServer · day 键按东八区', () => {
  beforeEach(() => jest.clearAllMocks())
  afterEach(() => jest.useRealTimers())

  it('香港 00:30（UTC 前一天 16:30）查的是新的一天 —— 用户凌晨打开就该拿到新额度', () => {
    jest.useFakeTimers({ now: Date.parse('2026-08-02T16:30:00Z') })
    const captured = stubClient()
    return readDailyUsageServer('u1', 'transcribe').then((n) => {
      expect(n).toBe(7)
      expect(captured.dayKeys).toEqual(['2026-08-03'])   // 改回 UTC 口径这里会变成 2026-08-02
    })
  })

  it('香港 23:59 与次日 00:01 查的是两个不同的桶', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-08-02T15:59:00Z') })
    const a = stubClient()
    await readDailyUsageServer('u1', 'transcribe')
    jest.setSystemTime(Date.parse('2026-08-02T16:01:00Z'))
    const b = stubClient()
    await readDailyUsageServer('u1', 'transcribe')
    expect(a.dayKeys).toEqual(['2026-08-02'])
    expect(b.dayKeys).toEqual(['2026-08-03'])
  })

  it('香港早上 8 点前后仍是同一天（旧口径正是在这里跳日的）', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-08-02T23:59:00Z') })   // 香港 08-03 07:59
    const a = stubClient()
    await readDailyUsageServer('u1', 'transcribe')
    jest.setSystemTime(Date.parse('2026-08-03T00:01:00Z'))            // 香港 08-03 08:01
    const b = stubClient()
    await readDailyUsageServer('u1', 'transcribe')
    expect(a.dayKeys).toEqual(['2026-08-03'])
    expect(b.dayKeys).toEqual(['2026-08-03'])
  })
})
