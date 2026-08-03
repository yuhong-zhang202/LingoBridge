'use client'
/**
 * @module   dashboard/page
 * @desc     Admin 经营看板（2026-08-04 重设计稿）— 顶部「今日结论条」（今天有没有事要处理）
 *           + Hero 三卡（今日新增注册/核心活跃/练习场次，今日口径）+ 五个问句式折叠区（所选区间口径）。
 *           不含 TabBar/TopBar，仅管理员可见。
 *
 *   【信息架构】折叠区顺序按产品方拍板优先级钉死：有新反馈吗 → 用户走到哪 → 出事了吗 →
 *   钱花在哪 → 看板自己还准吗。刻意不做「有事时物理位置提前」的动态排序（单人日读用户会形成
 *   位置记忆，跳变破坏可预期性）；有事的引导由结论条锚点承担。各区收起态 summary 带常驻结论数字。
 *   「出事了吗」的 defaultOpen 数据驱动（今日有计费失败才默认展开），open 走惰性 useState
 *   只算一次模式（见 CollapsibleSection 顶注）。
 *
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from 'recharts'
import Card           from '@/components/Card'
import HeroMetrics    from '@/components/dashboard/HeroMetrics'
import TodayVerdictBar from '@/components/dashboard/TodayVerdictBar'
import FeedbackTodoList, { type FeedbackTodoPayload } from '@/components/dashboard/FeedbackTodoList'
import { ANCHOR_FAILURE_DETAIL, ANCHOR_FEEDBACK, ANCHOR_COST, ANCHOR_LATENCY } from '@/lib/dashboard-verdict'
import CollapsibleSection from '@/components/dashboard/CollapsibleSection'
import EngagementTrendChart from '@/components/dashboard/EngagementTrendChart'
import CostCards     from '@/components/dashboard/CostCards'
import CostTrendChart from '@/components/dashboard/CostTrendChart'
import CostBreakdown  from '@/components/dashboard/CostBreakdown'
import RecentCallsTable from '@/components/dashboard/RecentCallsTable'
import PhaseLatencyPanel from '@/components/dashboard/PhaseLatencyPanel'
import DailyFailureChart from '@/components/dashboard/DailyFailureChart'
import { AiOutcomeBlock, FlowSelfCheckBlock } from '@/components/dashboard/FlowHealthBlocks'
import { useFlowHealth } from '@/hooks/useFlowHealth'
import { apiFetch } from '@/lib/api-client'
import { formatCny } from '@/lib/format-cost'

type ServiceTotal = { service: string; name: string; color: string; cost: number; calls: number }
type PhaseTotal   = { phase: string; name: string; cost: number; calls: number; errors: number; errorRate: number; errorCost: number }
type UserTotal    = { userId: string; isAnonymous: boolean; cost: number; calls: number }
type RecentLog = {
  id: string; created_at: string; service: string; endpoint: string
  usage_amount: number; usage_unit: string; estimated_cost_cny: number; latency_ms: number; status: string
  // error_code/error_message/logId：失败记账三键（供应商响应、无 PII），失败明细表据此显示错误码 + hover message
  metadata?: { phase?: string; cost_source?: string; error_kind?: string; error_code?: string; error_message?: string; logId?: string } | null
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

const RANGES = ['7d', '14d', '30d'] as const
type Range = typeof RANGES[number]
const RANGE_LABEL: Record<Range, string> = { '7d': '7天', '14d': '14天', '30d': '30天' }

// 坐标轴刻度色：recharts 的 tick fill 只吃色值、吃不了 Tailwind class，故硬编码。
// 取 v2-text-muted token 值（#7C6B5E，on surface 5.09:1 达 AA），替换原 #A89990（2.75:1 不达标）。
const AXIS_TICK_FILL = '#7C6B5E'

// 迷你统计条（含【日均调用】）—— 归入「看板自己还准吗」的技术明细，从首屏踢出（日均调用曾在首屏误导，pm 点名）。
// 延迟一律以秒展示（÷1000 保留 1 位小数，如 3.8s / 15.4s），与看板其余耗时口径统一、别取整丢分辨率。
const MINI_STATS = (d: DashboardData) => [
  { label: '日均调用', value: d.avgDailyCalls.toFixed(1) },
  // 中位数而非均值：同输入长度不同的调用延迟能差 3 倍，均值谁也不代表（P95 保留，答"最坏能多坏"）
  { label: '中位数延迟', value: `${(d.p50Latency / 1000).toFixed(1)}s` },
  { label: 'P95 延迟', value: `${(d.p95Latency / 1000).toFixed(1)}s` },
  { label: '错误率',   value: `${d.errorRate}%` },
  { label: '日均费用', value: formatCny(d.avgDailyCost) },
  { label: '估算占比', value: `${d.estimateRatio}%` },
]

/** other 桶显示名：明确它是「未标注环节」而非某个真实环节（pm 方案 §2.3） */
function phaseDisplayName(p: PhaseTotal): string {
  return p.phase === 'other' ? '其他（未标注环节）' : p.name
}

/**
 * 块A「钱花在哪个环节」（归「钱花在哪」）— 横条按最高成本归一，每行 = 环节名 + 成本条 + ¥金额 + 占本期总成本%。
 * 刻意删失败率、删次数：这块只回答"钱花哪了"，失败拆到块B（归「出事了吗」）。other 桶照实按成本排、不隐藏（pm 方案 §2.3）。
 * @param phases  已按成本降序的环节聚合数组
 */
function PhaseCostBreakdown({ phases }: { phases: PhaseTotal[] }) {
  const max   = phases.reduce((m, p) => Math.max(m, p.cost), 0)
  const total = phases.reduce((s, p) => s + p.cost, 0)
  const hasOther = phases.some(p => p.phase === 'other')
  return (
    <section aria-label="按环节成本" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">钱花在哪个环节</h2>
        <span className="text-[0.625rem] text-v2-text-muted">占本期总成本</span>
      </div>
      {phases.length === 0 ? (
        <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">本期暂无环节数据</div>
      ) : (
        <div className="space-y-2">
          {phases.map(p => {
            const name = phaseDisplayName(p)
            const pct  = total > 0 ? Math.round(p.cost / total * 100) : 0
            return (
              <div key={p.phase} className="flex items-center gap-3">
                <span className="text-[0.6875rem] text-v2-text-secondary w-28 flex-shrink-0 truncate" title={name}>{name}</span>
                <div className="flex-1 h-2 bg-black/[0.04] rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-brand-accent/70"
                    style={{ width: `${max > 0 ? (p.cost / max) * 100 : 0}%` }} />
                </div>
                <span className="text-[0.6875rem] font-medium text-v2-text-primary w-16 text-right flex-shrink-0 tabular-nums">{formatCny(p.cost)}</span>
                <span className="text-[0.625rem] text-v2-text-muted w-10 text-right flex-shrink-0 tabular-nums">{pct}%</span>
              </div>
            )
          })}
          {hasOther && (
            <div className="text-[0.625rem] text-v2-text-muted mt-2 leading-relaxed">
              「其他（未标注环节）」多为埋点前的转写调用，新数据会自动归位。
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * 块B「哪个环节在失败」（归「出事了吗」）— 只列 errors>0 的环节，每行 = 环节名 + 失败X次(占该环节调用Y%) + 白烧¥。
 * 如 matching 中 extraction 成功记账后 ranking 失败，从这里能一眼定位是哪个环节在漏钱。全无失败显示占位文案。
 * @param phases     环节聚合数组（内部按失败次数降序重排）
 * @param failedCost 本期全部失败调用的成本合计（白烧总额）
 */
function PhaseFailureBreakdown({ phases, failedCost }: { phases: PhaseTotal[]; failedCost: number }) {
  const failing = phases.filter(p => p.errors > 0).sort((a, b) => b.errors - a.errors || b.errorCost - a.errorCost)
  return (
    <section aria-label="按环节失败率" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">哪个环节在失败</h2>
        {failedCost > 0 && (
          <span className="text-[0.6875rem] font-medium text-warning-text">失败白烧 {formatCny(failedCost)}</span>
        )}
      </div>
      {failing.length === 0 ? (
        <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">本期各环节无失败</div>
      ) : (
        <div className="space-y-2">
          {failing.map(p => (
            <div key={p.phase} className="flex items-center gap-3">
              <span className="text-[0.6875rem] text-v2-text-secondary w-28 flex-shrink-0 truncate" title={phaseDisplayName(p)}>{phaseDisplayName(p)}</span>
              <span className="flex-1 text-[0.6875rem] text-warning-text">
                失败 <span className="font-medium tabular-nums">{p.errors}</span> 次
                <span className="text-v2-text-muted">（占该环节调用 {p.errorRate}%）</span>
              </span>
              <span className="text-[0.6875rem] font-medium text-warning-text w-24 text-right flex-shrink-0 tabular-nums">白烧 {formatCny(p.errorCost)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * 「按用户成本 Top-N」视图 — 内测 200 陌生人下一眼看出"谁烧最多、是不是匿名"。
 * 仅按 user_id（UUID）归因、不含任何个人信息；匿名单独标出（匿名试用是纯成本高风险）。
 * 顶部另给匿名 vs 登录的成本占比。横向条按最高成本归一化，降序（烧最多在最前）。
 * @param users         已按成本降序的每用户聚合数组（Top-N）
 * @param anonymousCost 全时段匿名调用成本合计
 * @param loggedInCost  全时段登录调用成本合计
 */
function UserCostBreakdown({ users, anonymousCost, loggedInCost }: { users: UserTotal[]; anonymousCost: number; loggedInCost: number }) {
  const max = users.reduce((m, u) => Math.max(m, u.cost), 0)
  const attributed = anonymousCost + loggedInCost
  const anonPct = attributed > 0 ? Math.round(anonymousCost / attributed * 100) : 0
  return (
    <section aria-label="按用户成本 Top-N" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">按用户成本 Top-N</h2>
          {/* 本区块口径独立于区间：按 user_id 全时段累计（抓"谁烧最多"要看历史总账，不随区间切换） */}
          <span className="text-[0.625rem] text-v2-text-muted">全时段累计</span>
        </div>
        {/* 匿名/登录成本占比：匿名占比高 = 陌生人试用在烧钱，内测阶段重点盯 */}
        {attributed > 0 && (
          <span className="text-[0.6875rem] text-v2-text-secondary">
            匿名 <span className="font-medium text-warning-text">{formatCny(anonymousCost)} · {anonPct}%</span>
            <span className="mx-1.5 text-v2-text-muted">/</span>
            登录 <span className="font-medium text-v2-text-primary">{formatCny(loggedInCost)}</span>
          </span>
        )}
      </div>
      {users.length === 0 ? (
        <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">暂无可归因到用户的调用</div>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.userId} className="flex items-center gap-3">
              {/* user_id 是 UUID，截前 8 位展示即可辨识、又不占满宽；等宽字体对齐 */}
              <span className="text-[0.6875rem] text-v2-text-secondary w-20 flex-shrink-0 truncate" style={{ fontFamily: 'monospace' }}>{u.userId.slice(0, 8)}</span>
              {/* 匿名标记：匿名单独标出（纯成本高风险），登录不占位保持行整洁 */}
              <span className="w-10 flex-shrink-0">
                {u.isAnonymous && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.5625rem] font-medium bg-warning/15 text-warning-text">匿名</span>
                )}
              </span>
              <div className="flex-1 h-2 bg-black/[0.04] rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${u.isAnonymous ? 'bg-warning/70' : 'bg-brand-accent/70'}`}
                  style={{ width: `${max > 0 ? (u.cost / max) * 100 : 0}%` }} />
              </div>
              <span className="text-[0.6875rem] font-medium text-v2-text-primary w-16 text-right flex-shrink-0 tabular-nums">{formatCny(u.cost)}</span>
              <span className="text-[0.625rem] text-v2-text-muted w-14 text-right flex-shrink-0">{u.calls} 次</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── 增长漏斗（归「用户走到哪」）：等宽卡 + 段间箭头（chevron），不画按数值递减宽度的漏斗条 ──
//   产品方拍板（勿改）：③核心活跃门槛低于②激活、可能反超，递减条会误导；故四段等宽、每段 x/y 各自自洽。

/** 漏斗每段的等宽卡壳（plain Card + flex 撑满等高，口径小字靠 mt-auto 沉底） */
function FunnelCard({ children }: { children: ReactNode }) {
  return <Card className="flex-1 flex flex-col px-4 py-4">{children}</Card>
}

/** 段间箭头：桌面横排 `›` / 移动纵排 `↓`，纯装饰、对读屏 aria-hidden（先后由 <ol> 承载） */
function FunnelChevron() {
  return (
    <li aria-hidden="true" className="flex items-center justify-center shrink-0 text-v2-text-muted">
      <span className="hidden md:inline text-[1.125rem] leading-none">›</span>
      <span className="md:hidden text-[1rem] leading-none">↓</span>
    </li>
  )
}

/**
 * x/y 的百分比串（1 位小数）；分母 ≤0 返回 null（除零保护，调用处据此不显 (%)、只显 x/y）。
 * @param num  分子
 * @param den  分母
 * @returns    形如 '39.2%'；分母 ≤0 时 null
 */
function pctText(num: number, den: number): string | null {
  if (den <= 0) return null
  return `${(num / den * 100).toFixed(1)}%`
}

/** 漏斗主数字 x/y（%）：主 x/y 为 text-[1.5rem] 粗体；(%) 括号灰为辅（除零时不显 %，只显 x/y） */
function FunnelFraction({ num, den }: { num: number; den: number }) {
  const p = pctText(num, den)
  return (
    <div className="text-[1.5rem] font-bold text-v2-text-primary tabular-nums leading-none mt-1">
      {num}/{den}
      {p && <span className="text-[0.8125rem] font-medium text-v2-text-secondary ml-1">({p})</span>}
    </div>
  )
}

/** 漏斗段降级内容（塞进同尺寸 FunnelCard、保持漏斗不塌）：段标题 + 「下一步接入」badge + 原因小字 */
function FunnelDegraded({ title, reason }: { title: string; reason: string }) {
  return (
    <>
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="text-[0.6875rem] text-v2-text-muted">{title}</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.5625rem] font-medium bg-black/[0.04] text-v2-text-muted">下一步接入</span>
      </div>
      <div className="text-[0.625rem] text-v2-text-muted leading-relaxed mt-1">{reason}</div>
    </>
  )
}

/** 漏斗段标题（11px muted） */
function FunnelTitle({ children }: { children: ReactNode }) {
  return <div className="text-[0.6875rem] text-v2-text-muted">{children}</div>
}

/** 漏斗段口径小字（10px muted，mt-auto 沉底与等高段对齐） */
function FunnelNote({ children }: { children: ReactNode }) {
  return <div className="text-[0.625rem] text-v2-text-muted leading-relaxed mt-auto pt-2">{children}</div>
}

/**
 * 单条留存指标的展示串：rate + 样本量 n（n 必显，避免小样本 100% 被误读）。
 * rate=null（该指标无成熟群组，如 D7 现未满 7 天）→ 显未成熟提示而非 0%，避免误导。
 * @param rate     0-100 百分比（1 位小数），null = 未成熟
 * @param n        分母（成熟群组总人数）
 * @param immature rate=null 时展示的未成熟说明
 */
function retentionText(rate: number | null, n: number, immature: string): string {
  if (rate === null) return immature
  return `${rate}% · n=${n}`
}

// 迁移 0047 各段的接入提示（降级 reason 复用，避免散落硬编码）。
const ACTIVATION_REASON = '激活 RPC（get_activation_stats）尚未接入，待部署方跑迁移 0047 后自动显示真实数据。'
const WEEKLY_RET_REASON = 'W1 留存 RPC（get_weekly_retention_stats）尚未接入，待部署方跑迁移 0047 后自动显示真实数据。'

/**
 * 增长漏斗：① 累计注册 →（›/↓）② 激活 →（›/↓）③ 窗口核心活跃 →（›/↓）④ W1 首周留存。
 * 桌面一行四段 + chevron，移动纵向堆叠 + 下箭头；四段等宽（不画递减宽度漏斗条，产品方拍板）。
 * a11y：<ol>/<li> 承载先后、区块 aria-label 概述全链、chevron aria-hidden。各段迁移未跑时独立降级、不塌。
 * @param data       看板数据（读 activation / weeklyRetention / retention / windowCoreActive 及各 pending）
 * @param windowDays 区间天数（7/14/30），③ 口径小字「近 N 天」用
 */
function GrowthFunnel({ data, windowDays }: { data: DashboardData; windowDays: number }) {
  // ① 累计注册 / ② 激活：同源 activation，null 时两段同时降级
  const act = data.activation
  const seg1: ReactNode = act
    ? (<>
        <FunnelTitle>累计注册</FunnelTitle>
        <div className="text-[1.5rem] font-bold text-v2-text-primary tabular-nums leading-none mt-1">{act.registeredTotal}</div>
        <FunnelNote>只计真注册（非匿名·有邮箱）· 东八区</FunnelNote>
      </>)
    : <FunnelDegraded title="累计注册" reason={ACTIVATION_REASON} />

  const cohortPct = act ? pctText(act.cohortActivated, act.cohortTotal) : null
  const seg2: ReactNode = act
    ? (<>
        <FunnelTitle>激活</FunnelTitle>
        <FunnelFraction num={act.activatedTotal} den={act.registeredTotal} />
        <div className="text-[0.6875rem] text-v2-text-secondary mt-2">
          本周期新注册激活 <span className="tabular-nums">{act.cohortActivated}/{act.cohortTotal}</span>
          {cohortPct && <span className="text-v2-text-muted">（{cohortPct}）</span>}
        </div>
        <FunnelNote>激活 = 在 corpus 有 ≥1 条记录（真讲过一次故事）</FunnelNote>
      </>)
    : <FunnelDegraded title="激活" reason={ACTIVATION_REASON} />

  // ③ 窗口核心活跃：activePending（两级权威 RPC 皆不可用）时降级；否则显窗口去重人数
  const seg3: ReactNode = data.activePending
    ? <FunnelDegraded title="窗口核心活跃" reason="核心活跃口径 RPC（get_core_active_stats 与 0045）均未接入，窗口核心活跃暂不可信。待部署方跑迁移 0047 后自动显示。" />
    : (<>
        <FunnelTitle>窗口核心活跃</FunnelTitle>
        <div className="text-[1.5rem] font-bold text-v2-text-primary tabular-nums leading-none mt-1">{data.windowCoreActive}</div>
        <FunnelNote>AI 环节 / 闪卡复习 / 收藏 任一即算 · 仅注册用户 · 近{windowDays}天</FunnelNote>
      </>)

  // ④ W1 首周留存：三态——W1 有→完整；W1 无+D1/D7 有→主区降级但对照行照显；两者皆无→整段降级
  const wr  = data.weeklyRetention
  const ret = data.retention
  const d7Immature = ret && ret.d7N === 0 ? '需≥7天数据' : '暂无'
  const comparisonRow = ret ? (
    <div className="text-[0.625rem] text-v2-text-muted mt-2 leading-relaxed">
      旧口径对照 · D1 {retentionText(ret.d1Rate, ret.d1N, '需≥1天数据')} · D7 {retentionText(ret.d7Rate, ret.d7N, d7Immature)}
    </div>
  ) : null
  const w1Note = <FunnelNote>首次核心活跃后 7 天内再次活跃 · 只算注册用户 · 东八区</FunnelNote>
  let seg4: ReactNode
  if (wr) {
    seg4 = (<>
      <FunnelTitle>W1 首周留存</FunnelTitle>
      <FunnelFraction num={wr.w1Ret} den={wr.w1N} />
      {comparisonRow}
      {w1Note}
    </>)
  } else if (ret) {
    // W1 无、D1/D7 有：主区 badge，但旧口径对照行不一起吞、照显
    seg4 = (<>
      <FunnelDegraded title="W1 首周留存" reason={WEEKLY_RET_REASON} />
      {comparisonRow}
      {w1Note}
    </>)
  } else {
    seg4 = <FunnelDegraded title="W1 首周留存" reason="W1 留存与旧 D1/D7 留存 RPC 均未接入，待部署方跑迁移 0047 / 0043 后自动显示。" />
  }

  return (
    <ol aria-label="增长漏斗：注册 → 激活 → 核心活跃 → 首周留存"
      className="flex flex-col md:flex-row md:items-stretch gap-2">
      <li className="flex-1 flex flex-col"><FunnelCard>{seg1}</FunnelCard></li>
      <FunnelChevron />
      <li className="flex-1 flex flex-col"><FunnelCard>{seg2}</FunnelCard></li>
      <FunnelChevron />
      <li className="flex-1 flex flex-col"><FunnelCard>{seg3}</FunnelCard></li>
      <FunnelChevron />
      <li className="flex-1 flex flex-col"><FunnelCard>{seg4}</FunnelCard></li>
    </ol>
  )
}

/**
 * 假空率卡（区间内空录音里「采到声音却转写空」的占比）：漏斗下方并列独立 <Card> 小卡。
 * 主区放假空率 + 样本量 n（n 必显，避免小样本被误读）；副行给假空条数；口径小字注明判据。
 * @param fakeEmpty  route 返回的假空率结构（此处已确保非 null；null 降级态在调用处走 PendingPlaceholder）
 * @param threshold  峰值阈值（0~1），口径小字展示用
 */
function FakeEmptyStat({ fakeEmpty, threshold }: { fakeEmpty: NonNullable<DashboardData['fakeEmpty']>; threshold: number }) {
  return (
    <Card className="flex-1 min-w-[140px] px-4 py-4">
      <div className="text-[0.6875rem] text-v2-text-muted mb-1">假空率</div>
      <div className="text-[1.5rem] font-bold text-v2-text-primary leading-none tabular-nums">
        {fakeEmpty.rate}% · n={fakeEmpty.n}
      </div>
      <div className="text-[0.6875rem] text-v2-text-secondary mt-2">
        疑似采集问题：<span className="tabular-nums">{fakeEmpty.fakeCount}</span> / {fakeEmpty.n} 段空录音
      </div>
      <div className="text-[0.625rem] text-v2-text-muted mt-1.5">峰值音量≥{threshold} 却转写空 = 疑似采集问题 · 阈值待标定</div>
    </Card>
  )
}

/** 「下一步接入」空态占位（假空率无带信号样本时用，不硬编错数）：漏斗下方并列小卡的降级态 */
function PendingPlaceholder({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="flex-1 min-w-[140px] bg-black/[0.02] rounded-[12px] border border-dashed border-black/[0.1] px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[0.6875rem] text-v2-text-muted">{title}</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.5625rem] font-medium bg-black/[0.04] text-v2-text-muted">下一步接入</span>
      </div>
      <div className="text-[0.625rem] text-v2-text-muted leading-relaxed mt-1">{reason}</div>
    </div>
  )
}

/**
 * Admin 经营看板主页
 */
export default function DashboardPage() {
  const [range, setRange]               = useState<Range>('7d')
  const [selectedService, setSelected]  = useState<string | null>(null)
  const [data, setData]                 = useState<DashboardData | null>(null)
  const [loading, setLoading]           = useState(true)
  // 成本看板仅管理员可见：API 返回 401/403 时置 denied，展示无权访问态而非空看板
  const [denied, setDenied]             = useState(false)
  // 加载失败（非鉴权）独立态：展示「加载失败，请重试」+ 重试按钮，不再留空白死胡同
  const [error, setError]               = useState(false)
  // 重试计数：递增即重新触发 useEffect 拉取
  const [reloadKey, setReloadKey]       = useState(0)
  // 客户端埋点观测（flow_events 口径）：父层拉一次，同时喂「出事了吗」的 AI 结局分布
  // 与「看板自己还准吗」的埋点自检两块——各自 fetch 会是必然的双份请求（<details> 收起也照样 mount）
  const flow = useFlowHealth(range)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(false)
    ;(async () => {
      try {
        const res = await apiFetch(`/api/dashboard?range=${range}`, { signal: ac.signal })
        if (ac.signal.aborted) return
        if (res.status === 401 || res.status === 403) { setDenied(true); setLoading(false); return }
        if (!res.ok) { setError(true); setLoading(false); return }
        const d = (await res.json()) as DashboardData
        if (ac.signal.aborted) return
        setDenied(false); setData(d); setLoading(false)
      } catch {
        if (ac.signal.aborted) return          // 中断不算错误，忽略
        setError(true); setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [range, reloadKey])

  // 区间天数与区块口径 chip：口径跟着区块走（收起态也看得见这块数据是什么时间范围的）
  const windowDays = Number(range.slice(0, -1))
  const rangeBadge = `近 ${windowDays} 天`
  const hasRangeData = !!data && data.dailyData.some(d => d.total > 0)
  const hasTodayData = !!data && data.hourlyData.some(h => h.calls > 0)
  // 今日小时分布的 aria 概述用：读屏用户靠这一句掌握"今天调用多不多、集中在几点"
  const todayTotalCalls = data?.hourlyData.reduce((s, h) => s + h.calls, 0) ?? 0
  const todayPeakHour   = data?.hourlyData.reduce((m, h) => (h.calls > m.calls ? h : m), { hour: '', calls: 0 })
    ?? { hour: '', calls: 0 }

  // ── 各区收起态 summary 的常驻结论数字（方案 §一骨架）──
  // ①区：本期系统故障次数（区间口径）+ flow_events「该我们修」桶（同为区间口径，两者同源可并列；
  //      它刻意不进「今日」口径的结论条，理由见 dashboard-verdict 顶注）。flow 未到/失败时省略该段。
  const rangeFailures = data?.dailyFailures.reduce((s, d) => s + d.failures, 0) ?? 0
  const fh = flow.data
  const oursTotal = fh ? fh.aiCall.reduce((s, st) => s + st.ourSide, 0) : null
  const incidentSubtitle = `本期失败 ${rangeFailures} 次${oursTotal != null ? ` · 该我们修 ${oursTotal}` : ''}`
  // ④区：埋点事件健康一句话（与 FlowSelfCheckBlock 的 dead 判定同式）；flow 未到时退回静态说明
  const deadEvents = fh ? fh.eventCounts.filter(e => e.known && e.count === 0 && e.qaCount === 0).length : null
  const selfCheckSubtitle = fh && deadEvents != null
    ? (deadEvents === 0 ? `埋点 ${fh.eventCounts.length} 事件全通` : `埋点 ${deadEvents} 个事件疑似归零`)
    : '埋点健康 · 枚举覆盖 · 技术明细'

  return (
    <main className="max-w-[1400px] mx-auto px-4 md:px-10 pt-8 pb-12">
      {/* 顶部标题 */}
      <div className="mb-6">
        <div className="text-[0.6875rem] text-v2-text-muted tracking-[1.5px] uppercase mb-1">LINGOBRIDGE</div>
        <h1 className="text-[1.375rem] font-bold text-v2-text-primary">经营看板</h1>
      </div>

      {denied && (
        <div className="text-v2-text-muted text-[0.875rem] py-10 text-center">无权访问：经营看板仅对管理员开放。</div>
      )}

      {loading && !denied && <div className="text-v2-text-muted text-[0.875rem] py-10 text-center">加载中…</div>}

      {error && !loading && !denied && (
        <div className="flex flex-col items-center gap-3 py-16">
          <div className="text-v2-text-secondary text-[0.875rem]">加载失败，请重试</div>
          <button onClick={() => setReloadKey(k => k + 1)}
            className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-full text-[0.75rem] font-medium bg-v2-text-primary text-white">
            重试
          </button>
        </div>
      )}

      {data && !loading && !denied && !error && (<>
        {/* ── 今日结论条（今天有没有事要处理；四判定源与锚点见 dashboard-verdict 顶注）── */}
        <TodayVerdictBar input={{
          todayFailuresTotal: data.todayFailuresTotal,
          topFailurePhase:    data.todayFailuresByPhase[0]?.phase ?? null,
          // 反馈数据加载失败时按 0 处理：不虚报「有反馈要处理」（反馈区自己会显「加载失败」）
          unhandledFeedback:  data.feedback && !data.feedback.loadFailed ? data.feedback.unhandledCount : 0,
          todayCost:          data.todayCost,
          avgDailyCost7:      data.todayStatus.avgDailyCost7,
          dailyBudget:        data.dailyBudget,
          slowestPhase:       data.todayStatus.slowestPhase,
          latencyWarnMs:      data.latencyWarnMs,
        }} />

        {/* ── 首屏 Hero 三数卡（注册 / 活跃 / 练习，今日口径，不随下方区间变）── */}
        <HeroMetrics data={{
          newRegistrationsToday:   data.newRegistrationsToday,
          newRegistrationsPending: data.newRegistrationsPending,
          registeredActiveToday:   data.registeredActiveToday,
          anonSessionsToday:       data.anonSessionsToday,
          practiceNew:             data.practiceNew,
          practiceReview:          data.practiceReview,
          practiceTotal:           data.practiceTotal,
        }} />

        {/* ── 区间选择器 + 口径注脚（只作用于下方各折叠区；首屏三数卡恒为今日口径）── */}
        <div className="flex items-center justify-between mb-2 gap-3">
          <div className="text-[0.8125rem] font-semibold text-v2-text-primary">明细（可展开）</div>
          <div className="flex bg-white rounded-full border border-black/[0.05] p-0.5 gap-0.5 flex-shrink-0" role="group" aria-label="时间范围">
            {RANGES.map(r => (
              <button key={r} onClick={() => setRange(r)} aria-pressed={range === r}
                className={`min-h-[44px] px-3.5 rounded-full text-[0.6875rem] font-medium transition-colors ${range === r ? 'bg-v2-text-primary text-white' : 'text-v2-text-muted'}`}>
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
        {/* 口径注脚缩成一句：细分口径已跟着各区块的 rangeBadge 与卡内小字走，不必在顶部再铺一段 */}
        <div className="text-[0.625rem] text-v2-text-muted mb-3">
          上方三数卡＝今日（东八区日历边界）；下方各区＝所选区间（{RANGE_LABEL[range]}）。
        </div>

        {/* ① 有新反馈吗（第一区，产品方拍板优先级最高；全量口径、不随区间选择器变）。
            锚点包裹（tabIndex=-1 接受移焦）：结论条「反馈 N 条未处理」chip 跳到这里并展开。 */}
        <div id={ANCHOR_FEEDBACK} tabIndex={-1}>
          <FeedbackTodoList feedback={data.feedback} />
        </div>

        {/* ② 用户走到哪（默认收起）：增长漏斗（注册→激活→核心活跃→W1 留存）+ 参与度趋势。
            日活 1-2 人时这几个数天天不动，不该占默认展开位。 */}
        <CollapsibleSection title="用户走到哪" subtitle="注册 → 激活 → 核心活跃 → 首周留存"
          rangeBadge={rangeBadge}>
          {/* 增长漏斗：③ 窗口核心活跃跟随区间选择器（近 N 天） */}
          <GrowthFunnel data={data} windowDays={windowDays} />
          {/* 今日新增注册 / 匿名活跃 / 假空率：漏斗下方三张并列独立小卡（今日口径，文案/口径沿用原样）。
              窄屏按小卡 min-w 自然换行（同旧「增长」组行为）。 */}
          <div className="flex flex-wrap gap-2.5 mt-3">
            {/* 今日新增注册：真注册口径（RPC 可用时）；newRegistrationsPending 为真=RPC 未接入、暂用 profiles 计数（含匿名·虚高），走降级文案 */}
            <Card className="flex-1 min-w-[140px] px-4 py-4">
              <div className="text-[0.6875rem] text-v2-text-muted mb-1">今日新增注册</div>
              <div className="text-[1.5rem] font-bold text-v2-text-primary leading-none tabular-nums">{data.newRegistrationsToday}</div>
              <div className="text-[0.625rem] text-v2-text-muted mt-1.5">
                {data.newRegistrationsPending
                  ? '含匿名·待迁移生效（RPC 未接入，暂用 profiles 计数）'
                  : '只计真注册（非匿名·有邮箱），东八区'}
              </div>
            </Card>
            {/* 匿名口径改诚实：匿名 user_id 按设备持久去重、非唯一真人（同一人换设备/清缓存会重复），绝不与注册相加 */}
            <Card className="flex-1 min-w-[140px] px-4 py-4">
              <div className="text-[0.6875rem] text-v2-text-muted mb-1">今日匿名活跃</div>
              <div className="text-[1.5rem] font-bold text-v2-text-primary leading-none tabular-nums">{data.anonSessionsToday}</div>
              <div className="text-[0.625rem] text-v2-text-muted mt-1.5">去重身份 · 按设备持久 · 非唯一真人</div>
            </Card>
            {data.fakeEmpty
              ? <FakeEmptyStat fakeEmpty={data.fakeEmpty} threshold={data.fakeEmptyThreshold} />
              : <PendingPlaceholder title="假空率" reason="区间内暂无带采集信号的空录音（埋点口径生效前无数据），有空录音发生后自动显示真实占比。" />}
          </div>
          {/* 参与度趋势（活跃 + 场次 + 新增注册 三线；新增注册线在迁移未跑/降级时不渲染）并入本组 */}
          <div className="mt-4">
            <div className="text-[0.75rem] font-medium text-v2-text-secondary mb-2">参与度趋势 · 核心活跃人数 + 练习场次 + 新增注册</div>
            {data.engagementTrend.some(d => d.activeUsers > 0 || d.practiceSessions > 0)
              ? <EngagementTrendChart data={data.engagementTrend} />
              : <div className="text-v2-text-muted text-[0.75rem] h-[180px] flex items-center justify-center">本期暂无参与度数据</div>}
          </div>
        </CollapsibleSection>

        {/* ③ 出事了吗（defaultOpen 数据驱动：今日有计费失败才默认展开，结论条会点名）：
            每日故障柱 + AI 结局分布（埋点口径）+ 失败环节 + 失败明细 + 耗时。 */}
        <CollapsibleSection title="出事了吗" subtitle={incidentSubtitle}
          rangeBadge={rangeBadge} defaultOpen={data.todayFailuresTotal > 0}>
          {/* 空录音摘要行（自原 Hero 失败卡副行移入，上次误报来源、信息不许丢）：今日口径 */}
          <div className="text-[0.6875rem] text-v2-text-muted mb-2">
            今日空录音 {data.emptyRecordingToday} 次 · 不算故障（用户输入问题，钱已花但服务是好的）
          </div>
          <DailyFailureChart data={data.dailyFailures} />
          <div className="mt-4">
            <AiOutcomeBlock state={flow} />
            {/* 块B「哪个环节在失败」：只列有失败的环节 + 白烧成本（计费口径） */}
            <PhaseFailureBreakdown phases={data.phaseTotals} failedCost={data.failedCost} />
            {/* 失败明细表：本区只给失败视图（每日故障图的下钻出口），最近/最贵归「看板自己还准吗」。
                锚点包裹：结论条「计费失败 N 次」chip 的落点。 */}
            <div id={ANCHOR_FAILURE_DETAIL} tabIndex={-1}>
              <RecentCallsTable recentLogs={data.recentLogs} costlyLogs={data.costlyLogs} failedLogs={data.failedLogs}
                views={['failed']} defaultMode="failed" />
            </div>
            {/* 性能耗时并入本区内层：慢也是一种"出事了"，但它不该和故障并列占一个顶层区。
                锚点包裹：结论条「{环节}变慢」chip 的落点。 */}
            <div id={ANCHOR_LATENCY} tabIndex={-1} className="mt-4">
              <PhaseLatencyPanel phases={data.phaseLatency} trend={data.latencyTrend}
                cutoffLabel={data.latencyCutoff} latencyWarnMs={data.latencyWarnMs} />
            </div>
          </div>
        </CollapsibleSection>

        {/* ④ 钱花在哪（默认收起）：费用卡 · 趋势 · 按服务 / 环节 / 用户 · 单价参考。
            锚点包裹：结论条成本黄灯 chip 的落点；summary 常驻「今日 ¥x · 本月 ¥y」（撤 Hero 成本卡的去向）。 */}
        <div id={ANCHOR_COST} tabIndex={-1}>
        <CollapsibleSection title="钱花在哪" subtitle={`今日 ${formatCny(data.todayCost)} · 本月 ${formatCny(data.monthCost)}`}
          rangeBadge={rangeBadge}>
          {/* 本月 + 累计（+ 今日）费用卡：日历口径 */}
          <CostCards data={data} />
          <div className="text-[0.625rem] text-v2-text-muted mt-1.5 mb-4">$ 副行按 ¥7.2/$ 估算，非实时汇率</div>

          {/* 费用趋势 + 按服务占比 */}
          <div className="flex items-center justify-end mb-2">
            {/* 筛选可发现性：点占比联动后给显式「全部」出口，否则用户不知如何清除 dim 状态 */}
            {selectedService && (
              <button onClick={() => setSelected(null)}
                className="inline-flex items-center gap-1 min-h-[44px] pl-2.5 pr-3 -my-2 rounded-full text-[0.6875rem] font-medium text-v2-text-secondary bg-black/[0.03] hover:bg-black/[0.06] transition-colors">
                <span aria-hidden="true">×</span>清除筛选 · 全部
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
            <section aria-label="费用趋势" className="md:col-span-2 bg-white rounded-[16px] border border-black/[0.05] p-4">
              {/* 时间范围标注：趋势/饼图均为所选区间（近 N 天）口径，与上方费用卡（全部历史/本月/今日）不同源 */}
              <div className="text-[0.6875rem] text-v2-text-muted mb-1">费用趋势 · 近 {windowDays} 天</div>
              {hasRangeData
                ? <CostTrendChart data={data.dailyData} selectedService={selectedService} dailyBudget={data.dailyBudget} />
                : <div className="text-v2-text-muted text-[0.75rem] h-[180px] flex items-center justify-center">本期暂无费用数据</div>}
            </section>
            <section aria-label="按服务费用占比" className="md:col-span-1 bg-white rounded-[16px] border border-black/[0.05] p-4">
              <CostBreakdown totals={data.serviceTotals} selected={selectedService} onSelect={setSelected} rangeDays={windowDays} />
            </section>
          </div>
          <div className="text-[0.625rem] text-v2-text-muted mb-4">
            注：趋势图的日预算线 ¥{data.dailyBudget} 为内测占位参照值、非真实告警阈值——超线仅在卡片染色提示，不触发任何告警推送。
          </div>

          {/* 块A「钱花在哪个环节」：横条 + ¥金额 + 占本期总成本%（失败率拆到「出事了吗」） */}
          <PhaseCostBreakdown phases={data.phaseTotals} />
          {/* 按用户成本 Top-N（谁烧最多、是不是匿名） */}
          <UserCostBreakdown users={data.userTotals} anonymousCost={data.anonymousCost} loggedInCost={data.loggedInCost} />

          {/* 单价参考（估算依据）：它解释的是本区每一个 ¥ 数字怎么来的，跟着钱走 */}
          <div className="bg-white rounded-[12px] border border-black/[0.05] px-4 py-3">
            <div className="text-[0.6875rem] text-v2-text-muted leading-relaxed">
              单价参考（估算依据）&nbsp;|&nbsp;豆包 ASR ≈ ¥0.003/秒&nbsp;|&nbsp;千问 Qwen Flash ≈ ¥0.0008/千token&nbsp;|&nbsp;千问 Plus ≈ ¥0.8/¥2.0 per M token（输入/输出）
            </div>
            <div className="text-[0.625rem] text-v2-text-muted mt-1.5">
              * 优先按模型返回的真实 token 计费；无真实用量时回退按字数估算（记录标 cost_source=estimate）。实际账单以各平台控制台为准。
            </div>
          </div>
        </CollapsibleSection>
        </div>

        {/* ⑤ 看板自己还准吗（默认收起，沉到最底）：埋点健康 + 枚举取值覆盖 + 技术明细。
            这一区回答的是"我的传感器还活着吗"，与产品健康分开，一周看一次即可。 */}
        <CollapsibleSection title="看板自己还准吗" subtitle={selfCheckSubtitle}
          rangeBadge={rangeBadge}>
          {/* 埋点自检（flow_events 口径）：与「出事了吗」里的 AI 结局分布同源，父层只拉一次 */}
          <FlowSelfCheckBlock state={flow} />

          {/* 迷你统计条（含日均调用，从首屏移入；延迟已改秒） */}
          <section aria-label="性能与成本指标" className="bg-white rounded-[12px] border border-black/[0.05] grid grid-cols-2 md:flex md:divide-x divide-black/[0.05] mb-4 overflow-hidden">
            {MINI_STATS(data).map(s => (
              <div key={s.label} className="flex-1 px-4 py-3 text-center border-b md:border-b-0 border-black/[0.05]">
                <div className="text-[0.6875rem] text-v2-text-muted mb-0.5">{s.label}</div>
                <div className="text-[0.875rem] font-semibold text-v2-text-primary">{s.value}</div>
              </div>
            ))}
          </section>

          {/* 今日调用分布（小时） */}
          <section aria-label="今日调用分布" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
            <h2 className="text-[0.75rem] font-medium text-v2-text-secondary mb-2">今日调用分布</h2>
            {hasTodayData ? (<>
              {/* 图表可视区：SVG 对读屏不可读，给 role+aria-label 概述，另附 sr-only 数据表兜底（与同页另图一致） */}
              <div role="img"
                aria-label={`今日调用按小时分布柱状图，全天共 ${todayTotalCalls} 次调用，峰值 ${todayPeakHour.hour} 共 ${todayPeakHour.calls} 次。详细数据见下方数据表。`}>
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={data.hourlyData} barSize={6} margin={{ top: 0, right: 0, bottom: 0, left: -16 }}>
                    <XAxis dataKey="hour" tick={{ fontSize: '0.5625rem', fill: AXIS_TICK_FILL }} tickLine={false} axisLine={false} interval={3} />
                    <Bar dataKey="calls" radius={[2, 2, 0, 0]}>
                      {data.hourlyData.map((h, i) => (
                        <Cell key={i} fill="#7BA699" fillOpacity={h.calls > 0 ? 0.6 : 0.15} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="sr-only">
                <caption>今日调用按小时分布（东八区）</caption>
                <thead>
                  <tr><th scope="col">时刻</th><th scope="col">调用次数</th></tr>
                </thead>
                <tbody>
                  {data.hourlyData.map(h => (
                    <tr key={h.hour}><th scope="row">{h.hour}</th><td>{h.calls}</td></tr>
                  ))}
                </tbody>
              </table>
            </>) : (
              <div className="text-v2-text-muted text-[0.75rem] h-[100px] flex items-center justify-center">今日暂无调用</div>
            )}
          </section>

          {/* 调用明细表格：本区给最近 / 最贵（失败视图归「出事了吗」） */}
          <RecentCallsTable recentLogs={data.recentLogs} costlyLogs={data.costlyLogs} failedLogs={data.failedLogs}
            views={['recent', 'costly']} defaultMode="recent" />
        </CollapsibleSection>
      </>)}
    </main>
  )
}
