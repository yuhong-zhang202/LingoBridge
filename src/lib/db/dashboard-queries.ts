/**
 * @module   db/dashboard-queries
 * @desc     【仅服务端】经营看板主看板的十条表查询（api_usage_logs ×8 + practice_sessions + profiles）
 *           及其分页/截断处理与行归一化。2026-08-14 自 `api/dashboard/route.ts` 原样抽出
 *           （查询定义与过滤条件逐字未改、只换位置），route 侧只剩「发起并发 → 组装响应」。
 *
 *   ⚠️ 聚合类查询一律经 fetchAllRows 分页拉全量，绝不裸查（PostgREST 会静默截断到 1000 行）。
 *   ⚠️ 触顶【绝不静默】：置 dataTruncated 并打错误日志（静默少报正是 b56ee61 修掉的那个 bug）。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import 'server-only'
import { logErr } from '@/lib/log'
import type { getSupabaseServer } from '@/lib/supabase-server'
import {
  AttribRow,
  CostRow,
  EXCLUDE_INTERNAL_BY_ID,
  EXCLUDE_INTERNAL_BY_USER,
  EXCLUDE_QA_TRAFFIC,
  FAILED_LOG_N,
  FailedRow,
  MAX_PAGES,
  PAGE_SIZE,
  PracticeRow,
  ProfileRow,
  RangeRow,
  RecentRow,
  TOP_COST_N,
  TodayRow,
  fetchAllRows,
} from '@/lib/db/dashboard-shared'

/** service_role 客户端类型（route 传入；成本数据仅 service_role 可读，绕 RLS） */
type SupabaseServer = ReturnType<typeof getSupabaseServer>

/** 失败明细的对外行：user_id 已在服务端截前 8 位替换，完整 id 不出接口 */
export type FailedLogRow = Omit<FailedRow, 'user_id' | 'is_anonymous'> & {
  userIdShort: string | null
  isAnonymous: boolean | null
}

/** 十条查询取回并归一化后的全部行；error 非空时调用方直接返 500（其余字段为空占位） */
export type DashboardTables = {
  error: { message: string } | null
  dataTruncated: boolean
  allRows: AttribRow[]; mRows: CostRow[]; lmRows: CostRow[]; tdRows: TodayRow[]; rngRows: RangeRow[]
  practiceRows: PracticeRow[]; profilesTdRows: ProfileRow[]
  recent: RecentRow[]; costly: RecentRow[]; failed: FailedLogRow[]
}

/** 查询用的四个时间边界（均已按东八区折算成 UTC 时刻，由调用方算好传入） */
export type QueryBounds = {
  monthStart: Date; lastMonthStart: Date; todayStart: Date; rangeStartDate: Date
}

/**
 * 并发跑完看板的十条表查询，返回归一化后的全部行。
 * @param supabase  service_role 客户端
 * @param bounds    月界 / 上月界 / 日界 / 区间起点（东八区折算后的 UTC 时刻）
 * @returns         全部行 + 首个错误 + 分页触顶标记
 * @sideEffect      分页触顶时打错误日志（绝不静默少报）
 */
export async function fetchDashboardTables(
  supabase: SupabaseServer,
  bounds: QueryBounds,
): Promise<DashboardTables> {
  const { monthStart, lastMonthStart, todayStart, rangeStartDate } = bounds
  // ── 10 条并行查询 ──
  // 前 5 条 + practice/profiles 两条是【聚合类】：结果集大小随数据量无上限增长，必须分页拉全量（见 fetchAllRows）。
  // 其余 3 条是【榜单类】：自带 .limit()，天然在 1000 行以内，直接查即可。
  // ⚠️ 八条 api_usage_logs 查询【逐条】套两个排除过滤，缺一条那张卡/那张图就掺着自测流量：
  //    · .or(EXCLUDE_INTERNAL_BY_USER) —— 内部账户（产品方的注册号）；
  //    · .not(...EXCLUDE_QA_TRAFFIC)   —— QA 自测流量（0059 的 is_qa，专治无痕模式的匿名自测号）。
  //    两者【同一档】、都只作用于成本口径；NULL 行两边都刻意保留（理由见各自常量注释）。
  //    practice_sessions / profiles 两条不套 QA 过滤：那两张表没有 is_qa 列（套了直接查询报错）。
  const [allTimeRes, monthRes, lastMonthRes, todayRes, rangeRes, recentRes, costlyRes, failedRes, practiceRes, profilesRes] = await Promise.all([
    // 全时段：既算累计总花费卡，又供「按用户成本 Top-N」按 user_id 归因，故一并取归属列。
    // 这条永不设时间下界、行数只增不减，是最先撞 1000 行上限、也是少报最严重的一条。
    fetchAllRows<AttribRow>(() => supabase
      .from('api_usage_logs')
      .select('estimated_cost_cny, user_id, is_anonymous')
      .or(EXCLUDE_INTERNAL_BY_USER)
      .not(...EXCLUDE_QA_TRAFFIC)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<CostRow>(() => supabase
      .from('api_usage_logs')
      .select('estimated_cost_cny')
      .or(EXCLUDE_INTERNAL_BY_USER)
      .not(...EXCLUDE_QA_TRAFFIC)
      .gte('created_at', monthStart.toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<CostRow>(() => supabase
      .from('api_usage_logs')
      .select('estimated_cost_cny')
      .or(EXCLUDE_INTERNAL_BY_USER)
      .not(...EXCLUDE_QA_TRAFFIC)
      .gte('created_at', lastMonthStart.toISOString())
      .lt('created_at', monthStart.toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<TodayRow>(() => supabase
      .from('api_usage_logs')
      .select('estimated_cost_cny, user_id, is_anonymous, status, service, metadata')
      .or(EXCLUDE_INTERNAL_BY_USER)
      .not(...EXCLUDE_QA_TRAFFIC)
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<RangeRow>(() => supabase
      .from('api_usage_logs')
      .select('service, estimated_cost_cny, latency_ms, status, created_at, metadata, user_id, is_anonymous')
      .or(EXCLUDE_INTERNAL_BY_USER)
      .not(...EXCLUDE_QA_TRAFFIC)
      .gte('created_at', rangeStartDate.toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })),
    supabase
      .from('api_usage_logs')
      .select('id, created_at, service, endpoint, usage_amount, usage_unit, estimated_cost_cny, latency_ms, status, metadata')
      .or(EXCLUDE_INTERNAL_BY_USER)
      .not(...EXCLUDE_QA_TRAFFIC)
      .order('created_at', { ascending: false })
      .limit(30),
    // 最贵 Top-N（全时段按成本降序）：时间序的"最近调用"抓不到某次异常昂贵，需独立按成本排。
    supabase
      .from('api_usage_logs')
      .select('id, created_at, service, endpoint, usage_amount, usage_unit, estimated_cost_cny, latency_ms, status, metadata')
      .or(EXCLUDE_INTERNAL_BY_USER)
      .not(...EXCLUDE_QA_TRAFFIC)
      .order('estimated_cost_cny', { ascending: false })
      .limit(TOP_COST_N),
    // 失败明细（区间内 status='error'，时间倒序）：每日失败柱图的下钻出口。
    // 刻意【不】在 SQL 层摘掉 user_input —— 明细表要能看到"这条失败到底是哪一类"，
    // 由前端按 error_kind 列展示；柱图的计数口径才只数系统故障（与 errorRate 一致）。
    // 另取 user_id + is_anonymous（S4 告警四件套①「带影响者」）：返回前截前 8 位，完整 id 不出接口。
    supabase
      .from('api_usage_logs')
      .select('id, created_at, service, endpoint, usage_amount, usage_unit, estimated_cost_cny, latency_ms, status, metadata, user_id, is_anonymous')
      .or(EXCLUDE_INTERNAL_BY_USER)
      .not(...EXCLUDE_QA_TRAFFIC)
      .eq('status', 'error')
      .gte('created_at', rangeStartDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(FAILED_LOG_N),
    // 练习场次（区间内）：今日新练/复练拆分取其今日子集、每日趋势场次取全区间，一次查询两用。
    fetchAllRows<PracticeRow>(() => supabase
      .from('practice_sessions')
      .select('is_review, created_at')
      .or(EXCLUDE_INTERNAL_BY_USER)
      .gte('created_at', rangeStartDate.toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })),
    // 今日新增注册：profiles 今日 created_at 计数。只取 id，隐私红线 —— 绝不 join 邮箱/姓名。
    fetchAllRows<ProfileRow>(() => supabase
      .from('profiles')
      .select('id')
      .or(EXCLUDE_INTERNAL_BY_ID)
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })),
  ])

  const firstErr = allTimeRes.error ?? monthRes.error ?? lastMonthRes.error
    ?? todayRes.error ?? rangeRes.error ?? recentRes.error ?? costlyRes.error ?? failedRes.error
    ?? practiceRes.error ?? profilesRes.error
  if (firstErr) {
    return {
      error: firstErr, dataTruncated: false,
      allRows: [], mRows: [], lmRows: [], tdRows: [], rngRows: [],
      practiceRows: [], profilesTdRows: [], recent: [], costly: [], failed: [],
    }
  }

  // 分页触顶 = 数据不完整、看板在少报。绝不静默：打日志 + 随响应返回标记。
  const dataTruncated = allTimeRes.truncated || monthRes.truncated
    || lastMonthRes.truncated || todayRes.truncated || rangeRes.truncated
    || practiceRes.truncated || profilesRes.truncated
  if (dataTruncated) {
    logErr('[dashboard API]', new Error(
      `api_usage_logs 分页触顶（${MAX_PAGES} 页 × ${PAGE_SIZE} 行），统计已被截断、金额偏低；该把汇总下推到 DB 端了`,
    ))
  }

  const allRows = allTimeRes.data
  const mRows   = monthRes.data
  const lmRows  = lastMonthRes.data
  const tdRows  = todayRes.data
  const rngRows = rangeRes.data
  const practiceRows     = practiceRes.data
  const profilesTdRows   = profilesRes.data
  const recent  = (recentRes.data ?? []) as RecentRow[]
  const costly  = (costlyRes.data ?? []) as RecentRow[]
  // 失败明细带影响者（S4①）：服务端截 user_id 前 8 位（辨识够用、完整 id 不出接口），匿名标记随行。
  const failed  = ((failedRes.data ?? []) as FailedRow[]).map(({ user_id, is_anonymous, ...rest }) => ({
    ...rest,
    userIdShort: user_id ? user_id.slice(0, 8) : null,
    isAnonymous: is_anonymous,
  }))

  return {
    error: null, dataTruncated,
    allRows, mRows, lmRows, tdRows, rngRows,
    practiceRows, profilesTdRows, recent, costly, failed,
  }
}
