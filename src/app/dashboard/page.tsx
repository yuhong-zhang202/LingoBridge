'use client'
/**
 * @module   dashboard/page
 * @desc     Admin 经营看板 — 首屏 Hero 四数卡（今日活跃/练习/故障/成本，今日口径）+ Tier2 折叠分组
 *           （增长/故障明细/耗时/趋势/成本细节/原始日志，所选区间口径）。不含 TabBar/TopBar，仅管理员可见。
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from 'recharts'
import HeroMetrics    from '@/components/dashboard/HeroMetrics'
import CollapsibleSection from '@/components/dashboard/CollapsibleSection'
import EngagementTrendChart from '@/components/dashboard/EngagementTrendChart'
import CostCards     from '@/components/dashboard/CostCards'
import CostTrendChart from '@/components/dashboard/CostTrendChart'
import CostBreakdown  from '@/components/dashboard/CostBreakdown'
import RecentCallsTable from '@/components/dashboard/RecentCallsTable'
import PhaseLatencyPanel from '@/components/dashboard/PhaseLatencyPanel'
import DailyFailureChart from '@/components/dashboard/DailyFailureChart'
import { apiFetch } from '@/lib/api-client'
import { formatCny } from '@/lib/format-cost'

type ServiceTotal = { service: string; name: string; color: string; cost: number; calls: number }
type PhaseTotal   = { phase: string; name: string; cost: number; calls: number; errors: number; errorRate: number; errorCost: number }
type UserTotal    = { userId: string; isAnonymous: boolean; cost: number; calls: number }
type RecentLog = {
  id: string; created_at: string; service: string; endpoint: string
  usage_amount: number; usage_unit: string; estimated_cost_cny: number; latency_ms: number; status: string
  metadata?: { phase?: string; cost_source?: string; error_kind?: string } | null
}
type PhaseLatency = { phase: string; name: string; p50: number; p90: number; max: number; calls: number }
type TrendPhase   = { phase: string; name: string; days: Array<{ date: string; p50: number | null; p90: number | null; calls: number }> }
type TodayStatus  = {
  todayFailures: number; avgDailyFailures7: number; avgDailyCost7: number
  slowestPhase: { name: string; p90: number } | null
}
type DashboardData = {
  allTimeCost: number; allTimeCalls: number
  monthCost: number;  monthCalls: number; monthChange: number | null
  todayCost:  number; todayCalls: number
  // ── Tier1 今日经营口径 ──
  registeredActiveToday: number; anonSessionsToday: number
  practiceNew: number; practiceReview: number; practiceTotal: number
  todayFailuresByPhase: Array<{ phase: string; count: number }>
  todayFailuresTotal: number; emptyRecordingToday: number
  newRegistrationsToday: number
  avgDailyCalls: number; p50Latency: number; p95Latency: number; errorRate: number; avgDailyCost: number
  failedCost: number; estimateRatio: number; dailyBudget: number
  serviceTotals: ServiceTotal[]
  phaseTotals: PhaseTotal[]
  userTotals: UserTotal[]
  anonymousCost: number
  loggedInCost: number
  dailyData: Array<{ date: string; doubao_asr: number; qwen_flash: number; qwen_plus: number; total: number }>
  dailyFailures: Array<{ date: string; failures: number }>
  engagementTrend: Array<{ date: string; activeUsers: number; practiceSessions: number }>
  retentionPending: boolean
  fakeEmptyPending: boolean
  phaseLatency: PhaseLatency[]
  latencyTrend: TrendPhase[]
  latencyCutoff: string
  latencyWarnMs: number
  todayStatus: TodayStatus
  hourlyData: Array<{ hour: string; calls: number }>
  recentLogs: RecentLog[]
  costlyLogs: RecentLog[]
  failedLogs: RecentLog[]
}

const RANGES = ['7d', '14d', '30d'] as const
type Range = typeof RANGES[number]
const RANGE_LABEL: Record<Range, string> = { '7d': '7天', '14d': '14天', '30d': '30天' }

// 坐标轴刻度色：recharts 的 tick fill 只吃色值、吃不了 Tailwind class，故硬编码。
// 取 v2-text-muted token 值（#7C6B5E，on surface 5.09:1 达 AA），替换原 #A89990（2.75:1 不达标）。
const AXIS_TICK_FILL = '#7C6B5E'

// 迷你统计条（含【日均调用】）—— 归入 F 组「原始日志排障」，从首屏踢出（日均调用曾在首屏误导，pm 点名）。
const MINI_STATS = (d: DashboardData) => [
  { label: '日均调用', value: d.avgDailyCalls.toFixed(1) },
  // 中位数而非均值：同输入长度不同的调用延迟能差 3 倍，均值谁也不代表（P95 保留，答"最坏能多坏"）
  { label: '中位数延迟', value: `${d.p50Latency}ms` },
  { label: 'P95 延迟', value: `${d.p95Latency}ms` },
  { label: '错误率',   value: `${d.errorRate}%` },
  { label: '日均费用', value: formatCny(d.avgDailyCost) },
  { label: '估算占比', value: `${d.estimateRatio}%` },
]

/**
 * 「按环节成本 / 失败率」视图 — 哪个环节最贵、哪个环节在失败。横向条按最高成本归一化。
 * 有失败的环节额外标出「失败率 + 白烧成本」：如 matching 中 extraction 成功记账后 ranking 失败，
 * 该环节的钱花了却没拿到结果，从这里能一眼定位是哪个环节在漏钱。
 * @param phases     已按成本降序的环节聚合数组
 * @param failedCost 本期全部失败调用的成本合计（白烧总额）
 */
function PhaseBreakdown({ phases, failedCost }: { phases: PhaseTotal[]; failedCost: number }) {
  const max = phases.reduce((m, p) => Math.max(m, p.cost), 0)
  return (
    <section aria-label="按环节成本与失败率" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <h2 className="text-[13px] font-semibold text-v2-text-primary">按环节成本 / 失败率</h2>
        {failedCost > 0 && (
          <span className="text-[11px] font-medium text-warning-text">失败白烧 {formatCny(failedCost)}</span>
        )}
      </div>
      {phases.length === 0 ? (
        <div className="text-v2-text-muted text-[12px] py-4 text-center">本期暂无环节数据</div>
      ) : (
        <div className="space-y-2">
          {phases.map(p => (
            <div key={p.phase} className="flex items-center gap-3">
              <span className="text-[11px] text-v2-text-secondary w-24 flex-shrink-0 truncate">{p.name}</span>
              <div className="flex-1 h-2 bg-black/[0.04] rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${p.errors > 0 ? 'bg-warning/70' : 'bg-brand-accent/70'}`}
                  style={{ width: `${max > 0 ? (p.cost / max) * 100 : 0}%` }} />
              </div>
              {/* 失败标记：仅有失败的环节显示，暖色警示 + 失败率，无失败则留空不干扰 */}
              <span className="text-[10px] w-20 text-right flex-shrink-0">
                {p.errors > 0
                  ? <span className="text-warning-text font-medium">失败 {p.errorRate}%</span>
                  : <span className="text-v2-text-muted">—</span>}
              </span>
              <span className="text-[11px] font-medium text-v2-text-primary w-16 text-right flex-shrink-0 tabular-nums">{formatCny(p.cost)}</span>
              <span className="text-[10px] text-v2-text-muted w-14 text-right flex-shrink-0">{p.calls} 次</span>
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
          <h2 className="text-[13px] font-semibold text-v2-text-primary">按用户成本 Top-N</h2>
          {/* 本区块口径独立于区间：按 user_id 全时段累计（抓"谁烧最多"要看历史总账，不随区间切换） */}
          <span className="text-[10px] text-v2-text-muted">全时段累计</span>
        </div>
        {/* 匿名/登录成本占比：匿名占比高 = 陌生人试用在烧钱，内测阶段重点盯 */}
        {attributed > 0 && (
          <span className="text-[11px] text-v2-text-secondary">
            匿名 <span className="font-medium text-warning-text">{formatCny(anonymousCost)} · {anonPct}%</span>
            <span className="mx-1.5 text-v2-text-muted">/</span>
            登录 <span className="font-medium text-v2-text-primary">{formatCny(loggedInCost)}</span>
          </span>
        )}
      </div>
      {users.length === 0 ? (
        <div className="text-v2-text-muted text-[12px] py-4 text-center">暂无可归因到用户的调用</div>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.userId} className="flex items-center gap-3">
              {/* user_id 是 UUID，截前 8 位展示即可辨识、又不占满宽；等宽字体对齐 */}
              <span className="text-[11px] text-v2-text-secondary w-20 flex-shrink-0 truncate" style={{ fontFamily: 'monospace' }}>{u.userId.slice(0, 8)}</span>
              {/* 匿名标记：匿名单独标出（纯成本高风险），登录不占位保持行整洁 */}
              <span className="w-10 flex-shrink-0">
                {u.isAnonymous && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-warning/15 text-warning-text">匿名</span>
                )}
              </span>
              <div className="flex-1 h-2 bg-black/[0.04] rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${u.isAnonymous ? 'bg-warning/70' : 'bg-brand-accent/70'}`}
                  style={{ width: `${max > 0 ? (u.cost / max) * 100 : 0}%` }} />
              </div>
              <span className="text-[11px] font-medium text-v2-text-primary w-16 text-right flex-shrink-0 tabular-nums">{formatCny(u.cost)}</span>
              <span className="text-[10px] text-v2-text-muted w-14 text-right flex-shrink-0">{u.calls} 次</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * 增长组的小统计卡（今日新增注册 / 匿名活跃）：主数字 + 标签 + 一句口径说明。
 * @param label  卡标题
 * @param value  主数字
 * @param note   口径说明小字
 */
function GrowthStat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="flex-1 min-w-[140px] bg-cream-soft rounded-[12px] border border-black/[0.05] px-4 py-3">
      <div className="text-[11px] text-v2-text-muted mb-1">{label}</div>
      <div className="text-[24px] font-bold text-v2-text-primary leading-none tabular-nums">{value}</div>
      <div className="text-[10px] text-v2-text-muted mt-1.5">{note}</div>
    </div>
  )
}

/** 「下一步接入」空态占位（留存 / 假空率本轮未实现真数据，不硬编错数） */
function PendingPlaceholder({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="flex-1 min-w-[140px] bg-black/[0.02] rounded-[12px] border border-dashed border-black/[0.1] px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[11px] text-v2-text-muted">{title}</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-black/[0.04] text-v2-text-muted">下一步接入</span>
      </div>
      <div className="text-[10px] text-v2-text-muted leading-relaxed mt-1">{reason}</div>
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

  const hasRangeData = !!data && data.dailyData.some(d => d.total > 0)
  const hasTodayData = !!data && data.hourlyData.some(h => h.calls > 0)
  // 今日小时分布的 aria 概述用：读屏用户靠这一句掌握"今天调用多不多、集中在几点"
  const todayTotalCalls = data?.hourlyData.reduce((s, h) => s + h.calls, 0) ?? 0
  const todayPeakHour   = data?.hourlyData.reduce((m, h) => (h.calls > m.calls ? h : m), { hour: '', calls: 0 })
    ?? { hour: '', calls: 0 }

  return (
    <main className="max-w-[1400px] mx-auto px-4 md:px-10 pt-8 pb-12">
      {/* 顶部标题 */}
      <div className="mb-6">
        <div className="text-[11px] text-v2-text-muted tracking-[1.5px] uppercase mb-1">LINGOBRIDGE</div>
        <h1 className="text-[22px] font-bold text-v2-text-primary">经营看板</h1>
      </div>

      {denied && (
        <div className="text-v2-text-muted text-[14px] py-10 text-center">无权访问：经营看板仅对管理员开放。</div>
      )}

      {loading && !denied && <div className="text-v2-text-muted text-[14px] py-10 text-center">加载中…</div>}

      {error && !loading && !denied && (
        <div className="flex flex-col items-center gap-3 py-16">
          <div className="text-v2-text-secondary text-[14px]">加载失败，请重试</div>
          <button onClick={() => setReloadKey(k => k + 1)}
            className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-full text-[12px] font-medium bg-v2-text-primary text-white">
            重试
          </button>
        </div>
      )}

      {data && !loading && !denied && !error && (<>
        {/* ── 首屏 Hero 四数卡（今日口径，不随下方区间变）── */}
        <HeroMetrics data={{
          registeredActiveToday: data.registeredActiveToday,
          anonSessionsToday:     data.anonSessionsToday,
          practiceNew:           data.practiceNew,
          practiceReview:        data.practiceReview,
          practiceTotal:         data.practiceTotal,
          todayFailuresByPhase:  data.todayFailuresByPhase,
          todayFailuresTotal:    data.todayFailuresTotal,
          emptyRecordingToday:   data.emptyRecordingToday,
          todayCost:             data.todayCost,
          avgDailyCost7:         data.todayStatus.avgDailyCost7,
          dailyBudget:           data.dailyBudget,
        }} />

        {/* ── Tier2 区间选择器 + 口径注脚（只作用于下方展开区；Tier1 四数卡为今日口径）── */}
        <div className="flex items-center justify-between mb-2 gap-3">
          <div className="text-[13px] font-semibold text-v2-text-primary">明细（可展开）</div>
          <div className="flex bg-white rounded-full border border-black/[0.05] p-0.5 gap-0.5 flex-shrink-0" role="group" aria-label="时间范围">
            {RANGES.map(r => (
              <button key={r} onClick={() => setRange(r)} aria-pressed={range === r}
                className={`min-h-[44px] px-3.5 rounded-full text-[11px] font-medium transition-colors ${range === r ? 'bg-v2-text-primary text-white' : 'text-v2-text-muted'}`}>
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
        <div className="text-[10px] text-v2-text-muted mb-3">
          口径说明：上方四数卡为今日口径（按东八区日历边界）；以下展开区的所有图表与统计均为所选区间（{RANGE_LABEL[range]}）口径。
        </div>

        {/* A · 增长（默认展开） */}
        <CollapsibleSection title="A · 增长" subtitle="今日新增 · 留存（下一步）" defaultOpen>
          <div className="flex gap-2.5 flex-wrap">
            <GrowthStat label="今日新增注册" value={data.newRegistrationsToday} note="profiles 今日 created_at 计数" />
            <GrowthStat label="今日匿名活跃" value={data.anonSessionsToday} note="匿名会话数 · 含重复访问 · 非去重真人" />
            {data.retentionPending && (
              <PendingPlaceholder title="次日 / 7 日留存" reason="需 user_id 跨天配对，口径较重，本轮先占位。" />
            )}
            {data.fakeEmptyPending && (
              <PendingPlaceholder title="假空率" reason="需读 flow_events 判断空录音真伪，本轮先占位。" />
            )}
          </div>
          {/* 转化率不编：仅给「今日新增注册」与「今日匿名活跃」两个数供自行对照，避免硬编错误口径 */}
          <div className="text-[10px] text-v2-text-muted mt-3">
            注：暂不给「匿名→注册」转化率——需匹配匿名与注册的复杂口径，先给上面两个数供人工对照。
          </div>
        </CollapsibleSection>

        {/* B · 故障明细 */}
        <CollapsibleSection title="B · 故障明细" subtitle="每日系统故障（不含空录音）">
          <DailyFailureChart data={data.dailyFailures} />
        </CollapsibleSection>

        {/* C · 耗时 */}
        <CollapsibleSection title="C · 各环节耗时" subtitle="分布 / 趋势">
          <PhaseLatencyPanel phases={data.phaseLatency} trend={data.latencyTrend}
            cutoffLabel={data.latencyCutoff} latencyWarnMs={data.latencyWarnMs} />
        </CollapsibleSection>

        {/* D · 趋势（活跃 + 场次双线） */}
        <CollapsibleSection title="D · 参与度趋势" subtitle="活跃人数 + 练习场次">
          {data.engagementTrend.some(d => d.activeUsers > 0 || d.practiceSessions > 0)
            ? <EngagementTrendChart data={data.engagementTrend} />
            : <div className="text-v2-text-muted text-[12px] h-[180px] flex items-center justify-center">本期暂无参与度数据</div>}
        </CollapsibleSection>

        {/* E · 成本细节 */}
        <CollapsibleSection title="E · 成本细节" subtitle="费用卡 · 趋势 · 按服务 / 环节 / 用户">
          {/* 本月 + 累计（+ 今日）费用卡：日历口径 */}
          <CostCards data={data} />
          <div className="text-[10px] text-v2-text-muted mt-1.5 mb-4">$ 副行按 ¥7.2/$ 估算，非实时汇率</div>

          {/* 费用趋势 + 按服务占比 */}
          <div className="flex items-center justify-end mb-2">
            {/* 筛选可发现性：点占比联动后给显式「全部」出口，否则用户不知如何清除 dim 状态 */}
            {selectedService && (
              <button onClick={() => setSelected(null)}
                className="inline-flex items-center gap-1 min-h-[44px] pl-2.5 pr-3 -my-2 rounded-full text-[11px] font-medium text-v2-text-secondary bg-black/[0.03] hover:bg-black/[0.06] transition-colors">
                <span aria-hidden="true">×</span>清除筛选 · 全部
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
            <section aria-label="费用趋势" className="md:col-span-2 bg-white rounded-[16px] border border-black/[0.05] p-4">
              {hasRangeData
                ? <CostTrendChart data={data.dailyData} selectedService={selectedService} dailyBudget={data.dailyBudget} />
                : <div className="text-v2-text-muted text-[12px] h-[180px] flex items-center justify-center">本期暂无费用数据</div>}
            </section>
            <section aria-label="按服务费用占比" className="md:col-span-1 bg-white rounded-[16px] border border-black/[0.05] p-4">
              <CostBreakdown totals={data.serviceTotals} selected={selectedService} onSelect={setSelected} />
            </section>
          </div>
          <div className="text-[10px] text-v2-text-muted mb-4">
            注：趋势图的日预算线 ¥{data.dailyBudget} 为内测占位参照值、非真实告警阈值——超线仅在卡片染色提示，不触发任何告警推送。
          </div>

          {/* 按环节成本 / 失败率 */}
          <PhaseBreakdown phases={data.phaseTotals} failedCost={data.failedCost} />
          {/* 按用户成本 Top-N（谁烧最多、是不是匿名） */}
          <UserCostBreakdown users={data.userTotals} anonymousCost={data.anonymousCost} loggedInCost={data.loggedInCost} />
        </CollapsibleSection>

        {/* F · 原始日志排障 */}
        <CollapsibleSection title="F · 原始日志排障" subtitle="性能指标 · 小时分布 · 调用明细">
          {/* 迷你统计条（含日均调用，从首屏移入此处） */}
          <section aria-label="性能与成本指标" className="bg-white rounded-[12px] border border-black/[0.05] grid grid-cols-2 md:flex md:divide-x divide-black/[0.05] mb-4 overflow-hidden">
            {MINI_STATS(data).map(s => (
              <div key={s.label} className="flex-1 px-4 py-3 text-center border-b md:border-b-0 border-black/[0.05]">
                <div className="text-[11px] text-v2-text-muted mb-0.5">{s.label}</div>
                <div className="text-[14px] font-semibold text-v2-text-primary">{s.value}</div>
              </div>
            ))}
          </section>

          {/* 今日调用分布（小时） */}
          <section aria-label="今日调用分布" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
            <h2 className="text-[12px] font-medium text-v2-text-secondary mb-2">今日调用分布</h2>
            {hasTodayData ? (<>
              {/* 图表可视区：SVG 对读屏不可读，给 role+aria-label 概述，另附 sr-only 数据表兜底（与同页另图一致） */}
              <div role="img"
                aria-label={`今日调用按小时分布柱状图，全天共 ${todayTotalCalls} 次调用，峰值 ${todayPeakHour.hour} 共 ${todayPeakHour.calls} 次。详细数据见下方数据表。`}>
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={data.hourlyData} barSize={6} margin={{ top: 0, right: 0, bottom: 0, left: -16 }}>
                    <XAxis dataKey="hour" tick={{ fontSize: 9, fill: AXIS_TICK_FILL }} tickLine={false} axisLine={false} interval={3} />
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
              <div className="text-v2-text-muted text-[12px] h-[100px] flex items-center justify-center">今日暂无调用</div>
            )}
          </section>

          {/* 调用明细表格（最近 / 最贵 / 失败可切换，失败视图是每日故障图的下钻出口） */}
          <RecentCallsTable recentLogs={data.recentLogs} costlyLogs={data.costlyLogs} failedLogs={data.failedLogs} />

          {/* 底部单价参考 */}
          <div className="bg-white rounded-[12px] border border-black/[0.05] px-4 py-3 mt-4">
            <div className="text-[11px] text-v2-text-muted leading-relaxed">
              单价参考（估算依据）&nbsp;|&nbsp;豆包 ASR ≈ ¥0.003/秒&nbsp;|&nbsp;千问 Qwen Flash ≈ ¥0.0008/千token&nbsp;|&nbsp;千问 Plus ≈ ¥0.8/¥2.0 per M token（输入/输出）
            </div>
            <div className="text-[10px] text-v2-text-muted mt-1.5">
              * 优先按模型返回的真实 token 计费；无真实用量时回退按字数估算（记录标 cost_source=estimate）。实际账单以各平台控制台为准。
            </div>
          </div>
        </CollapsibleSection>
      </>)}
    </main>
  )
}
