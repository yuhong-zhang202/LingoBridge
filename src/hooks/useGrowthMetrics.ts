'use client'
/**
 * @module   useGrowthMetrics
 * @desc     经营看板「产品增长指标」（迁移 0064/0065）三条子路由的数据源 hook：
 *             · /api/dashboard/growth/funnel   —— 七步主线漏斗 + 质量注脚 + 额度墙
 *             · /api/dashboard/growth/cohorts  —— W1 留存曲线 + 粘性 DAU/MAU + 用户分层
 *             · /api/dashboard/growth/usage    —— 功能使用矩阵 + 每类故障影响面
 *
 *   【为什么在父层拉、不各块自己拉】同 useFlowHealth 顶注：React 的 <details> 收起时 children
 *   照样 mount，各块自己 fetch 等于必然的重复请求；且收起态 summary 上的常驻数字也要用同一份数据。
 *
 *   【为什么本文件手抄一份类型】lib/db/dashboard-growth-* 是 `server-only` 模块，客户端组件
 *   不能 import（一 import 就把 service_role 侧的依赖拖进前端 bundle）。范式与 CohortReturnTable
 *   顶注的做法一致：类型手工对齐、字段注释照搬「这个数字该怎么读」。
 *   ⚠️ 服务端结构改了要同步改这里 —— 不同步不会报错，只会让某个字段静默变成 undefined。
 *
 * @author   LingoBridge
 * @created  2026-08-15
 */
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

// ══════════════════════════════════════════════════════════════════════════════
// 共用：窗口与埋点起算日的关系
// ══════════════════════════════════════════════════════════════════════════════

/** 窗口与某个埋点起算日的关系（与 db/dashboard-growth-shared.FlowBaselineInfo 一致） */
export type FlowBaselineInfo = {
  /** 起算日（东八区日期串），供 UI 显示「自 YYYY-MM-DD 起统计」 */
  baselineStart: string
  /** 本次窗口是否跨过起算日 —— true 时埋点侧的数字【系统性偏低】 */
  crossesBaseline: boolean
  /** 窗口内真正有埋点数据的天数（跨界时 < 窗口总天数） */
  effectiveDays: number
  /** 窗口总天数（闭区间，= windowDays + 1） */
  windowTotalDays: number
}

// ══════════════════════════════════════════════════════════════════════════════
// 主题一：七步主线漏斗
// ══════════════════════════════════════════════════════════════════════════════

/** 漏斗的一步（与 db/dashboard-growth-funnel.FunnelStep 一致） */
export type FunnelStep = {
  index: number
  key: string
  label: string
  users: number
  /**
   * 'table' = 读数据库表（内测第一天就有数据）；'flow' = 读 flow_events 埋点（2026-08-02 才上线）。
   * 窗口跨起算日时，两类步骤【不可相减】—— 由后端给，UI 绝不自己再写一份 step→source 映射。
   */
  source: 'table' | 'flow'
  /** 相对上一步的转化率（0-100，1 位小数）；第 1 步与上一步为 0 人时 null */
  convFromPrev: number | null
  /** 相对上一步流失的人数；第 1 步为 null。负数 = 本步人数反超上一步 */
  lostFromPrev: number | null
}

/** 七步漏斗整块 */
export type GrowthFunnelData = {
  steps: FunnelStep[]
  /** 掉幅最大那一级的下标（2~7）；无正向流失时 null。⚠️ 跨源窗口下不可用（见 GrowthFunnelTable） */
  biggestDropIndex: number | null
}

/** 注脚·只浏览未动手（browseOnlyUsers 是同一批人的真集合差，不是两个人数相减） */
export type BrowseOnlyStats = {
  pageViewUsers: number
  coreActiveUsers: number
  browseOnlyUsers: number
}

/** 注脚·匹配质量 */
export type MatchQuality = { rendered: number; noMatch: number; noMatchRate: number | null }
/** 注脚·出题与停留（⚠️ candidateTotal 与 opened 不构成点击率） */
export type QuestionQuality = { candidateTotal: number; opened: number; dwellMedianMs: number | null }
/** 注脚·反馈卡（分母只含主动点结束的人，系统性偏低） */
export type FeedbackQuality = {
  endedUsers: number; cardTotal: number; cardsPerUser: number | null; zeroCardUsers: number
}
/** 漏斗质量注脚整块 */
export type FunnelQuality = {
  match: MatchQuality
  question: QuestionQuality
  feedback: FeedbackQuality
  /** true = 取数分页触顶，本块次数与人数【均偏低】（被截掉的永远是最新那批） */
  truncated: boolean
}

/** 额度墙（撞墙窗口 30 天、观察期 7 天，均不随 range 变） */
export type QuotaWallStats = {
  wallUsers: number
  convertedUsers: number
  silentUsers: number
  /** 观察期已满 7×24 小时的人数。⚠️ matureUsers ≪ wallUsers 时两个率都没定型 */
  matureUsers: number
  conversionRate: number | null
  silentRate: number | null
}

/** GET /api/dashboard/growth/funnel 的响应 */
export type GrowthFunnelResponse = {
  windowDays: number
  flowBaseline: FlowBaselineInfo
  funnel: GrowthFunnelData | null
  funnelPending: boolean
  browseOnly: BrowseOnlyStats | null
  browseOnlyPending: boolean
  quality: FunnelQuality | null
  qualityPending: boolean
  quotaWall: QuotaWallStats | null
  quotaWallPending: boolean
}

// ══════════════════════════════════════════════════════════════════════════════
// 主题二：群组（留存曲线 / 粘性 / 分层）
// ══════════════════════════════════════════════════════════════════════════════

/** W1 留存曲线上的一个点（⚠️ 分子分母必须一起显示，个位数群组下只显百分比是假精度） */
export type RetentionPoint = { weekStart: string; cohortN: number; returnedN: number; rate: number | null }

/** 粘性曲线上的一个点（⚠️ 单点几乎没有解释力，要看形状） */
export type StickinessPoint = { day: string; dau: number; mau: number; ratio: number | null }

/** 一个用户分层（⚠️ 高频层与前三层正交，四行相加没有意义） */
export type UserSegment = {
  key: string; label: string; users: number; share: number | null
  w1N: number; w1Ret: number; w1Rate: number | null
}

/** 核心活跃人数的一档拆分（三档互斥） */
export type CoreSplitEntry = { key: string; label: string; users: number; share: number | null }

/** 用户分层整块 */
export type UserSegments = {
  segments: UserSegment[]
  /** 分层人群总数 = 窗口内【核心活跃 ∪ 有 corpus 新增】的注册用户（= share 的分母，不是全部注册用户） */
  segmentBase: number
  /** 窗口内核心活跃注册用户数（= coreSplit 三档之和） */
  coreActive: number
  coreSplit: CoreSplitEntry[]
}

/** GET /api/dashboard/growth/cohorts 的响应 */
export type GrowthCohortsResponse = {
  windowDays: number
  /** ⚠️ 空数组【不是】降级：那表示回看范围内没有任何成熟群组（内测早期正常） */
  retentionSeries: RetentionPoint[] | null
  retentionSeriesPending: boolean
  stickiness: StickinessPoint[] | null
  stickinessPending: boolean
  segments: UserSegments | null
  segmentsPending: boolean
}

// ══════════════════════════════════════════════════════════════════════════════
// 主题三：功能使用矩阵 / 故障影响面
// ══════════════════════════════════════════════════════════════════════════════

/** 功能矩阵的一行 */
export type FeatureUsageEntry = {
  key: string
  label: string
  group: string
  users: number
  uses: number
  /** 人均次数（分母是"用过的人"，不是"全部用户"）；users=0 时 null */
  perUser: number | null
  /** true = 本行依赖 page.tab_view 埋点，起算日之前【必然为 0，不代表没人用】 */
  tabViewBased: boolean
}

/** 功能矩阵整块 */
export type FeatureUsageMatrix = {
  rows: FeatureUsageEntry[]
  tabViewBaselineStart: string
  /** 依赖 page.tab_view 那几行的已知偏差原文（随响应下发，前端不另写一遍） */
  tabViewCaveat: string
}

/** 一类故障（按环节分）的影响面 */
export type FailureImpact = {
  phase: string
  failures: number
  /** 去重影响用户数。⚠️ 各环节相加 ≠ totalAffectedUsers（同一人可能在多环节踩到） */
  affectedUsers: number
  /** 无法归因到人的失败次数（计入 failures、不计入 affectedUsers） */
  unattributed: number
}

/** 故障影响整块 */
export type FailureImpactStats = {
  byPhase: FailureImpact[]
  totalFailures: number
  /** 跨环节去重后的影响人数（【不等于】各行相加） */
  totalAffectedUsers: number
  truncated: boolean
}

/** GET /api/dashboard/growth/usage 的响应 */
export type GrowthUsageResponse = {
  windowDays: number
  featureUsage: FeatureUsageMatrix | null
  featureUsagePending: boolean
  tabViewBaseline: FlowBaselineInfo
  failureImpact: FailureImpactStats | null
  failureImpactPending: boolean
}

// ══════════════════════════════════════════════════════════════════════════════
// hook 本体
// ══════════════════════════════════════════════════════════════════════════════

/** 三态（与 useFlowHealth 的 FlowHealthState 同形，各区块的降级分支写法保持一致） */
export type GrowthState<T> = { data: T | null; loading: boolean; error: boolean }

/**
 * 按 range 拉一条增长指标子路由。
 * 三条路由的取数形状完全一样（同鉴权、同 range 参数、同降级契约），故收敛成一个内部实现，
 * 避免三份几乎一样的 useEffect 各自漂移。
 * @param path   子路由路径（不含 query）
 * @param range  时间范围（'7d' | '14d' | '30d'，跟随看板区间选择器）
 * @returns      { data, loading, error }
 * @sideEffect   range 变化时发起 fetch；卸载或 range 变化时 abort 上一次请求
 */
function useGrowthResource<T>(path: string, range: string): GrowthState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(false)
    ;(async () => {
      try {
        const res = await apiFetch(`${path}?range=${range}`, { signal: ac.signal })
        if (ac.signal.aborted) return
        if (!res.ok) { setError(true); setLoading(false); return }
        const d = (await res.json()) as T
        if (ac.signal.aborted) return
        setData(d); setLoading(false)
      } catch {
        if (ac.signal.aborted) return          // 中断不算错误，忽略
        setError(true); setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [path, range])

  return { data, loading, error }
}

/**
 * 主题一「七步主线漏斗」数据源。
 * @param range  时间范围（跟随看板区间选择器）
 * @returns      三态包裹的 funnel 响应
 */
export function useGrowthFunnel(range: string): GrowthState<GrowthFunnelResponse> {
  return useGrowthResource<GrowthFunnelResponse>('/api/dashboard/growth/funnel', range)
}

/**
 * 主题二「群组」数据源。
 * @param range  时间范围（跟随看板区间选择器）
 * @returns      三态包裹的 cohorts 响应
 */
export function useGrowthCohorts(range: string): GrowthState<GrowthCohortsResponse> {
  return useGrowthResource<GrowthCohortsResponse>('/api/dashboard/growth/cohorts', range)
}

/**
 * 主题三「使用与故障」数据源。
 * @param range  时间范围（跟随看板区间选择器）
 * @returns      三态包裹的 usage 响应
 */
export function useGrowthUsage(range: string): GrowthState<GrowthUsageResponse> {
  return useGrowthResource<GrowthUsageResponse>('/api/dashboard/growth/usage', range)
}
