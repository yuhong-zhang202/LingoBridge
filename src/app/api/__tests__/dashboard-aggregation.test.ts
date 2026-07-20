/**
 * @module   api/dashboard-aggregation.test
 * @desc     成本看板聚合守卫 —— 钉死本轮补的口径：
 *           ① 按环节（metadata.phase）聚合、缺 phase 归 other，按成本降序；
 *           ② 估算占比（cost_source='estimate' 成本 ÷ 本期总成本）；
 *           ③ 日界/小时桶按东八区（UTC+8）折算——香港节点部署下"今日"不再错位 8 小时；
 *           ④ 延迟 p95（仅成功调用）；
 *           ⑤ 按环节失败率 + 失败成本（部分失败白烧）；
 *           ⑥ 最贵 Top-N 调用（按成本降序，独立于时间序"最近调用"）；
 *           ⑦ 按用户成本 Top-N（按 user_id 归因、成本降序、匿名标记）+ 匿名/登录成本占比，无归属行跳过分组；
 *           ⑧ 用户输入问题（metadata.error_kind='user_input'，如空录音）不计入错误率但仍计入失败成本，
 *             且无该标记的历史行一律按系统故障计（口径不追溯改写历史）。
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
 * 装配 supabase mock：7 条查询按 from() 调用顺序取预置结果
 * （顺序 = allTime, month, lastMonth, today, range, recent, costly，与 route 内 Promise.all 数组一致）。
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
    // 最贵 Top-N：DB 已按成本降序返回，route 原样透传
    const costlyRows = [
      { id: 'c1', created_at: '2026-07-10T01:00:00Z', service: 'qwen_plus', endpoint: 'x/completions',
        usage_amount: 9999, usage_unit: 'tokens', estimated_cost_cny: 42, latency_ms: 3000, status: 'success',
        metadata: { phase: 'ranking', cost_source: 'actual' } },
      { id: 'c2', created_at: '2026-07-09T01:00:00Z', service: 'qwen_plus', endpoint: 'x/completions',
        usage_amount: 500, usage_unit: 'tokens', estimated_cost_cny: 5, latency_ms: 200, status: 'success',
        metadata: { phase: 'coach', cost_source: 'actual' } },
    ]
    wireSupabase([EMPTY, EMPTY, EMPTY, EMPTY, { data: rangeRows, error: null },
      { data: recentRows, error: null }, { data: costlyRows, error: null }])

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

    // ⑥ 最贵 Top-N 独立于时间序透传，成本降序
    expect(body.costlyLogs.map((l: { id: string }) => l.id)).toEqual(['c1', 'c2'])
    expect(body.costlyLogs[0].estimated_cost_cny).toBe(42)

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

  test('按用户成本 Top-N（成本降序、匿名标记）+ 匿名/登录成本占比 + 无归属行跳过分组', async () => {
    // 全时段归属行（results[0] = allTime 查询）：
    //   u1 两次登录调用累计 ¥15；anon1 一次匿名调用 ¥30（最贵，应排最前）；
    //   一条 user_id=null 的老行 ¥2（补归属字段前）——无法归因到人，跳过分组，但也不算入匿名/登录占比（is_anonymous=null）。
    const allTimeRows = [
      { estimated_cost_cny: 10, user_id: 'u1',    is_anonymous: false },
      { estimated_cost_cny: 5,  user_id: 'u1',    is_anonymous: false },
      { estimated_cost_cny: 30, user_id: 'anon1', is_anonymous: true },
      { estimated_cost_cny: 2,  user_id: null,    is_anonymous: null },
    ]
    wireSupabase([{ data: allTimeRows, error: null }, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY])
    const req = new Request('http://localhost/api/dashboard?range=7d')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()

    // 成本降序：anon1(30) 在 u1(15) 之前；匿名标记随行；null 用户不出现在榜单
    expect(body.userTotals).toEqual([
      { userId: 'anon1', isAnonymous: true,  cost: 30, calls: 1 },
      { userId: 'u1',    isAnonymous: false, cost: 15, calls: 2 },
    ])
    // 匿名/登录成本占比：匿名 30 / 登录 15；null 那条（is_anonymous=null）两边都不计入
    expect(body.anonymousCost).toBe(30)
    expect(body.loggedInCost).toBe(15)
  })

  test('空数据：本期无调用 → estimateRatio=0、phaseTotals 为空、无小时桶、p95=0、失败成本=0', async () => {
    wireSupabase([EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY])
    const req = new Request('http://localhost/api/dashboard?range=7d')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.estimateRatio).toBe(0)
    expect(body.phaseTotals).toEqual([])
    expect(body.hourlyData.every((h: { calls: number }) => h.calls === 0)).toBe(true)
    expect(body.p95Latency).toBe(0)
    expect(body.failedCost).toBe(0)
    expect(body.costlyLogs).toEqual([])
    expect(body.userTotals).toEqual([])
    expect(body.anonymousCost).toBe(0)
    expect(body.loggedInCost).toBe(0)
  })

  test('p95 只算成功调用 + 按环节失败率/失败成本（部分失败白烧）', async () => {
    // ranking 环节：4 成功（延迟 100/200/300/400）+ 1 失败（延迟 5，已烧 ¥0.3）；
    // extraction 环节：1 成功且已记账 ¥1（配套那次 ranking 失败的"白烧"上游成本）。
    const success = (ms: number, phase: string, cost: number) => ({
      service: 'qwen_plus', estimated_cost_cny: cost, latency_ms: ms, status: 'success',
      created_at: '2026-07-18T01:00:00Z', metadata: { phase, cost_source: 'actual' },
    })
    const rangeRows = [
      success(100, 'ranking', 0.2),
      success(200, 'ranking', 0.2),
      success(300, 'ranking', 0.2),
      success(400, 'ranking', 0.2),
      { service: 'qwen_plus', estimated_cost_cny: 0.3, latency_ms: 5, status: 'error',
        created_at: '2026-07-18T01:00:00Z', metadata: { phase: 'ranking', cost_source: 'actual' } },
      success(1000, 'extraction', 1),
    ]
    wireSupabase([EMPTY, EMPTY, EMPTY, EMPTY, { data: rangeRows, error: null }, EMPTY, EMPTY])
    const req = new Request('http://localhost/api/dashboard?range=7d')
    const res = await GET(req)
    const body = await res.json()

    // ④ p95：成功延迟 [100,200,300,400,1000]（含 extraction 那条 1000），5 个点 p95 → 880
    expect(body.p95Latency).toBe(880)
    // 失败那条延迟 5ms 未混入
    expect(body.avgLatency).toBe(400)  // (100+200+300+400+1000)/5

    // ⑤ ranking 环节：5 次调用、1 次失败 → 20% 错误率、失败成本 0.3
    const ranking = body.phaseTotals.find((p: { phase: string }) => p.phase === 'ranking')
    expect(ranking.calls).toBe(5)
    expect(ranking.errors).toBe(1)
    expect(ranking.errorRate).toBe(20)
    expect(ranking.errorCost).toBe(0.3)
    // extraction 全成功、无失败成本
    const extraction = body.phaseTotals.find((p: { phase: string }) => p.phase === 'extraction')
    expect(extraction.errors).toBe(0)
    expect(extraction.errorRate).toBe(0)

    // 全局失败成本汇总
    expect(body.failedCost).toBe(0.3)
  })

  test('用户输入问题（空录音）不计入错误率，但仍计入失败成本', async () => {
    // 4 次调用：2 次成功、1 次系统故障（¥0.3）、1 次空录音（error_kind=user_input，¥0.6 已经花掉）。
    // 期望：错误率只认那 1 次系统故障（1/4 = 25%，而非 2/4 = 50%）；失败成本两笔都算（0.3 + 0.6）。
    const rangeRows = [
      { service: 'doubao_asr', estimated_cost_cny: 0.5, latency_ms: 100, status: 'success',
        created_at: '2026-07-18T01:00:00Z', metadata: null },
      { service: 'doubao_asr', estimated_cost_cny: 0.5, latency_ms: 100, status: 'success',
        created_at: '2026-07-18T01:00:00Z', metadata: null },
      { service: 'doubao_asr', estimated_cost_cny: 0.3, latency_ms: 10, status: 'error',
        created_at: '2026-07-18T01:00:00Z', metadata: null },
      { service: 'doubao_asr', estimated_cost_cny: 0.6, latency_ms: 900, status: 'error',
        created_at: '2026-07-18T01:00:00Z', metadata: { error_kind: 'user_input' } },
    ]
    wireSupabase([EMPTY, EMPTY, EMPTY, EMPTY, { data: rangeRows, error: null }, EMPTY, EMPTY])
    const req = new Request('http://localhost/api/dashboard?range=7d')
    const res = await GET(req)
    const body = await res.json()

    // ① 摘出：空录音不进错误率
    expect(body.errorRate).toBe(25)
    // ② 留下：钱确实花了，失败成本两笔都算
    expect(body.failedCost).toBe(0.9)

    // ③ 按环节下钻同口径：transcribe 无 phase → other；errors 只数系统故障，errorCost 仍全量
    const other = body.phaseTotals.find((p: { phase: string }) => p.phase === 'other')
    expect(other.calls).toBe(4)
    expect(other.errors).toBe(1)
    expect(other.errorRate).toBe(25)
    expect(other.errorCost).toBe(0.9)
  })

  test('历史数据不追溯：无 error_kind 的老 error 行一律按系统故障计', async () => {
    const rangeRows = [
      { service: 'doubao_asr', estimated_cost_cny: 0, latency_ms: 10, status: 'error',
        created_at: '2026-07-18T01:00:00Z', metadata: null },
      { service: 'doubao_asr', estimated_cost_cny: 0.5, latency_ms: 100, status: 'success',
        created_at: '2026-07-18T01:00:00Z', metadata: null },
    ]
    wireSupabase([EMPTY, EMPTY, EMPTY, EMPTY, { data: rangeRows, error: null }, EMPTY, EMPTY])
    const res = await GET(new Request('http://localhost/api/dashboard?range=7d'))
    const body = await res.json()
    expect(body.errorRate).toBe(50)
  })
})
