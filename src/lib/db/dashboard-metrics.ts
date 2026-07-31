/**
 * @module   db/dashboard-metrics
 * @desc     经营看板指标 RPC 的服务端读取帮手 —— 从 api/dashboard/route.ts 抽出以守 <1000 行红线（ENGINEERING.md §1）。
 *           纯物理搬迁：函数逻辑 / 独立自降级行为（内部 try/catch、RPC 缺失或出错返 null，绝不 reject 拖垮主看板）
 *           / 返回结构一字未改。每个 fetcher 独立于 route 的主 Promise.all 并发跑、各自降级。
 * @author   LingoBridge
 * @created  2026-07-31
 */
import 'server-only'
import type { getSupabaseServer } from '@/lib/supabase-server'

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
