/**
 * @module   api/dashboard-aggregation.test
 * @desc     成本看板聚合守卫 —— 钉死本轮补的三件：
 *           ① 按环节（metadata.phase）聚合、缺 phase 归 other，按成本降序；
 *           ② 估算占比（cost_source='estimate' 成本 ÷ 本期总成本）；
 *           ③ 日界/小时桶按东八区（UTC+8）折算——香港节点部署下"今日"不再错位 8 小时。
 *           另验预算线常量与 recentLogs.metadata 透传。全部 mock，不碰真实 DB/鉴权。
 * @author   LingoBridge
 * @created  2026-07-18
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

import { GET } from '@/app/api/dashboard/route'
import { getSupabaseServer } from '@/lib/supabase-server'

const mockGetSupabase = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

type QueryResult = { data: unknown[]; error: null }

/** 造一个 thenable 查询构建器：链式 select/gte/lt/order/limit 均返回自身，await 解析为预置结果 */
function makeBuilder(result: QueryResult) {
  const b: Record<string, unknown> = {}
  const self = () => b
  b.select = self
  b.gte = self
  b.lt = self
  b.order = self
  b.limit = self
  b.then = (resolve: (r: QueryResult) => void) => resolve(result)
  return b
}

/**
 * 装配 supabase mock：6 条查询按 from() 调用顺序取预置结果
 * （顺序 = allTime, month, lastMonth, today, range, recent，与 route 内 Promise.all 数组一致）。
 */
function wireSupabase(results: QueryResult[]): void {
  let call = 0
  mockGetSupabase.mockReturnValue({
    from: () => makeBuilder(results[call++]),
  } as never)
}

const EMPTY: QueryResult = { data: [], error: null }

beforeEach(() => {
  jest.clearAllMocks()
  // 冻结系统时间：UTC 2026-07-18 02:00 → 香港 2026-07-18 10:00。
  // 香港"今日" 00:00 = 2026-07-17T16:00:00Z（日界折算的锚点）。
  jest.useFakeTimers().setSystemTime(new Date('2026-07-18T02:00:00Z'))
})

afterEach(() => {
  jest.useRealTimers()
})

describe('GET /api/dashboard · 聚合口径', () => {
  test('按环节聚合 + 估算占比 + 预算线 + 东八区小时桶', async () => {
    // range 窗口三行：coach(实,¥2)、analysis(估,¥1) 均在香港今日 09:xx；transcribe(无 phase,¥0.5) 在昨日 23:00。
    const rangeRows = [
      { service: 'qwen_plus', estimated_cost_cny: 2, latency_ms: 100, status: 'success',
        created_at: '2026-07-18T01:00:00Z', metadata: { phase: 'coach', cost_source: 'actual' } },
      { service: 'qwen_plus', estimated_cost_cny: 1, latency_ms: 100, status: 'success',
        created_at: '2026-07-18T01:30:00Z', metadata: { phase: 'analysis', cost_source: 'estimate' } },
      { service: 'doubao_asr', estimated_cost_cny: 0.5, latency_ms: 100, status: 'success',
        created_at: '2026-07-17T15:00:00Z', metadata: null },
    ]
    const recentRows = [
      { id: 'r1', created_at: '2026-07-18T01:00:00Z', service: 'qwen_plus', endpoint: 'x/completions',
        usage_amount: 100, usage_unit: 'tokens', estimated_cost_cny: 2, latency_ms: 100, status: 'success',
        metadata: { phase: 'coach', cost_source: 'actual' } },
    ]
    wireSupabase([EMPTY, EMPTY, EMPTY, EMPTY, { data: rangeRows, error: null }, { data: recentRows, error: null }])

    const req = new Request('http://localhost/api/dashboard?range=7d')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()

    // ① 按环节：coach(2) > analysis(1) > other(0.5)，缺 phase 归 other
    expect(body.phaseTotals).toEqual([
      expect.objectContaining({ phase: 'coach', cost: 2, calls: 1 }),
      expect.objectContaining({ phase: 'analysis', cost: 1, calls: 1 }),
      expect.objectContaining({ phase: 'other', cost: 0.5, calls: 1 }),
    ])

    // ② 估算占比：estimate 成本 1 ÷ 总成本 3.5 = 28.57%
    expect(body.estimateRatio).toBe(28.57)

    // ③ 东八区小时桶：01:00Z / 01:30Z → 香港 09:xx（hour 9），共 2 次；昨日 23:00 那条不计入今日
    const h9 = body.hourlyData.find((h: { hour: string }) => h.hour === '9:00')
    expect(h9.calls).toBe(2)
    // UTC 语义下这两条本会落在 hour 1（01:xxZ）——确认没有错位到 1:00
    const h1 = body.hourlyData.find((h: { hour: string }) => h.hour === '1:00')
    expect(h1.calls).toBe(0)

    // 预算线常量透传
    expect(body.dailyBudget).toBe(20)

    // recentLogs.metadata 透传（供表格估/实角标）
    expect(body.recentLogs[0].metadata).toEqual({ phase: 'coach', cost_source: 'actual' })
  })

  test('空数据：本期无调用 → estimateRatio=0、phaseTotals 为空、无小时桶', async () => {
    wireSupabase([EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY])
    const req = new Request('http://localhost/api/dashboard?range=7d')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.estimateRatio).toBe(0)
    expect(body.phaseTotals).toEqual([])
    expect(body.hourlyData.every((h: { calls: number }) => h.calls === 0)).toBe(true)
  })
})
