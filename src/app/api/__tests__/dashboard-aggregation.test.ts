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

/** 十条查询的标识（与 route 内 Promise.all 的十个位置一一对应） */
type QueryKey = 'allTime' | 'month' | 'lastMonth' | 'today' | 'range' | 'recent' | 'costly' | 'failed' | 'practice' | 'profiles'

/** 各查询的预置返回行；未指定的键按空表处理 */
type Spec = Partial<Record<QueryKey, unknown[]>>

// 冻结时刻 UTC 2026-07-18T02:00Z（香港 07-18 10:00）下的日界/月界锚点，
// 用于把三条 select 完全相同（'estimated_cost_cny'）的费用卡查询区分开。
const TODAY_START_ISO = '2026-07-17T16:00:00.000Z'   // 香港 07-18 00:00

// PostgREST 的 db-max-rows：单次查询最多返回这么多行、且不报错——【带 range 的请求同样被它封顶】。
// 【必须严格大于 route 里的 PAGE_SIZE(500)】：这样"满页(PAGE_SIZE)恒在封顶内"，判停不变式才成立。
// 二者若相等（此前 1000=1000 的巧合）会掩盖耦合——满页恰好贴着 cap、看不出被削；一旦有人把
// PAGE_SIZE 调到 ≥ db-max-rows，满页会被下方 range 分支的封顶削成"不满页"、误判到底，跨页断言随即转红。
const PG_MAX_ROWS = 1000

/** 一次查询被链式调用时捕获到的特征 */
type Captured = { select: string; gte: string[]; lt: string[]; eq: string[]; limit: number | null }

/**
 * 按查询特征反推它是十条中的哪一条。
 * 【不能】按 from() 调用顺序分派 —— 分页后同一条逻辑查询会多次 from()，各条的翻页交错、顺序不再稳定。
 * ⚠️ today / range 查询自 2026-07-25 起 select 也带 user_id（今日活跃去重 / 每日趋势活跃去重需要），
 *    故不能再靠「有 user_id 就是 allTime」分派；改为先按 practice/profiles 独有列，再按 service 分族，
 *    族内用 latency_ms（range 独有）区分 range 与 today，无 service 的三条费用卡查询走末尾旧逻辑。
 * @param q  该次查询捕获到的 select/过滤/limit 特征
 */
function classify(q: Captured): QueryKey {
  if (q.select.includes('is_review')) return 'practice'   // practice_sessions 独有列
  if (q.select === 'id') return 'profiles'                 // profiles 只 select id（今日新增注册计数）
  if (q.select.includes('service')) {
    // 失败明细是唯一带 .eq('status','error') 的一条，仅靠 select/limit 与「最贵」区分不开
    if (q.eq.includes('error')) return 'failed'
    if (q.limit === 30) return 'recent'
    if (q.limit !== null) return 'costly'
    // range 与 today 都带 service + user_id；range 独有 latency_ms（today 不取延迟列）
    return q.select.includes('latency_ms') ? 'range' : 'today'
  }
  // 以下三条无 service：allTime（带 user_id 全时段归因）/ 上月（带 lt）/ 本月
  if (q.select.includes('user_id')) return 'allTime'
  if (q.lt.length > 0) return 'lastMonth'
  return q.gte[0] === TODAY_START_ISO ? 'today' : 'month'
}

/**
 * 造一个 thenable 查询构建器：链式调用记录特征，await（或 .range()）时按特征取对应预置数据。
 * range(from,to) 返回该段切片 —— 真实还原 PostgREST 的分页语义，使「超过 1000 行」可被测出来。
 * @param spec  各查询的预置行
 */
function makeBuilder(spec: Spec) {
  const q: Captured = { select: '', gte: [], lt: [], eq: [], limit: null }
  const b: Record<string, unknown> = {}
  const self = () => b
  b.select = (cols: string) => { q.select = cols; return b }
  b.gte = (_col: string, v: string) => { q.gte.push(v); return b }
  b.lt = (_col: string, v: string) => { q.lt.push(v); return b }
  b.eq = (_col: string, v: string) => { q.eq.push(v); return b }
  b.order = self
  b.limit = (n: number) => { q.limit = n; return b }
  const rowsOf = (): unknown[] => spec[classify(q)] ?? []
  // range(from,to) 返回该段切片，【但同样封顶到 PG_MAX_ROWS 行】——真实 PostgREST 里带 range 的
  // 请求也逃不过 db-max-rows。故意让 PG_MAX_ROWS > PAGE_SIZE：满页(≤PAGE_SIZE)恒在封顶内、slice 不生效；
  // 若哪天 PAGE_SIZE 被调到 ≥ PG_MAX_ROWS，满页在此被削成"不满页" → route 误判到底 → 跨页断言转红。
  b.range = (from: number, to: number) => ({
    then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
      resolve({ data: rowsOf().slice(from, to + 1).slice(0, PG_MAX_ROWS), error: null }),
  })
  // 不带 range 直接 await：【必须】模拟 PostgREST max-rows=1000 的静默截断，
  // 否则 mock 会比真实 DB 更慷慨地返回全量，超 1000 行的分页守卫就成了摆设 ——
  // 分页一旦被改回裸查，测试仍会全绿。这一行是那组守卫真正的支点。
  b.then = (resolve: (r: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rowsOf().slice(0, PG_MAX_ROWS), error: null })
  return b
}

/**
 * 装配 supabase mock：按查询特征分派预置数据，未指定的查询返回空表。
 * @param spec  形如 { range: [...], allTime: [...] }
 */
function wireSupabase(spec: Spec): void {
  mockGetSupabase.mockReturnValue({
    from: () => makeBuilder(spec),
  } as never)
}

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
    wireSupabase({ range: rangeRows, recent: recentRows, costly: costlyRows })

    const req = new Request('http://localhost/api/dashboard?range=7d')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()

    // ① 按环节：coach(2) > analysis(1) > transcribe(0.5)。缺 phase 的豆包行由 resolvePhase 确定性兜底成
    //    'transcribe'（语音转写）——豆包只做转写，不再落进无意义的 'other' 桶（创始人反馈：消灭「其他」）。
    expect(body.phaseTotals).toEqual([
      expect.objectContaining({ phase: 'coach', cost: 2, calls: 1 }),
      expect.objectContaining({ phase: 'analysis', cost: 1, calls: 1 }),
      expect.objectContaining({ phase: 'transcribe', cost: 0.5, calls: 1 }),
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
    wireSupabase({ allTime: allTimeRows })
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
    wireSupabase({})
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
    wireSupabase({ range: rangeRows })
    const req = new Request('http://localhost/api/dashboard?range=7d')
    const res = await GET(req)
    const body = await res.json()

    // ④ p95：成功延迟 [100,200,300,400,1000]（含 extraction 那条 1000），5 个点 p95 → 880
    expect(body.p95Latency).toBe(880)
    // 失败那条延迟 5ms 未混入：混进来的话中位数会被拉到 250 以下
    expect(body.p50Latency).toBe(300)  // [100,200,300,400,1000] 的中位数

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
    wireSupabase({ range: rangeRows })
    const req = new Request('http://localhost/api/dashboard?range=7d')
    const res = await GET(req)
    const body = await res.json()

    // ① 摘出：空录音不进错误率
    expect(body.errorRate).toBe(25)
    // ② 留下：钱确实花了，失败成本两笔都算
    expect(body.failedCost).toBe(0.9)

    // ③ 按环节下钻同口径：4 行都是无 phase 的豆包，由 resolvePhase 兜底归 'transcribe'（非 'other'）；
    //    errors 只数系统故障（1 条），errorCost 仍全量（含空录音那笔）。
    const transcribe = body.phaseTotals.find((p: { phase: string }) => p.phase === 'transcribe')
    expect(transcribe.calls).toBe(4)
    expect(transcribe.errors).toBe(1)
    expect(transcribe.errorRate).toBe(25)
    expect(transcribe.errorCost).toBe(0.9)
    // 「其他」桶不再出现（豆包已确定性归位）
    expect(body.phaseTotals.find((p: { phase: string }) => p.phase === 'other')).toBeUndefined()
  })

  test('容量繁忙 / 网络中断不计入错误率，但仍计入失败成本', async () => {
    // 5 次调用：2 成功、1 系统故障（¥0.3）、1 容量繁忙（capacity，¥0.6）、1 网络中断（network，¥0.4）。
    // 期望：错误率只认那 1 次系统故障（1/5 = 20%，不是把 capacity/network 也算进去的 3/5=60%）；
    //       失败成本三笔 error 全算（0.3 + 0.6 + 0.4 = 1.3，钱都花了）。
    const rangeRows = [
      { service: 'qwen_plus', estimated_cost_cny: 0.5, latency_ms: 100, status: 'success',
        created_at: '2026-07-18T01:00:00Z', metadata: { phase: 'coach' } },
      { service: 'qwen_plus', estimated_cost_cny: 0.5, latency_ms: 100, status: 'success',
        created_at: '2026-07-18T01:00:00Z', metadata: { phase: 'coach' } },
      { service: 'qwen_plus', estimated_cost_cny: 0.3, latency_ms: 10, status: 'error',
        created_at: '2026-07-18T01:00:00Z', metadata: { phase: 'coach' } },
      { service: 'doubao_asr', estimated_cost_cny: 0.6, latency_ms: 10, status: 'error',
        created_at: '2026-07-18T01:00:00Z', metadata: { phase: 'transcribe', error_kind: 'capacity' } },
      { service: 'qwen_plus', estimated_cost_cny: 0.4, latency_ms: 10, status: 'error',
        created_at: '2026-07-18T01:00:00Z', metadata: { phase: 'coach', error_kind: 'network' } },
    ]
    wireSupabase({ range: rangeRows })
    const res = await GET(new Request('http://localhost/api/dashboard?range=7d'))
    const body = await res.json()
    // 错误率只数系统故障：1/5 = 20%
    expect(body.errorRate).toBe(20)
    // 失败成本全量三笔 error
    expect(body.failedCost).toBe(1.3)
    // coach 环节：4 次调用、只 1 次系统故障（network 那条不算）、errorCost 含 network 那笔
    const coach = body.phaseTotals.find((p: { phase: string }) => p.phase === 'coach')
    expect(coach.errors).toBe(1)
    expect(coach.errorCost).toBe(0.7)
  })

  test('历史数据不追溯：无 error_kind 的老 error 行一律按系统故障计', async () => {
    const rangeRows = [
      { service: 'doubao_asr', estimated_cost_cny: 0, latency_ms: 10, status: 'error',
        created_at: '2026-07-18T01:00:00Z', metadata: null },
      { service: 'doubao_asr', estimated_cost_cny: 0.5, latency_ms: 100, status: 'success',
        created_at: '2026-07-18T01:00:00Z', metadata: null },
    ]
    wireSupabase({ range: rangeRows })
    const res = await GET(new Request('http://localhost/api/dashboard?range=7d'))
    const body = await res.json()
    expect(body.errorRate).toBe(50)
  })
})

/**
 * ⑪ Tier1 今日经营口径（2026-07-25 新增）—— 首屏四数卡的数据源守卫：
 *   · 今日活跃（注册去重）/ 匿名试用会话数（匿名 user_id 去重、绝不与注册相加）；
 *   · 今日练习场次（practice_sessions 今日子集，按 is_review 拆新练/复练）；
 *   · 今日系统故障按环节（缺 phase 的用 service 兜底成环节名）+ 空录音单列（不算故障）；
 *   · 今日新增注册（profiles 今日 count）；
 *   · 每日参与度趋势（活跃只数注册去重、匿名不掺入 + 练习场次按天 count）。
 */
describe('GET /api/dashboard · Tier1 今日经营口径', () => {
  test('今日活跃/匿名会话/练习/故障按环节/新增注册/参与度趋势', async () => {
    // 今日行（select 带 user_id/is_anonymous/status/service/metadata）：
    //   注册 u1(×2)/u2；匿名 anon1/anon2；transcribe 系统故障 ×2（u1、anon1）；
    //   无 phase 系统故障 ×1（u2，用 service 'qwen_plus' 兜底成「千问 Plus」）；空录音 ×1（anon2，不算故障）。
    const todayRows = [
      { estimated_cost_cny: 1,   user_id: 'u1',    is_anonymous: false, status: 'success', service: 'qwen_plus',  metadata: { phase: 'coach' } },
      { estimated_cost_cny: 1,   user_id: 'u1',    is_anonymous: false, status: 'success', service: 'qwen_plus',  metadata: { phase: 'coach' } },
      { estimated_cost_cny: 1,   user_id: 'u2',    is_anonymous: false, status: 'success', service: 'qwen_plus',  metadata: { phase: 'analysis' } },
      { estimated_cost_cny: 0.5, user_id: 'anon1', is_anonymous: true,  status: 'success', service: 'doubao_asr', metadata: { phase: 'transcribe' } },
      { estimated_cost_cny: 0.5, user_id: 'anon2', is_anonymous: true,  status: 'success', service: 'doubao_asr', metadata: { phase: 'transcribe' } },
      { estimated_cost_cny: 0,   user_id: 'u1',    is_anonymous: false, status: 'error',   service: 'doubao_asr', metadata: { phase: 'transcribe' } },
      { estimated_cost_cny: 0,   user_id: 'anon1', is_anonymous: true,  status: 'error',   service: 'doubao_asr', metadata: { phase: 'transcribe' } },
      { estimated_cost_cny: 0,   user_id: 'u2',    is_anonymous: false, status: 'error',   service: 'qwen_plus',  metadata: null },
      { estimated_cost_cny: 0.6, user_id: 'anon2', is_anonymous: true,  status: 'error',   service: 'doubao_asr', metadata: { phase: 'transcribe', error_kind: 'user_input' } },
    ]
    // 练习场次：今日 3 场（新练 2 + 复练 1），另有一场在区间内但非今日（不计今日、但计入趋势）。
    const practiceRows = [
      { is_review: false, created_at: '2026-07-18T01:00:00Z' },
      { is_review: false, created_at: '2026-07-18T01:30:00Z' },
      { is_review: true,  created_at: '2026-07-18T01:40:00Z' },
      { is_review: false, created_at: '2026-07-15T01:00:00Z' },
    ]
    // 区间行（带归属列）：驱动「每日活跃」——只数注册去重，匿名 anon1 不计入活跃。
    const rangeRows = [
      { service: 'qwen_plus',  estimated_cost_cny: 1,   latency_ms: 100, status: 'success', created_at: '2026-07-18T01:00:00Z', metadata: { phase: 'coach' },      user_id: 'u1',    is_anonymous: false },
      { service: 'qwen_plus',  estimated_cost_cny: 1,   latency_ms: 100, status: 'success', created_at: '2026-07-18T02:00:00Z', metadata: { phase: 'coach' },      user_id: 'u2',    is_anonymous: false },
      { service: 'doubao_asr', estimated_cost_cny: 0.5, latency_ms: 100, status: 'success', created_at: '2026-07-18T02:00:00Z', metadata: { phase: 'transcribe' }, user_id: 'anon1', is_anonymous: true },
    ]
    wireSupabase({ today: todayRows, practice: practiceRows, profiles: [{ id: 'p1' }, { id: 'p2' }], range: rangeRows })

    const body = await (await GET(new Request('http://localhost/api/dashboard?range=7d'))).json()

    // 活跃与匿名会话：注册去重 {u1,u2}=2；匿名去重 {anon1,anon2}=2，两者绝不相加
    expect(body.registeredActiveToday).toBe(2)
    expect(body.anonSessionsToday).toBe(2)

    // 练习场次：今日 3 场 = 新练 2 + 复练 1（07-15 那场非今日、不计）
    expect(body.practiceNew).toBe(2)
    expect(body.practiceReview).toBe(1)
    expect(body.practiceTotal).toBe(3)

    // 今日系统故障按环节（降序）：语音转写 2（u1+anon1）、千问 Plus 1（u2 无 phase 用 service 兜底）；空录音不算故障
    expect(body.todayFailuresByPhase).toEqual([
      { phase: '语音转写', count: 2 },
      { phase: '千问 Plus', count: 1 },
    ])
    expect(body.todayFailuresTotal).toBe(3)
    expect(body.emptyRecordingToday).toBe(1)   // 仅 anon2 的空录音

    // 今日新增注册
    expect(body.newRegistrationsToday).toBe(2)

    // 每日参与度趋势：7/18 当天活跃只数注册去重 {u1,u2}=2（anon1 不掺入），练习场次 3
    const d18 = body.engagementTrend.find((d: { date: string }) => d.date === '7/18')
    expect(d18.activeUsers).toBe(2)
    expect(d18.practiceSessions).toBe(3)

    // 留存 / 假空率本轮为 pending 占位
    expect(body.retentionPending).toBe(true)
    expect(body.fakeEmptyPending).toBe(true)
  })
})

/**
 * ⑨ 各环节耗时 / 每日失败 / 今日状况 —— 本轮新增的三组口径守卫。
 * 关键在【延迟口径断点 UTC 2026-07-20 19:00 = 香港 07-21】：此前 extraction/ranking 的 latency_ms 是同一总时长记了两遍，
 * 一旦断点过滤被拆掉，耗时统计会掺进翻倍的旧值、看上去像"性能突然变好一半"。
 */
describe('GET /api/dashboard · 耗时 / 失败 / 今日状况', () => {
  // 冻结到断点【之后】：香港 2026-07-24 10:00，今日界 = 07-23T16:00Z，7 天窗自 07-17T16:00Z 起
  const NOW_ISO = '2026-07-24T02:00:00Z'

  /** 造一行 range 窗口日志 */
  function row(
    createdAt: string, phase: string | null, latencyMs: number,
    status: 'success' | 'error' = 'success', errorKind?: string,
  ) {
    return {
      service: 'qwen_plus', estimated_cost_cny: 1, latency_ms: latencyMs, status,
      created_at: createdAt,
      metadata: phase == null && !errorKind ? null : { phase: phase ?? undefined, error_kind: errorKind },
    }
  }

  beforeEach(() => {
    jest.setSystemTime(new Date(NOW_ISO))
  })

  test('耗时统计只取口径断点之后的行，按 P90 降序', async () => {
    const rangeRows = [
      // 断点【之前】：ranking 一条 60s 的旧口径行（总时长记两遍的产物），必须被完全排除
      row('2026-07-18T01:00:00Z', 'ranking', 60_000),
      // 断点之后
      row('2026-07-21T01:00:00Z', 'ranking',  2_000),
      row('2026-07-21T02:00:00Z', 'ranking',  4_000),
      row('2026-07-24T01:00:00Z', 'analysis', 18_000),
      row('2026-07-24T01:10:00Z', 'analysis', 20_000),
    ]
    wireSupabase({ range: rangeRows })
    const body = await (await GET(new Request('http://localhost/api/dashboard?range=7d'))).json()

    // 断点前那条 60s 若混入，ranking 的 max 会是 60000、且会排到最前
    const ranking = body.phaseLatency.find((p: { phase: string }) => p.phase === 'ranking')
    expect(ranking.calls).toBe(2)
    expect(ranking.max).toBe(4000)
    // 按 P90 降序：analysis（20s）在 ranking（4s）之前
    expect(body.phaseLatency[0].phase).toBe('analysis')
    expect(body.latencyCutoff).toBe('2026-07-21')

    // 趋势：断点之前的日子必须是 null（给 0 会被画成"那几天延迟为零"的假谷底）
    const analysisTrend = body.latencyTrend.find((t: { phase: string }) => t.phase === 'analysis')
    const d18 = analysisTrend.days.find((d: { date: string }) => d.date === '7/18')
    expect(d18.p50).toBeNull()
    expect(d18.calls).toBe(0)
    const d24 = analysisTrend.days.find((d: { date: string }) => d.date === '7/24')
    expect(d24.calls).toBe(2)
    // 趋势最多只画最慢的 3 个环节
    expect(body.latencyTrend.length).toBeLessThanOrEqual(3)
  })

  test('每日失败只数系统故障，今日状况给出今日失败数与近 7 日基线', async () => {
    const rangeRows = [
      row('2026-07-21T01:00:00Z', 'ranking', 1_000, 'error'),            // 系统故障（非今日）
      row('2026-07-24T01:00:00Z', 'ranking', 1_000, 'error'),            // 今日系统故障
      row('2026-07-24T01:05:00Z', 'ranking', 1_000, 'error'),            // 今日系统故障
      row('2026-07-24T01:10:00Z', null,      1_000, 'error', 'user_input'), // 今日空录音：不计
      row('2026-07-24T02:00:00Z', 'ranking', 1_000),
    ]
    wireSupabase({ range: rangeRows })
    const body = await (await GET(new Request('http://localhost/api/dashboard?range=7d'))).json()

    const d21 = body.dailyFailures.find((d: { date: string }) => d.date === '7/21')
    const d24 = body.dailyFailures.find((d: { date: string }) => d.date === '7/24')
    expect(d21.failures).toBe(1)
    // 空录音那条若被算进来会是 3 —— 那正是"真故障被噪音淹掉"的样子
    expect(d24.failures).toBe(2)
    expect(body.dailyFailures.length).toBe(7)

    expect(body.todayStatus.todayFailures).toBe(2)
    expect(body.todayStatus.avgDailyFailures7).toBe(0.43)   // 3 次系统故障 / 7 天
    expect(body.todayStatus.slowestPhase.name).toBe('题目重排')
  })

  test('失败明细独立透传（含 error_kind），是每日失败柱图的下钻出口', async () => {
    const failedRows = [
      { id: 'f1', created_at: '2026-07-24T01:00:00Z', service: 'qwen_plus', endpoint: 'x/completions',
        usage_amount: 10, usage_unit: 'tokens', estimated_cost_cny: 0.2, latency_ms: 900, status: 'error',
        metadata: { phase: 'ranking' } },
      { id: 'f2', created_at: '2026-07-23T01:00:00Z', service: 'doubao_asr', endpoint: 'x/asr',
        usage_amount: 3, usage_unit: 'sec', estimated_cost_cny: 0.01, latency_ms: 300, status: 'error',
        metadata: { error_kind: 'user_input' } },
    ]
    wireSupabase({ failed: failedRows })
    const body = await (await GET(new Request('http://localhost/api/dashboard?range=7d'))).json()

    expect(body.failedLogs).toHaveLength(2)
    expect(body.failedLogs[0].id).toBe('f1')
    // error_kind 必须透传：明细表要能区分系统故障与用户输入问题，否则一屏全是"失败"没信息量
    expect(body.failedLogs[1].metadata.error_kind).toBe('user_input')
  })
})

/**
 * ⑩ 分页守卫 —— 回归 2026-07-20 实测的静默少报：
 * PostgREST 对不带 range 的 select 强制只返回前 1000 行且不报错，看板据此把
 * 真实 1237 行 / ¥13.7828 显示成 1000 次 / ¥12.01（少 12.9%），且行数越涨少报越多。
 * 这组用例统一把数据造到 1000 行以上，并【刻意把关键行放在第 1000 行之后】——
 * 一旦分页退化回裸查，这些断言必然全红。
 */
describe('GET /api/dashboard · 超 1000 行分页汇总', () => {
  test('全时段 1237 行：总花费/调用数/按用户归因均跨页完整，不被截断在 1000', async () => {
    // 前 1000 行归 u_head（各 ¥0.01），第 1000 行【之后】的 237 行归 u_tail（各 ¥0.02）。
    // 若只取到首页：总额会是 ¥10.00、u_tail 整个人凭空消失。
    const allTimeRows = [
      ...Array.from({ length: 1000 }, () => ({
        estimated_cost_cny: 0.01, user_id: 'u_head', is_anonymous: false,
      })),
      ...Array.from({ length: 237 }, () => ({
        estimated_cost_cny: 0.02, user_id: 'u_tail', is_anonymous: true,
      })),
    ]
    wireSupabase({ allTime: allTimeRows })
    const res = await GET(new Request('http://localhost/api/dashboard?range=7d'))
    const body = await res.json()

    // 调用数与总额取全量：1237 次 / 10 + 4.74 = ¥14.74（而非截断值 1000 次 / ¥10.00）
    expect(body.allTimeCalls).toBe(1237)
    expect(body.allTimeCost).toBe(14.74)

    // 按用户成本 Top-N 同样跨页：只存在于尾页的 u_tail 必须出现且金额完整
    expect(body.userTotals).toEqual([
      { userId: 'u_head', isAnonymous: false, cost: 10,   calls: 1000 },
      { userId: 'u_tail', isAnonymous: true,  cost: 4.74, calls: 237 },
    ])
    // 匿名/登录占比也来自同一次全量查询
    expect(body.anonymousCost).toBe(4.74)
    expect(body.loggedInCost).toBe(10)

    // 正常翻页到底，未触发 MAX_PAGES 截断
    expect(body.dataTruncated).toBe(false)
  })

  test('range 窗口 1500 行：错误率 / 失败成本两套口径跨页各自成立', async () => {
    // 1400 条成功在前，100 条失败【全部排在第 1400 行之后】：50 条系统故障（各 ¥0.3）、
    // 50 条空录音 user_input（各 ¥0.6）。裸查只看得到前 1000 行时，失败成本会是 ¥0。
    const success = () => ({
      service: 'qwen_plus', estimated_cost_cny: 0.01, latency_ms: 100, status: 'success',
      created_at: '2026-07-18T01:00:00Z', metadata: { phase: 'coach', cost_source: 'actual' },
    })
    const rangeRows = [
      ...Array.from({ length: 1400 }, success),
      ...Array.from({ length: 50 }, () => ({
        service: 'qwen_plus', estimated_cost_cny: 0.3, latency_ms: 10, status: 'error',
        created_at: '2026-07-18T01:00:00Z', metadata: { phase: 'coach' },
      })),
      ...Array.from({ length: 50 }, () => ({
        service: 'qwen_plus', estimated_cost_cny: 0.6, latency_ms: 900, status: 'error',
        created_at: '2026-07-18T01:00:00Z', metadata: { phase: 'coach', error_kind: 'user_input' },
      })),
    ]
    wireSupabase({ range: rangeRows })
    const res = await GET(new Request('http://localhost/api/dashboard?range=7d'))
    const body = await res.json()

    // 错误率只数系统故障：50 / 1500 = 3.33%（不是把空录音也算进去的 6.67%）
    expect(body.errorRate).toBe(3.33)
    // 失败成本【全量】统计 error 行：50×0.3 + 50×0.6 = ¥45（空录音的钱也是真花了）
    expect(body.failedCost).toBe(45)

    // 按环节下钻同样跨页：coach 环节 1500 次调用、50 次系统故障、errorCost 全量 ¥45
    const coach = body.phaseTotals.find((p: { phase: string }) => p.phase === 'coach')
    expect(coach.calls).toBe(1500)
    expect(coach.errors).toBe(50)
    expect(coach.errorCost).toBe(45)

    // 日均调用基于全量行数：1500 / 7 天
    expect(body.avgDailyCalls).toBe(214.29)
    // 小时桶也拿到全量：1500 条都落在香港 9:00
    const h9 = body.hourlyData.find((h: { hour: string }) => h.hour === '9:00')
    expect(h9.calls).toBe(1500)
  })

  test('边界：恰好 1000 行（整除页大小）不多不少、也不空转', async () => {
    // 首页满员时无法判断"是否到底"，必须再翻一页拿到空结果才停 —— 这里钉死不会少算也不会死循环。
    const allTimeRows = Array.from({ length: 1000 }, () => ({
      estimated_cost_cny: 0.01, user_id: 'u1', is_anonymous: false,
    }))
    wireSupabase({ allTime: allTimeRows })
    const res = await GET(new Request('http://localhost/api/dashboard?range=7d'))
    const body = await res.json()
    expect(body.allTimeCalls).toBe(1000)
    expect(body.allTimeCost).toBe(10)
    expect(body.dataTruncated).toBe(false)
  })
})

/**
 * 假空率：区间内空录音（error_kind=user_input）里带 audio 采集信号的行，按 peak 阈值判真空/假空。
 * 只把带 audio 字段的空录音计入分母（口径生效前的老空录音无该字段、排除不误算）；
 * 无带信号样本 → fakeEmpty=null + pending=true，前端保留「待接入」不显误导 0%。
 */
describe('GET /api/dashboard · 假空率（空录音真伪）', () => {
  /** 造一行区间内的空录音（user_input）日志，可带/不带 audio 采集信号 */
  function emptyRow(createdAt: string, audio?: { peak: number; durMs: number; bytes: number }) {
    return {
      service: 'doubao_asr', estimated_cost_cny: 0.0001, latency_ms: 100, status: 'error',
      created_at: createdAt,
      metadata: { phase: 'transcribe_practice', error_kind: 'user_input', ...(audio ? { audio } : {}) },
      user_id: 'u1', is_anonymous: false,
    }
  }

  test('带信号的空录音按阈值(0.15)判真伪：峰值高=假空、峰值低=真空，率+样本量 n 正确', async () => {
    const rangeRows = [
      emptyRow('2026-07-15T02:00:00Z', { peak: 0.42, durMs: 3200, bytes: 8000 }), // 假空（采到声音却空）
      emptyRow('2026-07-15T03:00:00Z', { peak: 0.20, durMs: 2800, bytes: 6000 }), // 假空
      emptyRow('2026-07-15T04:00:00Z', { peak: 0.05, durMs: 1500, bytes: 4000 }), // 真空（用户真没出声）
      emptyRow('2026-07-15T05:00:00Z'),                                            // 老数据无 audio → 不计入分母
      // 非空录音的系统故障（无 user_input）：绝不计入假空率
      { service: 'qwen_plus', estimated_cost_cny: 1, latency_ms: 100, status: 'error',
        created_at: '2026-07-15T06:00:00Z', metadata: { phase: 'coach' }, user_id: 'u2', is_anonymous: false },
    ]
    wireSupabase({ range: rangeRows })

    const body = await (await GET(new Request('http://localhost/api/dashboard?range=7d'))).json()

    // 分母只算 3 条带 audio 的空录音（老数据那条与系统故障那条都排除）；假空 2 / 3 = 66.67%
    expect(body.fakeEmpty).toEqual({ rate: 66.67, n: 3, fakeCount: 2 })
    expect(body.fakeEmptyPending).toBe(false)
    expect(body.fakeEmptyThreshold).toBe(0.15)
  })

  test('区间内只有无 audio 的老空录音：降级为 pending，不显误导 0%', async () => {
    wireSupabase({ range: [emptyRow('2026-07-15T02:00:00Z'), emptyRow('2026-07-15T03:00:00Z')] })

    const body = await (await GET(new Request('http://localhost/api/dashboard?range=7d'))).json()

    expect(body.fakeEmpty).toBeNull()
    expect(body.fakeEmptyPending).toBe(true)
  })
})
