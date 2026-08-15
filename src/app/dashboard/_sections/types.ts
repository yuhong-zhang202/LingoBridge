/**
 * @module   dashboard/_sections/types
 * @desc     经营看板页面的响应数据类型（DashboardData 及其子类型）—— 2026-08-14 自
 *           `dashboard/page.tsx` 原样抽出（逐字未改、只换位置），供 page.tsx 与 `_sections/`
 *           下各区块共用。
 *
 *   ⚠️ 字段上的注释是【这个数字该怎么读】的唯一说明（降级链路、口径断点、已知偏差），
 *      搬运时一字未动，勿删减、勿改写。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import type { CohortReturns } from '@/components/dashboard/CohortReturnTable'
import type { FeedbackTodoPayload } from '@/components/dashboard/FeedbackTodoList'

type ServiceTotal = { service: string; name: string; color: string; cost: number; calls: number }
type PhaseTotal   = { phase: string; name: string; cost: number; calls: number; errors: number; errorRate: number; errorCost: number }
type UserTotal    = { userId: string; isAnonymous: boolean; cost: number; calls: number }
type RecentLog = {
  id: string; created_at: string; service: string; endpoint: string
  usage_amount: number; usage_unit: string; estimated_cost_cny: number; latency_ms: number; status: string
  // error_code/error_message/logId：失败记账三键（供应商响应、无 PII），失败明细表据此显示错误码与行内展开全文
  metadata?: { phase?: string; cost_source?: string; error_kind?: string; error_code?: string; error_message?: string; logId?: string } | null
  // 影响者（仅失败明细行有；服务端已截前 8 位，完整 id 不出接口）
  userIdShort?: string | null; isAnonymous?: boolean | null
}
type PhaseLatency = { phase: string; name: string; p50: number; p90: number; max: number; calls: number }
type TrendPhase   = { phase: string; name: string; days: Array<{ date: string; p50: number | null; p90: number | null; calls: number }> }
type TodayStatus  = {
  todayFailures: number; avgDailyFailures7: number; avgDailyCost7: number
  slowestPhase: { name: string; p90: number } | null
}
type DashboardData = {
  allTimeCost: number; allTimeCalls: number
  monthCost: number;  monthCalls: number; monthChange: number | null; monthLabel: string
  todayCost:  number; todayCalls: number
  // ── Tier1 今日经营口径 ──
  registeredActiveToday: number; anonSessionsToday: number
  practiceNew: number; practiceReview: number; practiceTotal: number
  todayFailuresByPhase: Array<{ phase: string; count: number }>
  todayFailuresTotal: number; emptyRecordingToday: number
  newRegistrationsToday: number
  // true = 真注册 RPC 未接入、newRegistrationsToday 为 profiles 降级值（含匿名·虚高），卡上标注待迁移
  newRegistrationsPending: boolean
  avgDailyCalls: number; p50Latency: number; p95Latency: number; errorRate: number; avgDailyCost: number
  failedCost: number; estimateRatio: number; dailyBudget: number
  serviceTotals: ServiceTotal[]
  phaseTotals: PhaseTotal[]
  userTotals: UserTotal[]
  anonymousCost: number
  loggedInCost: number
  // true = 用户身份 RPC（0058·get_user_anon_flags）未接入/不可用，上面三项回退旧「有一条匿名调用即标匿名」
  // 口径（转化用户会被误标匿名），卡片上标「口径待生效」+ 说明。旧部署的 API 无此字段，故可选。
  userIdentityPending?: boolean
  // 成本口径「剔除自测流量」的起算日（0059 生效日，形如 '2026-08-08'）：此日之前的成本仍混着产品方自测、
  // 且无法回溯剔除。费用区据此打一行口径小字。旧部署的 API 无此字段，故可选（缺省即不显示这行）。
  costQaBaselineStart?: string
  dailyData: Array<{ date: string; doubao_asr: number; qwen_flash: number; qwen_plus: number; total: number }>
  dailyFailures: Array<{ date: string; failures: number }>
  // newReg：每日新增注册线（迁移 0044 未跑/降级时整列 null，图表不渲染该线）。
  engagementTrend: Array<{ date: string; activeUsers: number; practiceSessions: number; newReg?: number | null }>
  // 注册用户留存（旧口径 D1/D7）：null = 迁移未跑 / RPC 出错的降级态；漏斗④「旧口径对照」行消费。
  // rate 为 0-100 百分比（无成熟群组时 null，如 D7 现未满 7 天）；n 为该指标分母（成熟群组总人数）。
  retention: { d1Rate: number | null; d1N: number; d7Rate: number | null; d7N: number } | null
  retentionPending: boolean
  // ── 增长漏斗（0047 三 RPC，各段迁移未跑时独立降级）──
  // 激活漏斗①②：累计注册/激活 + 本周期群组（激活 = corpus≥1 条）。null = 迁移未跑/出错，①②同时降级。
  activation: { registeredTotal: number; activatedTotal: number; cohortTotal: number; cohortActivated: number } | null
  activationPending: boolean
  // W1 首周留存（漏斗④主区）：首活后 D+1~D+7 任一天再活跃。null = 迁移未跑/出错，④主区降级、D1/D7 对照行仍显。
  weeklyRetention: { w1N: number; w1Ret: number; w1Rate: number | null } | null
  weeklyRetentionPending: boolean
  // 窗口核心活跃去重人数（漏斗③主数字）。activePending = 两级每日权威 RPC（0047→0045）皆不可用 → ③走降级态。
  windowCoreActive: number
  activePending: boolean
  // windowCoreApprox：③ 本次是否为 AI-only 近似（get_window_core_active 回退时 true）。当前 UI 暂不消费，留待未来标注「近似」。
  windowCoreApprox: boolean
  // 假空率（区间内空录音里 peak≥阈值=采到声音却转写空 的占比）：null = 无带 audio 信号的空录音（口径生效前无数据），
  // 前端显「待接入」；有数则 rate（0-100 百分比）+ n（带信号的空录音总数）+ fakeCount（其中判为假空的条数）。
  fakeEmpty: { rate: number; n: number; fakeCount: number } | null
  fakeEmptyPending: boolean
  fakeEmptyThreshold: number
  // ── 用户区扩充（2026-08-04 方案 §四）：近 7 天注册回访；null = 读取失败降级 ──
  // cohortReturns 自带 truncated，语义是【取数触顶、这块数字偏低】，与金额那条 dataTruncated
  // 平级但各自独立、不要合并。（同批的「窗口页面浏览聚合」已于 2026-08-15 随 PageActivityList 整链删除。）
  cohortReturns: CohortReturns | null
  phaseLatency: PhaseLatency[]
  latencyTrend: TrendPhase[]
  latencyCutoff: string
  latencyWarnMs: number
  todayStatus: TodayStatus
  hourlyData: Array<{ hour: string; calls: number }>
  recentLogs: RecentLog[]
  costlyLogs: RecentLog[]
  failedLogs: RecentLog[]
  // 用户反馈待办清单（「有新反馈吗」区块，不随区间选择器变）：服务端三态自降级、恒有值；
  // 旧部署的 API 可能没有该字段，故标可选，组件对 undefined 走「加载失败」态兜底。
  feedback?: FeedbackTodoPayload
}

// 导出写在声明之后（而非 `export type X`）：保持上面每一行类型声明与重构前逐字一致。
export type { ServiceTotal, PhaseTotal, UserTotal, RecentLog, PhaseLatency, TrendPhase, TodayStatus, DashboardData }
