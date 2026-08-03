/**
 * @module   db/dashboard-metrics
 * @desc     经营看板指标的服务端读取帮手 —— 从 api/dashboard/route.ts 抽出以守 <1000 行红线（ENGINEERING.md §1）。
 *           前半为指标 RPC 读取（2026-07-31 纯物理搬迁，逻辑/返回结构一字未改）；
 *           后半为 2026-08-04 看板重设计新增的两个表级读取帮手（fetchCohortReturns / fetchPageViewStats，
 *           聚合逻辑抽成纯函数可单测）。每个 fetcher 独立自降级（内部 try/catch、失败返 null），
 *           绝不 reject 拖垮主看板；与 route 的主 Promise.all 并发跑。
 * @author   LingoBridge
 * @created  2026-07-31
 */
import 'server-only'
import type { getSupabaseServer } from '@/lib/supabase-server'
import { isInternalAccount } from '@/lib/internal-accounts'
import { flowWindowStart } from '@/lib/db/dashboard-flow-events'

/** service_role 客户端类型（route 传入，RPC 内 security definer 读 auth.users） */
type SupabaseServer = ReturnType<typeof getSupabaseServer>

// 留存 RPC（0043_retention_stats）返回的单行形状：PostgREST 对 numeric 可能回字符串以保精度，故读取处 Number() 兜底。
type RetentionRow = { d1_rate: number | string | null; d1_n: number; d7_rate: number | string | null; d7_n: number }
/** 前端消费的留存结构：rate 为 0-100 百分比（无成熟群组时 null），n 为该指标分母（成熟群组总人数）。 */
export type RetentionStats = { d1Rate: number | null; d1N: number; d7Rate: number | null; d7N: number }

/**
 * 调 get_retention_stats RPC 取注册用户留存（D1/D7 池化率 + 样本量）。
 * 迁移 0043 未跑 / RPC 出错时【优雅降级】返回 null（前端显「待接入」），绝不让整个看板 500。
 * @param supabase       service_role 客户端（RPC 内 security definer 读 auth.users）
 * @param windowDays     窗口天数（与看板 range 联动的 7/14/30）
 * @returns              留存结构；不可用时 null
 */
export async function fetchRetention(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<RetentionStats | null> {
  try {
    const { data, error } = await supabase.rpc('get_retention_stats', { p_window_days: windowDays })
    if (error) return null
    const row = Array.isArray(data) ? (data[0] as RetentionRow | undefined) : (data as RetentionRow | null)
    if (!row) return null
    return {
      d1Rate: row.d1_rate == null ? null : Number(row.d1_rate),
      d1N:    row.d1_n,
      d7Rate: row.d7_rate == null ? null : Number(row.d7_rate),
      d7N:    row.d7_n,
    }
  } catch {
    // supabase.rpc 缺失 / 网络异常等一律降级；留存是次要看板指标，不拖垮主看板。
    return null
  }
}

// 真注册统计 RPC（0043_retention_stats 的兄弟函数）返回的单行形状。
type RegistrationRow = { today_count: number; window_count: number }
/** 真注册数：今日 + 窗口内（口径 = auth.users 非匿名·有邮箱，非 profiles）。 */
export type RegistrationStats = { todayCount: number; windowCount: number }

/**
 * 调 get_registration_stats RPC 取【真注册】新增数（今日 + 窗口内）。
 * 口径权威源 auth.users（非 profiles——profiles 含匿名各一行会把匿名算进注册、虚高）。
 * 迁移 0043 未跑 / RPC 出错时返回 null，调用方回退 profiles 计数并在卡上标注「含匿名·待迁移生效」。
 * @param supabase    service_role 客户端（RPC 内 security definer 读 auth.users）
 * @param windowDays  窗口天数（与看板 range 联动的 7/14/30）
 * @returns           真注册数；不可用时 null
 */
export async function fetchRegistration(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<RegistrationStats | null> {
  try {
    const { data, error } = await supabase.rpc('get_registration_stats', { p_window_days: windowDays })
    if (error) return null
    const row = Array.isArray(data) ? (data[0] as RegistrationRow | undefined) : (data as RegistrationRow | null)
    if (!row) return null
    return { todayCount: row.today_count, windowCount: row.window_count }
  } catch {
    return null
  }
}

// 每日真注册数 RPC（0044_daily_registrations）返回行：reg_day 为东八区注册日（PostgREST 对 date 列回
// 'YYYY-MM-DD' 串），cnt 为当日真注册数；只含窗口内【有注册的天】，没注册的天不返回、由 route 补 0。
type DailyRegRow = { reg_day: string; cnt: number | string }

/**
 * 调 get_daily_registrations RPC 取窗口内每日【真注册】数，转成「日桶键→当日注册数」映射，
 * 键格式与 route 的 dayBuckets / dailyData 日期轴一致（`年-月(0基)-日`），供每日参与度趋势并入第三条线「新增注册」。
 * 口径权威源 auth.users（非 profiles——含匿名各一行会虚高）。
 * 迁移 0044 未跑 / RPC 出错时【优雅降级】返回 null，调用方据此让该线整条置 null、前端不渲染
 *（不画一条全 0 / 断裂的线误导），绝不让整个看板 500。降级风格与 fetchRegistration 一致。
 * @param supabase    service_role 客户端（RPC 内 security definer 读 auth.users）
 * @param windowDays  窗口天数（与看板 range 联动的 7/14/30）
 * @returns           「日桶键→当日真注册数」映射；不可用时 null
 */
export async function fetchDailyRegistrations(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<Map<string, number> | null> {
  try {
    const { data, error } = await supabase.rpc('get_daily_registrations', { p_window_days: windowDays })
    if (error) return null
    const rows = (Array.isArray(data) ? data : []) as DailyRegRow[]
    const map = new Map<string, number>()
    for (const row of rows) {
      // reg_day 是 date 类型（PostgREST 回 'YYYY-MM-DD'）→ 日桶键 `年-月(0基)-日`，与 dayBuckets 的 key 口径对齐。
      // 取前 10 字符再拆，防个别环境回带时间的串（如 'YYYY-MM-DDT..'）把日拆成 NaN 而静默丢数据。
      const [y, m, d] = row.reg_day.slice(0, 10).split('-').map(Number)
      if (!y || !m || !d) continue
      map.set(`${y}-${m - 1}-${d}`, Number(row.cnt))
    }
    return map
  } catch {
    return null
  }
}

// 每日活跃注册数 RPC（0045_active_registered）返回行：day 为东八区活跃日（PostgREST 对 date 列回
// 'YYYY-MM-DD' 串），cnt 为当日活跃注册去重数；只含窗口内【有活跃的天】，没活跃的天不返回、由 route 补 0。
type DailyActiveRow = { day: string; cnt: number | string }

/**
 * 调 get_active_registered_stats RPC 取窗口内每日【活跃注册】去重数，转成「日桶键→当日活跃注册数」映射，
 * 键格式与 route 的 dayBuckets / dailyData 日期轴一致（`年-月(0基)-日`）。供两处权威口径消费：
 *   · 趋势图「活跃人数」线（每天取该映射值）；
 *   · 北极星「今日活跃·注册」（route 从映射取当天键那格）。
 * 口径权威源 auth.users（非 api_usage_logs.is_anonymous 标记——旧 stale JWT bug 会写错、失真）。
 * 迁移 0045 未跑 / RPC 出错时【优雅降级】返回 null，调用方回退旧 is_anonymous 标记口径（不 500），
 * 降级风格与 fetchDailyRegistrations 一致。
 * @param supabase    service_role 客户端（RPC 内 security definer 读 auth.users）
 * @param windowDays  窗口天数（与看板 range 联动的 7/14/30）
 * @returns           「日桶键→当日活跃注册数」映射；不可用时 null
 */
export async function fetchActiveRegistered(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<Map<string, number> | null> {
  try {
    const { data, error } = await supabase.rpc('get_active_registered_stats', { p_window_days: windowDays })
    if (error) return null
    const rows = (Array.isArray(data) ? data : []) as DailyActiveRow[]
    const map = new Map<string, number>()
    for (const row of rows) {
      // day 是 date 类型（PostgREST 回 'YYYY-MM-DD'）→ 日桶键 `年-月(0基)-日`，与 dayBuckets 的 key 口径对齐。
      // 取前 10 字符再拆，防个别环境回带时间的串把日拆成 NaN 而静默丢数据（同 fetchDailyRegistrations）。
      const [y, m, d] = row.day.slice(0, 10).split('-').map(Number)
      if (!y || !m || !d) continue
      map.set(`${y}-${m - 1}-${d}`, Number(row.cnt))
    }
    return map
  } catch {
    return null
  }
}

// 每日核心活跃数 RPC（0047_metrics_rpcs·get_core_active_stats）返回行：形状与 0045 完全一致
// （day date, cnt int），让活跃口径能在「核心活跃(权威)→活跃注册(0045)→is_anonymous 去重」三级间无缝切换。
type CoreActiveRow = { day: string; cnt: number | string }

/**
 * 调 get_core_active_stats RPC（0047，新·权威口径）取窗口内每日【核心活跃】注册用户去重数，
 * 转成「日桶键→当日核心活跃数」映射（键格式与 route dayBuckets 一致 `年-月(0基)-日`）。
 * 核心活跃 = AI 环节 / 闪卡复习 / 收藏 任一即算（口径见迁移 0047），比 0045 的「仅 AI 调用」更宽。
 * 迁移 0047 未跑 / RPC 出错时【优雅降级】返回 null，调用方回退 0045（fetchActiveRegistered）、再回退
 * is_anonymous 标记去重（三级降级），绝不 500。降级风格与 fetchActiveRegistered 一致。
 * @param supabase    service_role 客户端（RPC 内 security definer 读 auth.users）
 * @param windowDays  窗口天数（与看板 range 联动的 7/14/30）
 * @returns           「日桶键→当日核心活跃数」映射；不可用时 null
 */
export async function fetchCoreActive(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<Map<string, number> | null> {
  try {
    const { data, error } = await supabase.rpc('get_core_active_stats', { p_window_days: windowDays })
    if (error) return null
    const rows = (Array.isArray(data) ? data : []) as CoreActiveRow[]
    const map = new Map<string, number>()
    for (const row of rows) {
      // day 是 date 类型（PostgREST 回 'YYYY-MM-DD'）→ 日桶键 `年-月(0基)-日`（同 fetchActiveRegistered）。
      const [y, m, d] = row.day.slice(0, 10).split('-').map(Number)
      if (!y || !m || !d) continue
      map.set(`${y}-${m - 1}-${d}`, Number(row.cnt))
    }
    return map
  } catch {
    return null
  }
}

/**
 * 调 get_window_core_active RPC（0047，标量）取窗口内【核心活跃·全 7 信号·注册用户】去重人数（单个整数）。
 * 与 fetchCoreActive（每日）不同：这是窗口级去重标量（JS 侧无法把每日映射跨天再去重，故 DB 侧直接算），
 * 供漏斗③主数字用。RPC 缺失/出错返 null，调用方回退到 rngRows 现算的 AI-only 近似（windowActiveSet.size）。
 * @param supabase    service_role 客户端（RPC 内 security definer 读 auth.users）
 * @param windowDays  窗口天数（与看板 range 联动的 7/14/30）
 * @returns           窗口核心活跃去重人数；不可用时 null
 */
export async function fetchWindowCoreActive(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('get_window_core_active', { p_window_days: windowDays })
    if (error || data == null) return null
    // 标量 RPC（returns int）：PostgREST 直接回该值；个别环境可能回字符串，Number() 兜底 + 有限性校验。
    const n = typeof data === 'number' ? data : Number(data)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

// 激活统计 RPC（0047·get_activation_stats）返回单行：全量注册/激活 + 本周期群组注册/激活（人数，不含百分比）。
type ActivationRow = {
  registered_total: number; activated_total: number; cohort_total: number; cohort_activated: number
}
/** 前端消费的激活结构：全量累计（不受窗口影响）+ 本周期新注册群组（受窗口影响）。百分比由前端算。 */
export type ActivationStats = {
  registeredTotal: number; activatedTotal: number; cohortTotal: number; cohortActivated: number
}

/**
 * 调 get_activation_stats RPC（0047）取激活漏斗人数：累计注册/激活 + 本周期群组注册/激活。
 * 激活 = 该注册用户在 corpus 有 ≥1 条记录（真讲过一次故事，口径见迁移 0047，刻意比核心活跃门槛更高）。
 * 迁移 0047 未跑 / RPC 出错时【优雅降级】返回 null，调用方据此让漏斗①②同时走降级态，绝不 500。
 * @param supabase    service_role 客户端（RPC 内 security definer 读 auth.users）
 * @param windowDays  窗口天数（本周期群组 = 注册日落在近 windowDays 天的注册用户）
 * @returns           激活结构；不可用时 null
 */
export async function fetchActivation(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<ActivationStats | null> {
  try {
    const { data, error } = await supabase.rpc('get_activation_stats', { p_window_days: windowDays })
    if (error) return null
    const row = Array.isArray(data) ? (data[0] as ActivationRow | undefined) : (data as ActivationRow | null)
    if (!row) return null
    return {
      registeredTotal: row.registered_total,
      activatedTotal:  row.activated_total,
      cohortTotal:     row.cohort_total,
      cohortActivated: row.cohort_activated,
    }
  } catch {
    return null
  }
}

// 首周留存 RPC（0047·get_weekly_retention_stats）返回单行：w1_rate 为 numeric（PostgREST 可能回字符串保精度），
// n=0（无成熟群组）时 w1_rate 为 null。
type WeeklyRetentionRow = { w1_n: number; w1_ret: number; w1_rate: number | string | null }
/** 前端消费的 W1 首周留存结构：w1Rate 为 0-100 百分比（无成熟群组时 null），w1N/w1Ret 为分母/回访人数。 */
export type WeeklyRetentionStats = { w1N: number; w1Ret: number; w1Rate: number | null }

/**
 * 调 get_weekly_retention_stats RPC（0047）取【W1 首周留存】：群组=每个注册用户首次核心活跃日，
 * W1=首活后 D+1~D+7 任一天再次核心活跃（区间留存，口径见迁移 0047，与旧 0043 的 D1/D7 精确等日不同）。
 * 迁移 0047 未跑 / RPC 出错时【优雅降级】返回 null（前端漏斗④主区显降级，D1/D7 对照行仍由旧 retention 独立承担）。
 * @param supabase    service_role 客户端（RPC 内 security definer 读 auth.users）
 * @param windowDays  窗口天数（回看窗口固定 max(windowDays,30)，见迁移 0047）
 * @returns           W1 留存结构；不可用时 null
 */
export async function fetchWeeklyRetention(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<WeeklyRetentionStats | null> {
  try {
    const { data, error } = await supabase.rpc('get_weekly_retention_stats', { p_window_days: windowDays })
    if (error) return null
    const row = Array.isArray(data) ? (data[0] as WeeklyRetentionRow | undefined) : (data as WeeklyRetentionRow | null)
    if (!row) return null
    return { w1N: row.w1_n, w1Ret: row.w1_ret, w1Rate: row.w1_rate == null ? null : Number(row.w1_rate) }
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 2026-08-04 看板重设计（方案 §四「用户走到哪」）：注册回访 cohort + 页面浏览聚合
// ══════════════════════════════════════════════════════════════════════════════

/** 东八区偏移（无夏令时）：日界一律按东八区折算，与看板其余口径一致 */
const HK_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** 某 UTC 毫秒时刻在东八区落在「自纪元起第几天」（同一天恒同数，供日界比较，不做字符串键拼接） */
function hkDayNumOf(t: number): number {
  return Math.floor((t + HK_OFFSET_MS) / DAY_MS)
}

/** 东八区日序号 → 展示标签「M/D」 */
function hkDayLabel(dayNum: number): string {
  const d = new Date(dayNum * DAY_MS)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

// ── 「新注册的人还回来吗」（CohortReturnTable 消费）──────────────────────────────

/** cohort 展示窗口：近 7 天注册分组（取数窗口多留 1 天余量 = 8 天，方案钉死） */
const COHORT_DISPLAY_DAYS = 7
const COHORT_FETCH_DAYS = 8

/** 聚合入参：一名真注册用户（id + 注册时刻） */
export type CohortRegUser = { id: string; createdAt: string }
/** 聚合入参：一行 flow_events（回访信号只需归属人 + 时刻 + QA 标记） */
export type CohortFlowRow = { user_id: string | null; created_at: string; is_qa: boolean | null }

/** 单个注册日的回访统计（只给人数分子/分母，不给百分比 —— 方案硬性要求） */
export type CohortDayStat = {
  /** 注册日展示标签「M/D」（东八区） */
  dateLabel: string
  /** 当日真注册人数（剔内部账户） */
  registered: number
  /** true = 注册日+1（东八区）尚未过完：次日/至今两列显「待满 1 天」，绝不显 0 冒充流失 */
  d1Pending: boolean
  /** 次日（注册日+1 当天）有任意 flow_events 的人数 */
  d1Returned: number
  /** 注册日之后（注册日+1 起）任意一天有 flow_events 的人数（注册当天的活动不算「回来」） */
  totalReturned: number
}
/** cohort 整块结果 */
export type CohortReturns = {
  /** 近 7 天里【有注册】的日子，新到旧 */
  days: CohortDayStat[]
  /** 近 7 天里无注册的天数（UI 合并成一行「其余 N 天无新注册」） */
  emptyDays: number
}

/**
 * 聚合「新注册的人还回来吗」：近 7 天按注册日（东八区）分组，回访 = 该人当日有任意 flow_events。
 * 口径（方案 §四钉死）：
 *   · 回来 = 当日有任意使用记录（含仅浏览，即任何 flow_events）；注册当天的活动不算「回来」；
 *   · 剔 QA（is_qa=true 的行不算回访信号）与内部账户（注册分母与回访信号两侧都剔）；
 *   · 「待满 1 天」判定：注册日+1（东八区）未过完（即注册日 ≥ 昨天）→ 次日/至今列都不显 0；
 *   · 只出人数分子/分母，绝不出百分比（个位数样本下百分比是假精度）。
 * @param regUsers  取数窗口内的真注册用户（真注册过滤在取数侧已做；本函数再剔内部账户）
 * @param flowRows  取数窗口内的 flow_events 行
 * @param now       当前时刻（可注入，便于测试日界与「待满 1 天」）
 * @returns         近 7 天 cohort 统计（有注册的日子新到旧 + 无注册天数）
 */
export function aggregateCohortReturns(
  regUsers: readonly CohortRegUser[],
  flowRows: readonly CohortFlowRow[],
  now: Date,
): CohortReturns {
  const todayNum = hkDayNumOf(now.getTime())

  // 每人的活跃日集合（东八区日序号）：剔 QA、剔内部账户、剔无归属行
  const activeDaysByUser = new Map<string, Set<number>>()
  for (const row of flowRows) {
    if (row.is_qa === true) continue
    if (row.user_id == null || isInternalAccount(row.user_id)) continue
    const day = hkDayNumOf(Date.parse(row.created_at))
    const set = activeDaysByUser.get(row.user_id)
    if (set) set.add(day)
    else activeDaysByUser.set(row.user_id, new Set([day]))
  }

  // 注册用户按注册日分组（剔内部账户；只留展示窗口内的天）
  const regsByDay = new Map<number, string[]>()
  for (const u of regUsers) {
    if (isInternalAccount(u.id)) continue
    const day = hkDayNumOf(Date.parse(u.createdAt))
    if (day < todayNum - (COHORT_DISPLAY_DAYS - 1) || day > todayNum) continue
    const arr = regsByDay.get(day)
    if (arr) arr.push(u.id)
    else regsByDay.set(day, [u.id])
  }

  const days: CohortDayStat[] = []
  let emptyDays = 0
  // 新到旧：今天 → 6 天前
  for (let day = todayNum; day > todayNum - COHORT_DISPLAY_DAYS; day--) {
    const ids = regsByDay.get(day)
    if (!ids || ids.length === 0) { emptyDays++; continue }
    // 注册日+1 过完 ⇔ 东八区今天 ≥ 注册日+2；否则「待满 1 天」
    const d1Pending = todayNum <= day + 1
    let d1Returned = 0
    let totalReturned = 0
    for (const id of ids) {
      const active = activeDaysByUser.get(id)
      if (!active) continue
      if (active.has(day + 1)) d1Returned++
      // 「至今回来」= 注册日之后任意一天：注册当天的活动是注册动作本身带的，不算「回来」
      let cameBack = false
      for (const d of active) { if (d > day) { cameBack = true; break } }
      if (cameBack) totalReturned++
    }
    days.push({ dateLabel: hkDayLabel(day), registered: ids.length, d1Pending, d1Returned, totalReturned })
  }
  return { days, emptyDays }
}

/** listUsers 每页人数与页数上限：内测规模（约 200 人）远在 1 页内，上限只是防御性护栏 */
const LIST_USERS_PER_PAGE = 200
const LIST_USERS_MAX_PAGES = 10

/** flow_events 分页参数（与 dashboard-flow-events 同护栏：每页须严格小于 PostgREST db-max-rows，
 *  裸查会被静默截断到 1000 行 —— 见 api/dashboard/route.ts 顶注教训）；cohort 与页面聚合两处共用 */
const FLOW_PAGE_SIZE = 500
const FLOW_MAX_PAGES = 100

/**
 * 取「新注册的人还回来吗」整块数据：真注册用户（近 8 天）× flow_events（近 8 天），内存 join。
 * ⚠️ 真注册口径与 0043/0044 RPC 完全一致（auth.users 非匿名·有邮箱），但读取路径用 service_role 的
 *    auth admin listUsers 而非 profiles —— profiles 表无 email/is_anonymous 列、含匿名各一行，
 *    无法表达「真注册」（正是此前注册数虚高的教训）；本轮无迁移，不新建 RPC。
 * 任一查询失败即整块降级返 null（前端显「暂不可用」），绝不拖垮主看板。
 * @param supabase  service_role 客户端（admin listUsers 需 service_role；flow_events 无 select 策略）
 * @param now       当前时刻（可注入，便于测试）
 * @returns         cohort 统计；不可用时 null
 */
export async function fetchCohortReturns(
  supabase: SupabaseServer,
  now: Date = new Date(),
): Promise<CohortReturns | null> {
  try {
    const cutoffTs = now.getTime() - COHORT_FETCH_DAYS * DAY_MS
    // 1) 真注册用户（近 8 天）：分页拉 auth 用户，按 非匿名·有邮箱·窗口内 过滤
    const regUsers: CohortRegUser[] = []
    for (let page = 1; page <= LIST_USERS_MAX_PAGES; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: LIST_USERS_PER_PAGE })
      if (error) return null
      for (const u of data.users) {
        if (u.is_anonymous === true) continue
        if (!u.email || u.email.trim() === '') continue
        if (!u.created_at || Date.parse(u.created_at) < cutoffTs) continue
        regUsers.push({ id: u.id, createdAt: u.created_at })
      }
      if (data.users.length < LIST_USERS_PER_PAGE) break
    }
    // 2) flow_events 近 8 天（回访信号）：走既有分页模式（PostgREST 裸查静默截断 1000 行，见 route 顶注）
    const flowRows: CohortFlowRow[] = []
    const sinceIso = new Date(cutoffTs).toISOString()
    for (let page = 0; page < FLOW_MAX_PAGES; page++) {
      const from = page * FLOW_PAGE_SIZE
      const { data, error } = await supabase
        .from('flow_events')
        .select('user_id, created_at, is_qa')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + FLOW_PAGE_SIZE - 1)
      if (error) return null
      const batch = (data ?? []) as CohortFlowRow[]
      for (const row of batch) flowRows.push(row)
      if (batch.length < FLOW_PAGE_SIZE) break
    }
    return aggregateCohortReturns(regUsers, flowRows, now)
  } catch {
    return null
  }
}

// ── 「哪些页面被用得多」（PageActivityList 消费）─────────────────────────────────

/** props.route 缺失时的占位桶（不是真枚举值；埋点异常的可见信号，不静默丢行） */
export const PAGE_ROUTE_MISSING = '(未上报)'

/** 聚合入参：一行 page.view 事件 */
export type PageViewRow = { user_id: string | null; props: Record<string, unknown> | null; is_qa: boolean | null }

/** 单个页面（route 枚举 code）的窗口内活跃统计 */
export type PageViewStat = {
  /** route 枚举 code（如 'home' / 'practice'；缺失行归 PAGE_ROUTE_MISSING 桶） */
  route: string
  /** 打开次数（= 页面加载次数：刷新/多开重复计，不是访问人数 —— 防 UV 误读是展示侧第一要求） */
  views: number
  /** 用过的人（user_id 去重；无归属行计入次数、不计入人数） */
  users: number
}

/**
 * 聚合「哪些页面被用得多」：窗口内 page.view 按 route 聚合打开次数 + user_id 去重人数。
 * 剔 QA（is_qa=true）与内部账户（该行整行剔除：内部自测的浏览既不该计次也不该计人）。
 * @param rows  窗口内全部 page.view 行
 * @returns     按打开次数降序（同次数按 route 字典序）的页面统计
 */
export function aggregatePageViews(rows: readonly PageViewRow[]): PageViewStat[] {
  const byRoute = new Map<string, { views: number; users: Set<string> }>()
  for (const row of rows) {
    if (row.is_qa === true) continue
    if (row.user_id != null && isInternalAccount(row.user_id)) continue
    const raw = row.props?.['route']
    const route = typeof raw === 'string' ? raw : PAGE_ROUTE_MISSING
    let entry = byRoute.get(route)
    if (!entry) { entry = { views: 0, users: new Set() }; byRoute.set(route, entry) }
    entry.views += 1
    if (row.user_id != null) entry.users.add(row.user_id)
  }
  return Array.from(byRoute.entries())
    .map(([route, v]) => ({ route, views: v.views, users: v.users.size }))
    .sort((a, b) => b.views - a.views || a.route.localeCompare(b.route))
}

/**
 * 取「哪些页面被用得多」整块数据：窗口内 flow_events 的 page.view 行，route 聚合次数 + 人数去重。
 * 窗口起点与主看板区间同口径（东八区日界，复用 flowWindowStart）。查询失败降级返 null。
 * @param supabase    service_role 客户端
 * @param windowDays  窗口天数（与看板 range 联动的 7/14/30）
 * @param now         当前时刻（可注入，便于测试）
 * @returns           页面统计（打开次数降序）；不可用时 null
 */
export async function fetchPageViewStats(
  supabase: SupabaseServer,
  windowDays: number,
  now: Date = new Date(),
): Promise<PageViewStat[] | null> {
  try {
    const start = flowWindowStart(now, windowDays)
    const rows: PageViewRow[] = []
    for (let page = 0; page < FLOW_MAX_PAGES; page++) {
      const from = page * FLOW_PAGE_SIZE
      const { data, error } = await supabase
        .from('flow_events')
        .select('user_id, props, is_qa')
        .eq('event', 'page.view')
        .gte('created_at', start.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + FLOW_PAGE_SIZE - 1)
      if (error) return null
      const batch = (data ?? []) as PageViewRow[]
      for (const row of batch) rows.push(row)
      if (batch.length < FLOW_PAGE_SIZE) break
    }
    return aggregatePageViews(rows)
  } catch {
    return null
  }
}
