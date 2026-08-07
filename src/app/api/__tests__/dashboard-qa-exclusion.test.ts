/**
 * @module   api/dashboard-qa-exclusion.test
 * @desc     成本看板「剔除 QA 自测流量」守卫（迁移 0059）——钉死三件事：
 *           ① is_qa=true 的行从全部成本口径里剔掉（累计卡 / 今日卡 / 区间统计 / 按用户 Top-N），
 *             与内部账户【同一档】；
 *           ② is_qa=NULL 的历史行【不】被误剔：0059 生效前的行没有判定依据，把「未知」当成「是自测」
 *             会让历史成本凭空缩水。这正是过滤必须写 `is_qa IS NOT TRUE` 而不是 `= false` 的理由；
 *           ③ QA 过滤只套在 api_usage_logs 上：practice_sessions / profiles 没有这一列，套上去真库
 *             直接报「column does not exist」、整张看板 500。
 *           另守响应把口径起算日（COST_QA_BASELINE_START）带给前端，供费用区的口径小字用。
 *
 *   ⚠️ 本文件的 supabase mock 【真的会执行 is_qa 过滤】（按 PostgREST 语义解释 route 套上的过滤器），
 *      不是只维持链式返回自身 —— 否则「有没有滤对」根本测不出来，route 把过滤删了测试照样绿。
 *      认不出的 is_qa 过滤形态一律抛错：换一种写法就必须在这里明确它的 NULL 语义，不许悄悄溜过去。
 * @author   LingoBridge
 * @created  2026-08-08
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
import { COST_QA_BASELINE_START } from '@/lib/db/dashboard-shared'

const mockGetSupabase = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

/** 一行 api_usage_logs（只给 route 会读到的列 + 供 mock 过滤用的 is_qa） */
type LogRow = {
  estimated_cost_cny: number
  user_id: string | null
  is_anonymous: boolean | null
  status: 'success' | 'error'
  service: string
  latency_ms: number
  created_at: string
  metadata: Record<string, unknown> | null
  /** 迁移 0059 的列：true=产品方自测；null=迁移生效前的历史行（无从判定） */
  is_qa: boolean | null
}

/** 一次查询链上捕获到的过滤条件 */
type Captured = {
  table: string
  select: string
  eq: Array<[string, unknown]>
  not: Array<[string, string, unknown]>
}

/** 各表被套过的 not 过滤（用例据此断言「只有 api_usage_logs 套了 QA 过滤」） */
let notByTable: Array<{ table: string; col: string; op: string; val: unknown }> = []

/**
 * 按 PostgREST 语义对 is_qa 过滤求值（三值逻辑，NULL 的处理正是本守卫的核心）。
 * @param rows  该查询的候选行
 * @param q     捕获到的过滤条件
 * @returns     过滤后的行
 */
function applyQaFilter(rows: LogRow[], q: Captured): LogRow[] {
  const nots = q.not.filter(([col]) => col === 'is_qa')
  const eqs  = q.eq.filter(([col]) => col === 'is_qa')
  // 一条 is_qa 过滤都没套：原样返回（QA 行会混进结果 → 下面的断言立刻转红，这就是「删了过滤即失败」）
  if (nots.length === 0 && eqs.length === 0) return rows
  let out = rows
  for (const [, op, val] of nots) {
    // `.not('is_qa','is',true)` → SQL `is_qa IS NOT TRUE`：对 false 与 NULL 均为真，两者都保留
    if (op === 'is' && val === true) out = out.filter(r => r.is_qa !== true)
    else throw new Error(`未识别的 is_qa 过滤：not.${op}.${String(val)} —— 换写法必须先在此明确它的 NULL 语义`)
  }
  for (const [, val] of eqs) {
    // `.eq('is_qa', false)` → SQL `is_qa = false`：NULL = false 求值为 NULL（非真）→ 历史行被一并滤掉
    if (val === false) out = out.filter(r => r.is_qa === false)
    else throw new Error(`未识别的 is_qa 过滤：eq.${String(val)} —— 换写法必须先在此明确它的 NULL 语义`)
  }
  return out
}

/**
 * 装配 supabase mock：api_usage_logs 的各条查询都喂同一批行（经真实 is_qa 过滤），其余表空表。
 * 时间过滤（gte/lt）一律忽略：本套只关心 QA 过滤，行的 created_at 统一造在「香港今日」。
 * @param rows  api_usage_logs 候选行
 */
function wire(rows: LogRow[]): void {
  notByTable = []
  const makeBuilder = (table: string) => {
    const q: Captured = { table, select: '', eq: [], not: [] }
    const b: Record<string, unknown> = {}
    const self = () => b
    b.select = (cols: string) => { q.select = cols; return b }
    b.gte = self; b.lt = self; b.or = self; b.order = self; b.limit = self
    b.eq = (col: string, v: unknown) => { q.eq.push([col, v]); return b }
    b.not = (col: string, op: string, v: unknown) => {
      q.not.push([col, op, v])
      notByTable.push({ table, col, op, val: v })
      return b
    }
    const rowsOf = (): LogRow[] => {
      if (table !== 'api_usage_logs') return []
      // 失败明细那条自带 .eq('status','error')：照做，免得它把成功行也算进失败清单
      const base = q.eq.some(([c, v]) => c === 'status' && v === 'error')
        ? rows.filter(r => r.status === 'error')
        : rows
      return applyQaFilter(base, q)
    }
    b.range = (from: number, to: number) => ({
      then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rowsOf().slice(from, to + 1), error: null }),
    })
    b.then = (resolve: (r: { data: unknown[]; error: null }) => void) => resolve({ data: rowsOf(), error: null })
    return b
  }
  mockGetSupabase.mockReturnValue({
    from: (table: string) => makeBuilder(table),
    // 各指标 RPC 一律不可用 → 走各自既有降级（本套不关心它们）
    rpc: () => Promise.resolve({ data: null, error: { message: 'not deployed' } }),
    auth: { admin: { listUsers: () => Promise.resolve({ data: { users: [] }, error: null }) } },
  } as never)
}

/** 造一行成本日志（默认成功、qwen_plus、香港今日 10:00 前的一小时） */
function logRow(cost: number, isQa: boolean | null, userId: string | null = 'u1'): LogRow {
  return {
    estimated_cost_cny: cost,
    user_id: userId,
    is_anonymous: false,
    status: 'success',
    service: 'qwen_plus',
    latency_ms: 100,
    created_at: '2026-08-08T01:00:00Z',   // 香港 08-08 09:00，落在「今日」与区间窗口内
    metadata: { phase: 'analysis' },
    is_qa: isQa,
  }
}

/** 真实用户 ¥1 / 迁移生效前的历史行 ¥2（is_qa=NULL）/ 产品方自测 ¥100 */
const REAL_ROW    = logRow(1, false, 'real-user')
const LEGACY_ROW  = logRow(2, null, 'legacy-user')
const QA_ROW      = logRow(100, true, 'qa-user')

beforeEach(() => {
  jest.clearAllMocks()
  // 冻结时刻 UTC 2026-08-08 02:00 → 香港 10:00（口径起算日当天，与行的 created_at 同日）
  jest.useFakeTimers().setSystemTime(new Date('2026-08-08T02:00:00Z'))
})
afterEach(() => { jest.useRealTimers() })

describe('GET /api/dashboard · QA 自测流量从成本口径剔除', () => {
  test('is_qa=true 的行不进任何成本口径（累计 / 今日 / 区间 / 按用户 Top-N）', async () => {
    wire([REAL_ROW, QA_ROW])
    const body = await (await GET(new Request('http://localhost/api/dashboard?range=7d'))).json()

    // ¥100 的自测行一分钱都不该出现（漏了任何一处，下面某个数字就会变成 101）
    expect(body.allTimeCost).toBe(1)
    expect(body.allTimeCalls).toBe(1)
    expect(body.todayCost).toBe(1)
    expect(body.todayCalls).toBe(1)
    expect(body.avgDailyCost).toBe(0.14)             // ¥1 / 7 天
    expect(body.phaseTotals).toEqual([expect.objectContaining({ phase: 'analysis', cost: 1, calls: 1 })])
    // 按用户 Top-N：自测号不该出现在榜上，也不进匿名/登录占比
    expect(body.userTotals).toEqual([expect.objectContaining({ userId: 'real-user', cost: 1 })])
    expect(body.loggedInCost).toBe(1)
  })

  test('is_qa=NULL 的历史行照常计入（NULL ≠ true：宁可少剔，绝不把「未知」当自测剔掉）', async () => {
    wire([REAL_ROW, LEGACY_ROW, QA_ROW])
    const body = await (await GET(new Request('http://localhost/api/dashboard?range=7d'))).json()

    // ¥1(真实) + ¥2(历史 NULL) = ¥3；¥100(自测) 被剔
    expect(body.allTimeCost).toBe(3)
    expect(body.allTimeCalls).toBe(2)
    expect(body.todayCost).toBe(3)
    expect(body.userTotals.map((u: { userId: string }) => u.userId).sort()).toEqual(['legacy-user', 'real-user'])
  })

  test('失败明细/失败成本同样剔除自测（失败也烧钱，自测的白烧不该算在真实账上）', async () => {
    const realFail = { ...logRow(0.5, false, 'real-user'), status: 'error' as const }
    const qaFail   = { ...logRow(50, true, 'qa-user'),     status: 'error' as const }
    wire([realFail, qaFail])
    const body = await (await GET(new Request('http://localhost/api/dashboard?range=7d'))).json()

    expect(body.failedCost).toBe(0.5)
    expect(body.failedLogs).toHaveLength(1)
    expect(body.failedLogs[0].userIdShort).toBe('real-use')
  })

  test('QA 过滤只套在 api_usage_logs 上（practice_sessions / profiles 没有 is_qa 列，套了真库直接 500）', async () => {
    wire([REAL_ROW])
    await GET(new Request('http://localhost/api/dashboard?range=7d'))

    const qaFilters = notByTable.filter(n => n.col === 'is_qa')
    // 八条成本查询逐条套（少一条就有一处口径没剔干净）
    expect(qaFilters).toHaveLength(8)
    expect(qaFilters.every(n => n.table === 'api_usage_logs')).toBe(true)
    // 形态锁死：is_qa IS NOT TRUE（NULL 安全）。改成 eq(false) 会连历史行一起滤掉，上一条用例会转红
    expect(qaFilters.every(n => n.op === 'is' && n.val === true)).toBe(true)
  })

  test('响应带回口径起算日（前端费用区口径小字的唯一数据源）', async () => {
    wire([REAL_ROW])
    const body = await (await GET(new Request('http://localhost/api/dashboard?range=7d'))).json()
    expect(body.costQaBaselineStart).toBe(COST_QA_BASELINE_START)
    // 形如 2026-08-08 的日期串（前端直接显示，别塞进别的形态）
    expect(body.costQaBaselineStart).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
