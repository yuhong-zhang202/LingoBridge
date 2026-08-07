/**
 * @module   api/dashboard-user-identity.test
 * @desc     成本看板「按用户成本 Top-N / 匿名占比」的身份口径守卫（迁移 0058）——钉死本次修的那个线上误导：
 *           ① 先匿名试用、后注册的【转化用户】（user_id 不变、留着匿名历史行）绝不能被标成匿名，
 *             其匿名期成本也算登录侧（线上个案 ca15d8e8：匿名期 2 次调用即注册、之后作为注册用户用了 107 次，
 *             却在成本榜上顶着「匿名」排第一）；
 *           ② 当前仍匿名的用户照常标匿名；
 *           ③ 历史 is_anonymous=NULL 的行（analysis/phrases/matching 三路由 2026-08-07 前漏写）不崩，
 *             有 user_id 就按当前身份归类、无 user_id 一律不进榜也不进占比分母；
 *           ④ 身份 RPC 不可用（0058 未跑 / 出错 / 结果疑似被截断）→ 逐字回退旧标记口径、不抛，
 *             且 route 置 userIdentityPending=true 供前端标「口径待生效」。
 *           纯函数直测 + 一遍走 GET 的集成断言（确认 route 真把身份表接进去了，而不是只测了纯函数）。
 * @author   LingoBridge
 * @created  2026-08-07
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
import { aggregateUserCosts, fetchUserAnonFlags, type UserCostRow } from '@/lib/db/dashboard-metrics'

const mockGetSupabase = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

/** 造一行全时段归因行 */
function row(cost: number, userId: string | null, isAnon: boolean | null): UserCostRow {
  return { estimated_cost_cny: cost, user_id: userId, is_anonymous: isAnon }
}

// ── 线上个案还原（ca15d8e8）：匿名期 2 次调用 ¥0.175，注册后 107 次 ¥5.09；auth.users 现为非匿名 ──
const CONVERTED = 'ca15d8e8'
const STILL_ANON = 'anon-1'

/** 转化用户的成本行：2 条匿名期 + 3 条注册期（次数不求还原 107 条，只求两段身份都在） */
const CONVERTED_ROWS: UserCostRow[] = [
  row(0.1,  CONVERTED, true),   // 匿名期：录故事
  row(0.075, CONVERTED, true),  // 匿名期：整理
  row(2,    CONVERTED, false),  // 注册后
  row(2,    CONVERTED, false),
  row(1.09, CONVERTED, false),
]

describe('aggregateUserCosts · 身份取【当前】身份，不取历史调用标记', () => {
  test('转化用户（有匿名历史行、现已注册）不标匿名，且全部成本计入登录侧', () => {
    const identities = new Map<string, boolean>([[CONVERTED, false]])
    const out = aggregateUserCosts(CONVERTED_ROWS, identities, 20)

    expect(out.userTotals).toEqual([
      { userId: CONVERTED, isAnonymous: false, cost: 5.27, calls: 5 },
    ])
    // 匿名期那 ¥0.175 也归登录侧：与榜单标签同源，两个数字可对账
    expect(out.loggedInCost).toBe(5.27)
    expect(out.anonymousCost).toBe(0)
  })

  test('当前仍匿名的用户照常标匿名；两类用户同时在榜时各归各侧', () => {
    const rows = [...CONVERTED_ROWS, row(30, STILL_ANON, true)]
    const identities = new Map<string, boolean>([[CONVERTED, false], [STILL_ANON, true]])
    const out = aggregateUserCosts(rows, identities, 20)

    // 成本降序：仍匿名的 30 在转化用户 5.27 之前
    expect(out.userTotals).toEqual([
      { userId: STILL_ANON, isAnonymous: true,  cost: 30,   calls: 1 },
      { userId: CONVERTED,  isAnonymous: false, cost: 5.27, calls: 5 },
    ])
    expect(out.anonymousCost).toBe(30)
    expect(out.loggedInCost).toBe(5.27)
  })

  test('历史 is_anonymous=NULL 的行：有 user_id 照常按当前身份归类，无 user_id 不进榜也不进分母', () => {
    const rows = [
      row(1, CONVERTED, null),    // analysis/phrases/matching 2026-08-07 前漏写的历史行
      row(2, CONVERTED, false),
      row(3, STILL_ANON, null),
      row(9, null, null),         // 补归属列前的老行：无法归因到人
    ]
    const identities = new Map<string, boolean>([[CONVERTED, false], [STILL_ANON, true]])
    const out = aggregateUserCosts(rows, identities, 20)

    expect(out.userTotals).toEqual([
      { userId: CONVERTED,  isAnonymous: false, cost: 3, calls: 2 },
      { userId: STILL_ANON, isAnonymous: true,  cost: 3, calls: 1 },
    ])
    // NULL 标记不再让两侧漏算：有 user_id 的行全部按当前身份进了对应侧
    expect(out.loggedInCost).toBe(3)
    expect(out.anonymousCost).toBe(3)
    // 无归属的 ¥9 两侧都不计（占比分母只含可归因成本）
    expect(out.anonymousCost + out.loggedInCost).toBe(6)
  })

  test('身份表缺该 id（账号已注销 / 映射不全）→ 退回旧标记，不当成注册用户', () => {
    const rows = [row(1, 'gone-user', true), row(2, 'gone-user', false)]
    const out = aggregateUserCosts(rows, new Map<string, boolean>(), 20)
    expect(out.userTotals).toEqual([{ userId: 'gone-user', isAnonymous: true, cost: 3, calls: 2 }])
    expect(out.anonymousCost).toBe(3)
    expect(out.loggedInCost).toBe(0)
  })

  test('identities=null（0058 未跑）→ 逐字回退旧口径：有一条匿名即标匿名 + 占比按行分摊', () => {
    const rows = [...CONVERTED_ROWS, row(30, STILL_ANON, true), row(9, null, null)]
    const out = aggregateUserCosts(rows, null, 20)

    // 旧口径下转化用户被误标匿名（这正是本次要修的误导；降级路径必须【原样保留】它，不能半修）
    expect(out.userTotals).toEqual([
      { userId: STILL_ANON, isAnonymous: true, cost: 30,   calls: 1 },
      { userId: CONVERTED,  isAnonymous: true, cost: 5.27, calls: 5 },
    ])
    // 占比按【行】标记分摊：匿名 0.1+0.075+30 = 30.18；登录 2+2+1.09 = 5.09；NULL 行两侧都不计
    expect(out.anonymousCost).toBe(30.18)
    expect(out.loggedInCost).toBe(5.09)
  })

  test('topN 截断按成本降序生效（榜单只留最烧钱的前 N 名）', () => {
    const rows = [row(1, 'a', false), row(5, 'b', false), row(3, 'c', false)]
    const out = aggregateUserCosts(rows, new Map([['a', false], ['b', false], ['c', false]]), 2)
    expect(out.userTotals.map(u => u.userId)).toEqual(['b', 'c'])
    // 占比不受 topN 影响：三人成本全额计入登录侧
    expect(out.loggedInCost).toBe(9)
  })
})

describe('fetchUserAnonFlags · RPC 读取与降级', () => {
  /** 造一个只实现 rpc 的假 supabase */
  function fakeSupabase(rpc: jest.Mock): Parameters<typeof fetchUserAnonFlags>[0] {
    return { rpc } as unknown as Parameters<typeof fetchUserAnonFlags>[0]
  }

  test('正常返回 → 映射为 user_id → 当前是否匿名', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ id: CONVERTED, is_anonymous: false }, { id: STILL_ANON, is_anonymous: true }],
      error: null,
    })
    const map = await fetchUserAnonFlags(fakeSupabase(rpc))
    expect(rpc).toHaveBeenCalledWith('get_user_anon_flags')
    expect(map?.get(CONVERTED)).toBe(false)
    expect(map?.get(STILL_ANON)).toBe(true)
  })

  test('RPC 报错（迁移 0058 未跑，PGRST202）→ null，不抛', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'function does not exist' } })
    await expect(fetchUserAnonFlags(fakeSupabase(rpc))).resolves.toBeNull()
  })

  test('rpc 直接抛（网络/客户端异常）→ null，不抛', async () => {
    const rpc = jest.fn().mockRejectedValue(new Error('boom'))
    await expect(fetchUserAnonFlags(fakeSupabase(rpc))).resolves.toBeNull()
  })

  test('返回 ≥1000 行（PostgREST 静默截断）→ 整块降级 null，绝不拿半张身份表标人', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: `u${i}`, is_anonymous: false }))
    const rpc = jest.fn().mockResolvedValue({ data: many, error: null })
    await expect(fetchUserAnonFlags(fakeSupabase(rpc))).resolves.toBeNull()
    // 999 行（未触顶）仍正常返回，确认阈值判定不是把正常结果也一并毙掉
    const ok = jest.fn().mockResolvedValue({ data: many.slice(0, 999), error: null })
    expect((await fetchUserAnonFlags(fakeSupabase(ok)))?.size).toBe(999)
  })

  test('is_anonymous 回 null（口径被改坏）→ 按匿名处理，不静默当注册', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [{ id: 'x', is_anonymous: null }], error: null })
    expect((await fetchUserAnonFlags(fakeSupabase(rpc)))?.get('x')).toBe(true)
  })
})

// ── 集成：走真实 GET，确认 route 把身份表接进了 Top-N（不是只有纯函数对） ──────────────

/** route 里「全时段归因」查询的 select 串（唯一取这三列的一条） */
const ALLTIME_SELECT = 'estimated_cost_cny, user_id, is_anonymous'

/**
 * 装配 supabase mock：只给全时段归因查询喂行，其余查询一律空表；
 * rpc 仅认 get_user_anon_flags，其它指标 RPC 一律报错走各自既有降级（本测试不关心它们）。
 * @param allTimeRows  全时段归因行
 * @param flags        get_user_anon_flags 的返回行；null = 模拟迁移 0058 未跑
 */
function wire(allTimeRows: UserCostRow[], flags: Array<{ id: string; is_anonymous: boolean }> | null): void {
  const makeBuilder = () => {
    let select = ''
    const b: Record<string, unknown> = {}
    const self = () => b
    b.select = (cols: string) => { select = cols; return b }
    // .not 是 0059 的 QA 流量排除（`.not(...EXCLUDE_QA_TRAFFIC)`）：本测试的行不带 is_qa，
    // 过滤无影响，只需维持链式；它滤得对不对由 dashboard-qa-exclusion.test.ts 专测。
    b.gte = self; b.lt = self; b.eq = self; b.or = self; b.not = self; b.order = self; b.limit = self
    const rows = (): unknown[] => (select === ALLTIME_SELECT ? allTimeRows : [])
    b.range = (from: number, to: number) => ({
      then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rows().slice(from, to + 1), error: null }),
    })
    b.then = (resolve: (r: { data: unknown[]; error: null }) => void) => resolve({ data: rows(), error: null })
    return b
  }
  mockGetSupabase.mockReturnValue({
    from: () => makeBuilder(),
    rpc: (fn: string) => (fn === 'get_user_anon_flags' && flags !== null
      ? Promise.resolve({ data: flags, error: null })
      : Promise.resolve({ data: null, error: { message: 'not deployed' } })),
  } as never)
}

describe('GET /api/dashboard · Top-N 身份口径落到接口返回', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers().setSystemTime(new Date('2026-08-07T02:00:00Z'))
  })
  afterEach(() => { jest.useRealTimers() })

  test('0058 已跑：转化用户不标匿名、成本进登录侧，userIdentityPending=false', async () => {
    wire([...CONVERTED_ROWS, row(30, STILL_ANON, true)],
      [{ id: CONVERTED, is_anonymous: false }, { id: STILL_ANON, is_anonymous: true }])

    const res = await GET(new Request('http://localhost/api/dashboard?range=7d'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.userTotals).toEqual([
      { userId: STILL_ANON, isAnonymous: true,  cost: 30,   calls: 1 },
      { userId: CONVERTED,  isAnonymous: false, cost: 5.27, calls: 5 },
    ])
    expect(body.anonymousCost).toBe(30)
    expect(body.loggedInCost).toBe(5.27)
    expect(body.userIdentityPending).toBe(false)
  })

  test('0058 未跑：整块降级回旧口径 + userIdentityPending=true，接口不 500', async () => {
    wire([...CONVERTED_ROWS, row(30, STILL_ANON, true)], null)

    const res = await GET(new Request('http://localhost/api/dashboard?range=7d'))
    expect(res.status).toBe(200)
    const body = await res.json()

    // 降级 = 今天的行为：转化用户仍被标匿名（前端据 pending 标注「口径待生效」，不静默显错数）
    expect(body.userTotals).toEqual([
      { userId: STILL_ANON, isAnonymous: true, cost: 30,   calls: 1 },
      { userId: CONVERTED,  isAnonymous: true, cost: 5.27, calls: 5 },
    ])
    expect(body.anonymousCost).toBe(30.18)
    expect(body.loggedInCost).toBe(5.09)
    expect(body.userIdentityPending).toBe(true)
  })
})
