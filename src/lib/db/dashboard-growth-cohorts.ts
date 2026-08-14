/**
 * @module   db/dashboard-growth-cohorts
 * @desc     【仅服务端】产品增长指标·主题二「群组」的数据层：
 *             ① W1 留存曲线（RPC get_weekly_retention_series，0065）—— 逐周给分子/分母；
 *             ② 粘性比 DAU/MAU 每日序列（RPC get_stickiness_series，0065）；
 *             ③ 用户分层 × 各层 W1 留存 + 核心活跃人数拆分（RPC get_user_segments，0065）。
 *
 *   【为什么是新函数而不是改 0047 的 get_weekly_retention_stats】原地改会让现有看板的 W1 卡
 *   当场断掉：dashboard-metrics 的 fetchWeeklyRetention 期望【单行 {w1_n,w1_ret,w1_rate}】，
 *   改成按周多行后它会取第一周那行当成全量 —— 不报错、不降级、数字静默变小。全文见 0065 顶注。
 *
 *   【降级纪律】每个 fetcher 独立 try/catch、失败返 null，route 据此置 pending 让前端标「降级中」，
 *   绝不静默显示错数（范式同 dashboard-metrics 的 newRegistrationsPending）。
 *
 *   ⚠️ 窗口与剔除口径见 dashboard-growth-shared 顶注（与主看板差一天、与 0047 那批不同源）。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import 'server-only'
import type { getSupabaseServer } from '@/lib/supabase-server'
import { GROWTH_EXCLUDE_IDS, ratePct, ratio2, toCount } from '@/lib/db/dashboard-growth-shared'

/** service_role 客户端类型（RPC 内读 auth.users 需绕 RLS） */
type SupabaseServer = ReturnType<typeof getSupabaseServer>

// ══════════════════════════════════════════════════════════════════════════════
// ① W1 留存曲线
// ══════════════════════════════════════════════════════════════════════════════

/** get_weekly_retention_series（0065）返回行：week_start 为 date（PostgREST 回 'YYYY-MM-DD'） */
export type RetentionSeriesRow = {
  week_start: string
  cohort_n: number | string
  returned_n: number | string
}

/** W1 留存曲线上的一个点 */
export type RetentionPoint = {
  /** 群组周的起始日（东八区日期串 'YYYY-MM-DD'，周一） */
  weekStart: string
  /** 分母 = 该周首次核心活跃、且首活日已满 7 天的注册用户数 */
  cohortN: number
  /** 分子 = 其中在 D+1~D+7 任一天再次核心活跃的人数 */
  returnedN: number
  /** returnedN / cohortN × 100（1 位小数）；cohortN=0 时 null（诚实占位，不返回 0） */
  rate: number | null
}

/**
 * 派生 W1 留存曲线（纯函数，可单测）。
 *
 * ⚠️【分子分母必须一起给前端显示】产品方硬性要求「前端要能显示 n」。内测期一个群组可能只有 2 个人，
 *   50% 和 0% 之间只差一个人 —— 单独显示百分比就是假精度，本项目已反复吃过这个亏
 *   （cohort 回访表刻意只给人数、0047 的 w1_n 同理）。
 * ⚠️【最新一周可能人数很少甚至缺席】首活日未满 7 天的人整个不进分母（还没走完观察期），
 *   这是刻意的：把他们计进去会把最新那一格系统性压低，而那一格恰恰最多人盯着看。
 * ⚠️【周起始日按周一】= PostgreSQL date_trunc('week') 口径，与"自然周"直觉一致，
 *   但与"最近 7 天"这类滚动窗口不是一回事，别混着读。
 *
 * @param rows  RPC 返回的逐周行（已按周升序；本函数不依赖顺序、自行排序）
 * @returns     按周升序的曲线点
 */
export function deriveRetentionSeries(rows: readonly RetentionSeriesRow[]): RetentionPoint[] {
  return rows
    .map(row => {
      const cohortN = toCount(row.cohort_n)
      const returnedN = toCount(row.returned_n)
      return {
        // date 列由 PostgREST 回 'YYYY-MM-DD'；个别环境可能带时间，截前 10 位统一（同 fetchDailyRegistrations）
        weekStart: String(row.week_start).slice(0, 10),
        cohortN,
        returnedN,
        rate: ratePct(returnedN, cohortN),
      }
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

/**
 * 取 W1 留存曲线（RPC get_weekly_retention_series，0065）。
 * 迁移未跑 / RPC 出错时【优雅降级】返回 null，route 置 pending、前端标「降级中」。
 * ⚠️ 返回空数组【不是】降级：那表示回看范围内没有任何成熟群组（内测早期完全正常），
 *    与"读不到数"是两件事，前端必须分开显示。故此处刻意不把空数组转成 null。
 * @param supabase    service_role 客户端
 * @param windowDays  窗口天数（RPC 内回看范围固定 max(windowDays,30)，见 0065）
 * @returns           曲线点数组；不可用时 null
 */
export async function fetchRetentionSeries(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<RetentionPoint[] | null> {
  try {
    const { data, error } = await supabase.rpc('get_weekly_retention_series', {
      p_window_days: windowDays,
      p_exclude_user_ids: GROWTH_EXCLUDE_IDS,
    })
    if (error) return null
    return deriveRetentionSeries((Array.isArray(data) ? data : []) as RetentionSeriesRow[])
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 粘性比 DAU/MAU
// ══════════════════════════════════════════════════════════════════════════════

/** get_stickiness_series（0065）返回行：day 为 date（PostgREST 回 'YYYY-MM-DD'） */
export type StickinessRow = { day: string; dau: number | string; mau: number | string }

/** 粘性曲线上的一个点 */
export type StickinessPoint = {
  /** 东八区日期串 'YYYY-MM-DD' */
  day: string
  /** 当日核心活跃注册用户数 */
  dau: number
  /** 以该日为右端点、回看 30 天（含当日）的核心活跃注册用户去重数（滚动 MAU） */
  mau: number
  /** dau / mau（2 位小数）；mau=0 时 null（诚实占位，不返回 0） */
  ratio: number | null
}

/**
 * 派生粘性曲线（纯函数，可单测）。
 *
 * ⚠️【DAU 口径复用 get_core_active_stats(0047) 的【定义】，但不复用它的函数】——
 *   那个函数不剔内部账户也不剔 is_qa，与本批口径不一致，混用会得到一条自己跟自己打架的曲线。
 *   定义只有一份（0064 的共用底座 get_core_active_user_days），实现走底座。
 * ⚠️【窗口最左边那几天的 MAU 用到了窗口外的数据】滚动 MAU 本就该如此，
 *   但别拿"窗口内总人数"去核对这些点，对不上是正常的。
 * ⚠️【单点数值几乎没有解释力】内测期一个人的进出就能让比值跳十几个点，要看的是形状不是某一天。
 *
 * @param rows  RPC 返回的逐日行
 * @returns     按日升序的曲线点
 */
export function deriveStickiness(rows: readonly StickinessRow[]): StickinessPoint[] {
  return rows
    .map(row => {
      const dau = toCount(row.dau)
      const mau = toCount(row.mau)
      return { day: String(row.day).slice(0, 10), dau, mau, ratio: ratio2(dau, mau) }
    })
    .sort((a, b) => a.day.localeCompare(b.day))
}

/**
 * 取粘性比 DAU/MAU 每日序列（RPC get_stickiness_series，0065）。
 * 迁移未跑 / RPC 出错时返回 null，route 置 pending、前端标「降级中」。
 * @param supabase    service_role 客户端
 * @param windowDays  窗口天数
 * @returns           曲线点数组；不可用时 null
 */
export async function fetchStickiness(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<StickinessPoint[] | null> {
  try {
    const { data, error } = await supabase.rpc('get_stickiness_series', {
      p_window_days: windowDays,
      p_exclude_user_ids: GROWTH_EXCLUDE_IDS,
    })
    if (error) return null
    return deriveStickiness((Array.isArray(data) ? data : []) as StickinessRow[])
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ③ 用户分层 × 各层 W1 留存 + 核心活跃人数拆分
// ══════════════════════════════════════════════════════════════════════════════

/** get_user_segments（0065）返回行：kind ∈ {'segment','total','core_split'} */
export type UserSegmentRow = {
  kind: string
  segment: string
  users: number | string
  w1_n: number | string | null
  w1_ret: number | string | null
}

/** 分层的中文名（同 FUNNEL_STEP_LABEL：SQL 只给稳定 key，改文案不动迁移） */
const SEGMENT_LABEL: Record<string, string> = {
  qbank_only:   '仅题库',
  ai_only:      '仅 AI 主线',
  both:         '两者都用',
  high_freq:    '高频用户',
  mainline:     '走主线',
  review_only:  '只用闪卡/收藏',
  both_signals: '两者都有',
}

/** 一个用户分层 */
export type UserSegment = {
  /** 稳定 key（'qbank_only' | 'ai_only' | 'both' | 'high_freq'） */
  key: string
  /** 中文名；不在清单里时回落成 key 本身（可发现，不静默） */
  label: string
  /** 该层人数 */
  users: number
  /** 占分层人群（segmentBase）的百分比（1 位小数）；segmentBase=0 时 null */
  share: number | null
  /** 该层 W1 留存的分母（层内首活日已满 7 天的人数） */
  w1N: number
  /** 该层 W1 留存的分子 */
  w1Ret: number
  /** w1Ret / w1N × 100（1 位小数）；w1N=0 时 null */
  w1Rate: number | null
}

/** 核心活跃人数的一档拆分 */
export type CoreSplitEntry = {
  key: string
  label: string
  users: number
  /** 占核心活跃总人数的百分比（1 位小数）；coreActive=0 时 null */
  share: number | null
}

/** 用户分层整块结果 */
export type UserSegments = {
  /**
   * 四层。⚠️ 前三层（仅题库 / 仅 AI 主线 / 两者都用）互斥，第四层（高频用户）与它们【正交】
   * —— 四行相加没有意义，前端绝不可画成一个饼图。
   */
  segments: UserSegment[]
  /** 分层人群总数 = 窗口内【核心活跃 ∪ 有 corpus 新增】的注册用户（= 上面 share 的分母） */
  segmentBase: number
  /** 窗口内核心活跃注册用户数（= 下面 coreSplit 三档之和） */
  coreActive: number
  /** 核心活跃人数拆分（三档互斥）：用于解释「核心活跃 N 人里混了谁」 */
  coreSplit: CoreSplitEntry[]
}

/** 展示顺序（SQL 的 union all 不保证顺序；顺序稳定 = 每次打开看板位置不跳） */
const SEGMENT_ORDER = ['qbank_only', 'ai_only', 'both', 'high_freq']
const CORE_SPLIT_ORDER = ['mainline', 'review_only', 'both_signals']

/**
 * 派生用户分层结构（纯函数，可单测）：把 RPC 的长表按 kind 拆成三块，补中文名与占比。
 *
 * ⚠️【每层的 w1N 必然小于该层人数】首活日未满 7 天的人不进 W1 分母（还没走完观察期）。
 *   那不是算错。分子分母都返回，前端必须显示 n（产品方硬性要求）。
 * ⚠️【高频层与前三层重叠】判据是"窗口内核心活跃天数 ≥ 3"，与"用了哪个功能"正交。
 * ⚠️【分层人群的分母不是"全部注册用户"】而是"这个窗口来过的人"。用全部注册用户当分母，
 *   四层占比之和会永远远小于 1、且随窗口长度漂移，看不出任何东西。全文见 0065 函数 ③ 注释。
 *
 * @param rows  RPC 返回的长表行（缺行按 0 补齐，保证四层与三档恒在 —— 某层为 0 恰恰要被看见）
 * @returns     四层 + 两个分母 + 三档拆分
 */
export function deriveUserSegments(rows: readonly UserSegmentRow[]): UserSegments {
  const byKey = new Map<string, UserSegmentRow>()
  for (const row of rows) byKey.set(`${row.kind}:${row.segment}`, row)

  const segmentBase = toCount(byKey.get('total:segment_base')?.users)
  const coreActive  = toCount(byKey.get('total:core_active')?.users)

  const segments: UserSegment[] = SEGMENT_ORDER.map(key => {
    const row = byKey.get(`segment:${key}`)
    const users = toCount(row?.users)
    const w1N   = toCount(row?.w1_n)
    const w1Ret = toCount(row?.w1_ret)
    return {
      key,
      label: SEGMENT_LABEL[key] ?? key,
      users,
      share: ratePct(users, segmentBase),
      w1N,
      w1Ret,
      w1Rate: ratePct(w1Ret, w1N),
    }
  })

  const coreSplit: CoreSplitEntry[] = CORE_SPLIT_ORDER.map(key => {
    const users = toCount(byKey.get(`core_split:${key}`)?.users)
    return { key, label: SEGMENT_LABEL[key] ?? key, users, share: ratePct(users, coreActive) }
  })

  return { segments, segmentBase, coreActive, coreSplit }
}

/**
 * 取用户分层 × 各层留存（RPC get_user_segments，0065）。
 * 迁移未跑 / RPC 出错时返回 null，route 置 pending、前端标「降级中」。
 * @param supabase    service_role 客户端
 * @param windowDays  窗口天数
 * @returns           分层结构；不可用时 null
 */
export async function fetchUserSegments(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<UserSegments | null> {
  try {
    const { data, error } = await supabase.rpc('get_user_segments', {
      p_window_days: windowDays,
      p_exclude_user_ids: GROWTH_EXCLUDE_IDS,
    })
    if (error) return null
    const rows = (Array.isArray(data) ? data : []) as UserSegmentRow[]
    if (rows.length === 0) return null
    return deriveUserSegments(rows)
  } catch {
    return null
  }
}
