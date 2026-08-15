/**
 * @module   api/dashboard-refactor-golden.test
 * @desc     **拆分重构的行为守卫**（P1）——把 /api/dashboard 在一组固定输入下的**完整响应 JSON**
 *           钉成金标，重构前后必须逐字节一致。
 *
 *   【为什么需要它】P1 要把 route.ts(739 行) 按主题拆到 src/lib/db/ 下。验收要求「重构前后页面
 *   每个数字完全一致」，但**对着线上库前后各抓一次是证不出来的**：`parseRange` 只有 7/14/30 天、
 *   区间末端永远是「此刻」，两次抓取之间数据本身就在变，差异分不清是重构引入的还是自然增长。
 *   故改为：喂**固定的假数据行 + 固定的 RPC 返回 + 冻结时钟**，把整个响应快照下来。
 *   响应 JSON 一致 ⇒ 页面上每个数字一致（页面所有数字都源自这 63 个顶层键）。
 *
 *   【与 dashboard-aggregation.test.ts 的分工】那份钉的是**具体口径**（按环节聚合、估算占比、
 *   日界折算…），断言写死了各项含义，是**口径守卫**；本份不解释任何字段含义，只做**全量快照比对**，
 *   是**重构守卫**。前者防口径被改错，后者防搬运途中任何字段被悄悄改动——包括那些没人写过断言的字段。
 *
 *   ⚠️ **实施重构的人不得修改本文件与金标 JSON**。金标由重构前的代码产出、已提交；
 *      若重构后不一致，那是重构改了行为，不是金标过时。确需更新金标只能由人明示。
 *
 *   ⚠️ 本守卫**不覆盖前端渲染**（page.tsx 是 client component，靠 useEffect 取数，
 *      renderToStaticMarkup 只能拿到加载态）。前端搬运由 dashboard-page-verbatim.test.ts 守。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

import fs from 'fs'
import path from 'path'
import { GET } from '@/app/api/dashboard/route'
import { getSupabaseServer } from '@/lib/supabase-server'

const mockGetSupabase = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

const GOLDEN_PATH = path.join(__dirname, '__golden__', 'dashboard-response.json')

// 冻结时刻 UTC 2026-08-10T02:00Z（香港 08-10 10:00）。香港「今日」00:00 = 2026-08-09T16:00:00Z。
// ⚠️ 刻意【晚于】LATENCY_CUTOFF_TS（2026-07-20T19:00Z）：延迟聚合只收断点之后的行，
//    若把时钟冻在断点前（如 dashboard-aggregation.test.ts 用的 07-18），phaseLatency /
//    latencyTrend 恒为空数组——金标就守不住这两条计算路径了。
const FROZEN_NOW = '2026-08-10T02:00:00Z'
const TODAY_START_ISO = '2026-08-09T16:00:00.000Z'
const PG_MAX_ROWS = 1000

type QueryKey = 'allTime' | 'month' | 'lastMonth' | 'today' | 'range' | 'recent' | 'costly' | 'failed' | 'practice' | 'profiles'
type Captured = { select: string; gte: string[]; lt: string[]; eq: string[]; limit: number | null }

/**
 * 按查询特征反推是十条中的哪一条。
 * 分派逻辑与 dashboard-aggregation.test.ts 的 classify 保持一致（同一套 route 行为，
 * 刻意复刻而非抽公共模块：两份守卫应各自独立，一份被改坏时另一份仍能报警）。
 */
function classify(q: Captured): QueryKey {
  if (q.select.includes('is_review')) return 'practice'
  if (q.select === 'id') return 'profiles'
  if (q.select.includes('service')) {
    if (q.eq.includes('error')) return 'failed'
    if (q.limit === 30) return 'recent'
    if (q.limit !== null) return 'costly'
    return q.select.includes('latency_ms') ? 'range' : 'today'
  }
  if (q.select.includes('user_id')) return 'allTime'
  if (q.lt.length > 0) return 'lastMonth'
  return q.gte[0] === TODAY_START_ISO ? 'today' : 'month'
}

/** 造 thenable 查询构建器；模拟 PostgREST db-max-rows 静默截断与 range 分页切片 */
function makeBuilder(spec: Partial<Record<QueryKey, unknown[]>>) {
  const q: Captured = { select: '', gte: [], lt: [], eq: [], limit: null }
  const b: Record<string, unknown> = {}
  const self = () => b
  b.select = (cols: string) => { q.select = cols; return b }
  b.gte = (_c: string, v: string) => { q.gte.push(v); return b }
  b.lt  = (_c: string, v: string) => { q.lt.push(v); return b }
  b.eq  = (_c: string, v: string) => { q.eq.push(v); return b }
  b.or = self; b.not = self; b.order = self
  b.limit = (n: number) => { q.limit = n; return b }
  const rowsOf = (): unknown[] => spec[classify(q)] ?? []
  b.range = (from: number, to: number) => ({
    then: (res: (r: { data: unknown[]; error: null }) => void) =>
      res({ data: rowsOf().slice(from, to + 1).slice(0, PG_MAX_ROWS), error: null }),
  })
  b.then = (res: (r: { data: unknown[]; error: null }) => void) =>
    res({ data: rowsOf().slice(0, PG_MAX_ROWS), error: null })
  return b
}

// ── 固定 fixture ────────────────────────────────────────────────────────────
// 刻意覆盖多条分支：成功/失败、有/无 phase、估算/实计费、匿名/注册、用户输入问题(error_kind)、
// 空录音信号(audio)、新练/复练。目的是让尽可能多的字段取到非零值——全零的金标守不住任何东西。
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'

const mkLog = (o: Record<string, unknown>) => ({
  id: String(o.id ?? 'log-x'),
  created_at: String(o.created_at ?? '2026-08-09T18:00:00.000Z'),
  service: String(o.service ?? 'qwen'),
  endpoint: String(o.endpoint ?? '/chat'),
  usage_amount: Number(o.usage_amount ?? 100),
  usage_unit: String(o.usage_unit ?? 'token'),
  estimated_cost_cny: Number(o.estimated_cost_cny ?? 0.1),
  latency_ms: Number(o.latency_ms ?? 1200),
  status: String(o.status ?? 'success'),
  user_id: (o.user_id ?? U1) as string | null,
  is_anonymous: (o.is_anonymous ?? false) as boolean | null,
  metadata: (o.metadata ?? { phase: 'matching', cost_source: 'actual' }) as unknown,
})

const RANGE_ROWS = [
  mkLog({ id: 'r1', estimated_cost_cny: 0.30, latency_ms: 900,  metadata: { phase: 'matching', cost_source: 'actual' } }),
  mkLog({ id: 'r2', estimated_cost_cny: 0.20, latency_ms: 2500, metadata: { phase: 'analysis', cost_source: 'estimate' } }),
  mkLog({ id: 'r3', estimated_cost_cny: 0.05, latency_ms: 4000, status: 'error', user_id: U2, is_anonymous: true,
          metadata: { phase: 'transcribe', error_kind: 'user_input', audio: { peak: 0.002, durMs: 1500, bytes: 900 } } }),
  mkLog({ id: 'r4', estimated_cost_cny: 0.15, latency_ms: 1800, status: 'error',
          metadata: { phase: 'coach', error_code: '429', error_message: 'rate limited', logId: 'L4' } }),
  mkLog({ id: 'r5', service: 'doubao', estimated_cost_cny: 0.40, latency_ms: 3000, user_id: U2,
          metadata: { phase: 'transcribe_practice', cost_source: 'actual' } }),
]
const TODAY_ROWS = RANGE_ROWS.map(({ latency_ms: _l, ...rest }) => rest)

const SPEC: Partial<Record<QueryKey, unknown[]>> = {
  allTime:   [{ estimated_cost_cny: 1.10, user_id: U1, is_anonymous: false },
              { estimated_cost_cny: 0.45, user_id: U2, is_anonymous: true },
              { estimated_cost_cny: 0.05, user_id: null, is_anonymous: null }],
  month:     [{ estimated_cost_cny: 0.90 }, { estimated_cost_cny: 0.20 }],
  lastMonth: [{ estimated_cost_cny: 0.50 }],
  today:     TODAY_ROWS,
  range:     RANGE_ROWS,
  recent:    RANGE_ROWS,
  costly:    RANGE_ROWS,
  failed:    RANGE_ROWS.filter(r => r.status === 'error'),
  practice:  [{ is_review: false, created_at: '2026-08-09T18:00:00.000Z' },
              { is_review: true,  created_at: '2026-08-09T19:00:00.000Z' },
              { is_review: false, created_at: '2026-08-07T10:00:00.000Z' }],
  profiles:  [{ id: U1 }, { id: U2 }],
}

// flow_events 固定行：cohortReturns 走 `user_id, created_at, is_qa`，
// pageViewStats 走 `user_id, props, is_qa` + .eq('event','page.view')。按 select 特征分派。
const FLOW_COHORT_ROWS = [
  { user_id: U1, created_at: '2026-08-04T10:00:00.000Z', is_qa: false },
  { user_id: U1, created_at: '2026-08-06T10:00:00.000Z', is_qa: false },
  { user_id: U2, created_at: '2026-08-05T10:00:00.000Z', is_qa: false },
]
const FLOW_PAGEVIEW_ROWS = [
  { user_id: U1, props: { route: 'home' },    is_qa: false },
  { user_id: U1, props: { route: 'library' }, is_qa: false },
  { user_id: U2, props: { route: 'library' }, is_qa: false },
]

// GoTrue listUsers 固定返回：非匿名 + 有邮箱 + 在 COHORT_FETCH_DAYS 窗口内的才进群组。
const AUTH_USERS = [
  { id: U1, email: 'a@example.com', is_anonymous: false, created_at: '2026-08-04T08:00:00.000Z' },
  { id: U2, email: '',              is_anonymous: true,  created_at: '2026-08-05T08:00:00.000Z' },
]

/** 九个 RPC 的固定返回；形状与 dashboard-metrics.ts 里的行类型（RetentionRow 等）逐字段对齐 */
const RPC_RETURNS: Record<string, unknown> = {
  // RetentionRow：d1_rate / d1_n / d7_rate / d7_n（numeric 经 PostgREST 可能回字符串，此处给数字）
  get_retention_stats:        [{ d1_rate: 0.4, d1_n: 10, d7_rate: 0.2, d7_n: 10 }],
  // RegistrationRow：today_count / window_count（键名写错会静默降级成 null，白丢一条守卫）
  get_registration_stats:     [{ today_count: 1, window_count: 3 }],
  get_daily_registrations:    [{ day: '2026-08-08', count: 2 }, { day: '2026-08-09', count: 1 }],
  get_active_registered_stats:[{ day: '2026-08-08', active: 5 }, { day: '2026-08-09', active: 6 }],
  get_core_active_stats:      [{ day: '2026-08-08', active: 4 }, { day: '2026-08-09', active: 5 }],
  get_window_core_active:     [{ core_active: 7 }],
  // ActivationRow：registered_total / activated_total / cohort_total / cohort_activated
  get_activation_stats:       [{ registered_total: 9, activated_total: 5, cohort_total: 8, cohort_activated: 4 }],
  // WeeklyRetentionRow：w1_n / w1_ret / w1_rate
  get_weekly_retention_stats: [{ w1_n: 8, w1_ret: 3, w1_rate: 0.375 }],
  get_user_anon_flags:        [{ user_id: U1, is_anonymous: false }, { user_id: U2, is_anonymous: true }],
}

function wire(): void {
  mockGetSupabase.mockReturnValue({
    // 按【表名】分派：api_usage_logs / practice_sessions / profiles 走 classify 那套特征反推；
    // flow_events 另有两条查询（回访人数 / 页面活跃），按 select 列区分。
    from: (table: string) => {
      if (table !== 'flow_events') return makeBuilder(SPEC)
      const q = { select: '' }
      const b: Record<string, unknown> = {}
      const self = () => b
      b.select = (cols: string) => { q.select = cols; return b }
      b.eq = self; b.gte = self; b.lt = self; b.or = self; b.not = self; b.order = self; b.limit = self
      const rows = () => (q.select.includes('props') ? FLOW_PAGEVIEW_ROWS : FLOW_COHORT_ROWS)
      b.range = (from: number, to: number) => ({
        then: (res: (r: { data: unknown[]; error: null; count: number }) => void) =>
          res({ data: rows().slice(from, to + 1), error: null, count: rows().length }),
      })
      b.then = (res: (r: { data: unknown[]; error: null; count: number }) => void) =>
        res({ data: rows(), error: null, count: rows().length })
      return b
    },
    // RPC 一律返回固定值：金标必须与 DB 迁移状态无关，否则换台机器跑就红
    rpc: (name: string) => Promise.resolve({ data: RPC_RETURNS[name] ?? null, error: null }),
    // 回访表（fetchCohortReturns）走的是 GoTrue admin API 而非 PostgREST；
    // 不 mock 它会抛错被 catch 吞成 null，cohortReturns 整块就守不住了。
    // 返回不满一页 ⇒ regTruncated=false（判停语义与真实实现一致）。
    auth: { admin: { listUsers: () => Promise.resolve({ data: { users: AUTH_USERS }, error: null }) } },
  } as never)
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers().setSystemTime(new Date(FROZEN_NOW))
  wire()
})
afterEach(() => { jest.useRealTimers() })

/** 跑一次 GET 并取回 JSON */
async function capture(range: string): Promise<unknown> {
  const res = await GET(new Request(`http://x/api/dashboard?range=${range}`))
  expect(res.status).toBe(200)
  return res.json()
}

describe('/api/dashboard · 拆分重构行为守卫（全量响应金标）', () => {
  it('7d / 14d / 30d 的完整响应与金标逐字节一致', async () => {
    const actual: Record<string, unknown> = {}
    for (const r of ['7d', '14d', '30d']) actual[r] = await capture(r)

    // 金标缺失 = 首次建立（仅重构前允许发生）；已存在则只比对，绝不覆写。
    // ⚠️ 若本断言转红，正确处理是【检查重构是否改了行为】，不是删金标重生成。
    if (!fs.existsSync(GOLDEN_PATH)) {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true })
      fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 2) + '\n', 'utf8')
      throw new Error(`金标不存在，已生成 ${GOLDEN_PATH}；请提交后重跑（本次视为失败，避免"自动生成即通过"）`)
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, unknown>
    expect(actual).toEqual(golden)
  })

  // 2026-08-15：63 → 61。「哪些页面被用得多」整链删除，pageViewStats / pageViewsTruncated 两键随之消失。
  // ⚠️ 这个数字只许因【人明示的字段增删】而变；断言转红时先问「是不是有字段被悄悄丢了」，不是先改这个数。
  it('金标覆盖了全部 61 个顶层键（防止响应结构被悄悄缩水）', async () => {
    const got = await capture('7d') as Record<string, unknown>
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, Record<string, unknown>>
    expect(Object.keys(got).sort()).toEqual(Object.keys(golden['7d']).sort())
  })
})
