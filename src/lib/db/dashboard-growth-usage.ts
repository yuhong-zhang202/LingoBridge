/**
 * @module   db/dashboard-growth-usage
 * @desc     【仅服务端】产品增长指标·主题三「使用与故障」的数据层：
 *             ① 功能使用矩阵 10 行（RPC get_feature_usage_matrix，0065）—— 人数 / 次数 / 人均；
 *             ② 每类故障的【去重影响用户数】（api_usage_logs 表级聚合，纯函数可单测）。
 *
 *   【② 为什么不做成 RPC】现有故障统计（computeTodayFailures / computeDailyFailures）全在
 *   TS 侧按 isSystemError + metadata.phase 分类，那套分类逻辑是本项目的口径真源（含"老失败行
 *   按 error_code 重算 kind"这类历史包袱）。在 SQL 里再实现一遍必然与它漂移，
 *   而漂移的表现是"看板两处的故障数差几条"——没人查得出是哪一份错了。故复用同一套 TS 判据。
 *
 *   【降级纪律】每个 fetcher 独立 try/catch、失败返 null，route 据此置 pending 让前端标「降级中」，
 *   绝不静默显示错数（范式同 dashboard-metrics 的 newRegistrationsPending）。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import 'server-only'
import type { getSupabaseServer } from '@/lib/supabase-server'
import {
  EXCLUDE_INTERNAL_BY_USER, EXCLUDE_QA_TRAFFIC, LogMeta,
  fetchAllRows, isSystemError, todayPhaseName,
} from '@/lib/db/dashboard-shared'
import {
  GROWTH_EXCLUDE_IDS, TAB_VIEW_BASELINE_START, growthWindowStart, ratio2, toCount,
} from '@/lib/db/dashboard-growth-shared'

/** service_role 客户端类型（api_usage_logs 仅 service_role 可读，绕 RLS） */
type SupabaseServer = ReturnType<typeof getSupabaseServer>

// ══════════════════════════════════════════════════════════════════════════════
// ① 功能使用矩阵
// ══════════════════════════════════════════════════════════════════════════════

/** get_feature_usage_matrix（0065）返回行 */
export type FeatureUsageRow = { feature_key: string; users: number | string; uses: number | string }

/** 功能分组（展示分组，与 0065 注释里的三组逐字对应） */
export type FeatureGroup = '主线' | '沉淀' | '复习'

/** 功能目录：顺序即展示顺序；key 与 0065 的 features 目录逐字对应，漏一个会显示成生 key（可发现） */
const FEATURE_CATALOG: ReadonlyArray<{ key: string; label: string; group: FeatureGroup; tabViewBased: boolean }> = [
  { key: 'story',       label: '讲故事',     group: '主线', tabViewBased: false },
  { key: 'match',       label: '匹配题目',   group: '主线', tabViewBased: false },
  { key: 'analysis',    label: '题目分析',   group: '主线', tabViewBased: false },
  { key: 'practice',    label: '对话练习',   group: '主线', tabViewBased: false },
  { key: 'lib_stories', label: '我的经历',   group: '沉淀', tabViewBased: true },
  { key: 'lib_cards',   label: '收藏的表达', group: '沉淀', tabViewBased: true },
  { key: 'lib_words',   label: '生词',       group: '沉淀', tabViewBased: true },
  { key: 'lib_pron',    label: '发音',       group: '沉淀', tabViewBased: true },
  { key: 'review',      label: '闪卡复习',   group: '复习', tabViewBased: false },
  { key: 'qbank',       label: '题库浏览',   group: '复习', tabViewBased: true },
]

/** 功能矩阵的一行 */
export type FeatureUsageEntry = {
  key: string
  label: string
  group: FeatureGroup
  /** 使用人数（去重 user_id；无归属的行计次数、不计人数） */
  users: number
  /** 使用次数 */
  uses: number
  /** 人均次数（2 位小数）；users=0 时 null（诚实占位，不返回 0） */
  perUser: number | null
  /**
   * true = 本行依赖 page.tab_view 埋点，起算日之前【必然为 0，不代表没人用】。
   * 前端必须对这些行显示「自 baselineStart 起统计」，否则第一天就会被读成"素材库没人用"。
   */
  tabViewBased: boolean
}

/** 功能矩阵整块结果 */
export type FeatureUsageMatrix = {
  rows: FeatureUsageEntry[]
  /**
   * page.tab_view 埋点的起算日（东八区 'YYYY-MM-DD'）—— 前端据此给 tabViewBased 的行打小字。
   * 唯一真源见 dashboard-growth-shared 的 TAB_VIEW_BASELINE_START。
   */
  tabViewBaselineStart: string
  /**
   * 依赖 page.tab_view 的那几行的已知偏差（原文见 src/lib/event-schema.ts 的 TAB_ID 条目）。
   * 随响应下发而不是让前端各写一遍：这段话一旦两处不同步，看板上就会出现两种互相矛盾的口径说明。
   */
  tabViewCaveat: string
}

/**
 * page.tab_view 的两条已知偏差 —— 用依赖它的那五格做任何比较之前必须先读。
 * ⚠️ 与 event-schema.ts 的 TAB_ID 注释同源，改一处要同步另一处（那边是契约真源）。
 */
export const TAB_VIEW_CAVEAT =
  '默认 tab 挂载即上报 ⇒「收藏的表达」与题库的「维度设计」天然偏高（含只打开页面、没主动切过的人）；'
  + '移动端素材库默认落在分类首页（不上报）⇒ 双端口径不对称。'
  + '这两格不可与其它 tab 直接比大小，也不可与页面浏览次数相除。'

/**
 * 派生功能使用矩阵（纯函数，可单测）：按目录顺序补齐 10 行、加中文名与人均次数。
 *
 * ⚠️【0 行也必须占一行】某功能计 0 恰恰是最需要被看见的信号 —— "埋点坏了 / 功能入口挂了 /
 *   真没人用"三者在数据里长得一模一样，先得有这一行才谈得上分辨。故缺行按 0 补齐而不是丢掉。
 * ⚠️【人均次数的分母是"用过的人"，不是"全部用户"】它答的是"用的人用得多不多"，
 *   不是"这个功能覆盖了多少人"（后者看 users 那一列）。两个问题别用同一个数回答。
 *
 * @param rows  RPC 返回的行（缺行按 0 补齐）
 * @returns     10 行矩阵 + 起算日 + 偏差说明
 */
export function deriveFeatureUsage(rows: readonly FeatureUsageRow[]): FeatureUsageMatrix {
  const byKey = new Map<string, FeatureUsageRow>()
  for (const row of rows) byKey.set(row.feature_key, row)
  return {
    rows: FEATURE_CATALOG.map(spec => {
      const row = byKey.get(spec.key)
      const users = toCount(row?.users)
      const uses  = toCount(row?.uses)
      return {
        key: spec.key,
        label: spec.label,
        group: spec.group,
        users,
        uses,
        perUser: ratio2(uses, users),
        tabViewBased: spec.tabViewBased,
      }
    }),
    tabViewBaselineStart: TAB_VIEW_BASELINE_START,
    tabViewCaveat: TAB_VIEW_CAVEAT,
  }
}

/**
 * 取功能使用矩阵（RPC get_feature_usage_matrix，0065）。
 * 迁移未跑 / RPC 出错时返回 null，route 置 pending、前端标「降级中」。
 * @param supabase    service_role 客户端
 * @param windowDays  窗口天数
 * @returns           10 行矩阵；不可用时 null
 */
export async function fetchFeatureUsage(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<FeatureUsageMatrix | null> {
  try {
    const { data, error } = await supabase.rpc('get_feature_usage_matrix', {
      p_window_days: windowDays,
      p_exclude_user_ids: GROWTH_EXCLUDE_IDS,
    })
    if (error) return null
    const rows = (Array.isArray(data) ? data : []) as FeatureUsageRow[]
    if (rows.length === 0) return null
    return deriveFeatureUsage(rows)
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 每类故障的去重影响用户数
// ══════════════════════════════════════════════════════════════════════════════

/** 故障影响聚合的入参行（= api_usage_logs 取的四列） */
export type FailureImpactRow = {
  status: string
  service: string
  metadata: LogMeta
  user_id: string | null
}

/** 一类故障（按环节分）的影响面 */
export type FailureImpact = {
  /** 环节中文名（口径同现有「今日故障按环节」的 todayPhaseName） */
  phase: string
  /** 失败次数（既有指标口径，未变） */
  failures: number
  /** 【本次新增】去重影响用户数：该环节故障波及的不同 user_id 数 */
  affectedUsers: number
  /** 无法归因到人的失败次数（user_id 为空的老行 / 无归属调用）—— 计入 failures、不计入 affectedUsers */
  unattributed: number
}

/** 故障影响整块结果 */
export type FailureImpactStats = {
  /** 按影响用户数降序（并列按失败次数降序，再按环节名字典序 —— 顺序稳定，每次打开位置不跳） */
  byPhase: FailureImpact[]
  /** 窗口内系统故障总次数 */
  totalFailures: number
  /** 窗口内被系统故障波及的去重用户数（跨环节去重，【不等于】各环节相加） */
  totalAffectedUsers: number
  /** true = 分页触顶，本块次数与人数均偏低（被截掉的永远是最新那批）。UI 必须明说，绝不静默 */
  truncated: boolean
}

/**
 * 聚合「每类故障的去重影响用户数」（纯函数，可单测）。
 *
 * 【口径与现有故障统计逐字同源】只数【系统故障】（isSystemError：摘掉用户输入问题 / 容量繁忙 /
 * 网络中断三类，与顶部错误率同口径），按 todayPhaseName 分环节 —— 复用同一套判据而不另写一份，
 * 是为了让"故障次数"这一列与看板既有的今日故障/每日失败柱图【永远对得上】。
 * 本次唯一新增的是 affectedUsers 那一列。
 *
 * ⚠️【各环节的 affectedUsers 相加 ≠ totalAffectedUsers】同一个人可能在多个环节踩到故障，
 *   跨环节要重新去重。前端绝不可把列求和当总数。
 * ⚠️【affectedUsers 系统性偏低】user_id 为空的失败行（补归属列前的老行 / 无归属调用）
 *   归不到人，只进 unattributed。unattributed 很大时，affectedUsers 这一列不可当真实影响面。
 * ⚠️【匿名用户按 user_id 去重 = 去重身份、不是去重真人】匿名 id 按设备持久，同一真人换设备/
 *   清缓存会分到新 id ⇒ 影响人数偏高。口径与看板既有的 anonSessionsToday 一致。
 *
 * @param rows  窗口内 api_usage_logs 行（内部账户与 QA 已在查询侧剔除）
 * @returns     按环节的影响面 + 两个总数（不含 truncated —— 那是取数元信息，由 fetch 组装）
 */
export function aggregateFailureImpact(rows: readonly FailureImpactRow[]): Omit<FailureImpactStats, 'truncated'> {
  const byPhase = new Map<string, { failures: number; users: Set<string>; unattributed: number }>()
  const allUsers = new Set<string>()
  let totalFailures = 0

  for (const row of rows) {
    if (!isSystemError(row)) continue
    totalFailures += 1
    const phase = todayPhaseName(row)
    let entry = byPhase.get(phase)
    if (!entry) { entry = { failures: 0, users: new Set(), unattributed: 0 }; byPhase.set(phase, entry) }
    entry.failures += 1
    if (row.user_id == null) entry.unattributed += 1
    else { entry.users.add(row.user_id); allUsers.add(row.user_id) }
  }

  const list: FailureImpact[] = Array.from(byPhase.entries())
    .map(([phase, v]) => ({
      phase, failures: v.failures, affectedUsers: v.users.size, unattributed: v.unattributed,
    }))
    .sort((a, b) =>
      b.affectedUsers - a.affectedUsers || b.failures - a.failures || a.phase.localeCompare(b.phase))

  return { byPhase: list, totalFailures, totalAffectedUsers: allUsers.size }
}

/**
 * 取「每类故障的去重影响用户数」整块数据：窗口内 api_usage_logs 行，内存聚合。
 * 查询侧逐条套两个排除过滤（内部账户 / QA 自测流量），与主看板的八条查询同款
 * —— 缺一条这张表就掺着自测流量。
 * 取数走 fetchAllRows（本项目唯一分页范式）；触顶置 truncated 交给 UI 明说，绝不静默少报。
 * @param supabase    service_role 客户端
 * @param windowDays  窗口天数
 * @param now         当前时刻（可注入，便于测试日界）
 * @returns           故障影响统计；查询失败时 null
 */
export async function fetchFailureImpact(
  supabase: SupabaseServer,
  windowDays: number,
  now: Date = new Date(),
): Promise<FailureImpactStats | null> {
  try {
    const start = growthWindowStart(now, windowDays)
    const res = await fetchAllRows<FailureImpactRow>(() => supabase
      .from('api_usage_logs')
      .select('status, service, metadata, user_id')
      .or(EXCLUDE_INTERNAL_BY_USER)
      .not(...EXCLUDE_QA_TRAFFIC)
      // status 下推：本块只看失败行。这【不是】改口径 —— isSystemError 的第一个条件就是
      // status==='error'，SQL 侧过滤与 JS 侧判据逐字等价，只为少拉成功行、把触顶点推远。
      .eq('status', 'error')
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }))
    if (res.error) return null
    return { ...aggregateFailureImpact(res.data), truncated: res.truncated }
  } catch {
    return null
  }
}
