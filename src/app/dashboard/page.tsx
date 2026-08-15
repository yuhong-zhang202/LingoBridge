'use client'
/**
 * @module   dashboard/page
 * @desc     Admin 经营看板（2026-08-04 重设计稿）— 顶部「今日结论条」（今天有没有事要处理）
 *           + Hero 三卡（今日新增注册/核心活跃/练习场次，今日口径）+ 七个问句式折叠区（所选区间口径）。
 *           不含 TabBar/TopBar，仅管理员可见。
 *
 *   【信息架构】折叠区顺序按产品方拍板优先级钉死（2026-08-15 改版后共七区）：有新反馈吗 →
 *   用户走到哪 → 谁留下了 → 用户在用什么 → 出事了吗 → 钱花在哪 → 看板自己还准吗。
 *   刻意不做「有事时物理位置提前」的动态排序（单人日读用户会形成
 *   位置记忆，跳变破坏可预期性）；有事的引导由结论条锚点承担。各区收起态 summary 带常驻结论数字。
 *   「出事了吗」的 defaultOpen 数据驱动（今日有计费失败才默认展开），open 走惰性 useState
 *   只算一次模式（见 CollapsibleSection 顶注）。
 *
 *   【文件边界】2026-08-14 纯结构拆分：五个折叠区的 JSX 与各自的局部组件已搬到 `_sections/`
 *   下的同名文件（逐字未改、只换位置），本文件只剩【数据获取与状态、区间切换、区块编排与顺序】。
 *   跨区共用的小件在 `_sections/shared.tsx`，响应数据类型在 `_sections/types.ts`。
 *
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { useState, useEffect } from 'react'
import HeroMetrics    from '@/components/dashboard/HeroMetrics'
import TodayVerdictBar from '@/components/dashboard/TodayVerdictBar'
import { groupEvents } from '@/components/dashboard/FlowHealthBlocks'
import { useFlowHealth } from '@/hooks/useFlowHealth'
import { useGrowthFunnel, useGrowthCohorts, useGrowthUsage } from '@/hooks/useGrowthMetrics'
import { apiFetch } from '@/lib/api-client'
import type { DashboardData } from './_sections/types'
import FeedbackSection  from './_sections/FeedbackSection'
import UsersSection     from './_sections/UsersSection'
import RetentionSection from './_sections/RetentionSection'
import FeatureSection   from './_sections/FeatureSection'
import IncidentSection  from './_sections/IncidentSection'
import CostSection      from './_sections/CostSection'
import SelfCheckSection from './_sections/SelfCheckSection'

const RANGES = ['7d', '14d', '30d'] as const
type Range = typeof RANGES[number]
const RANGE_LABEL: Record<Range, string> = { '7d': '7天', '14d': '14天', '30d': '30天' }

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
  // 产品增长指标（0064/0065 三条子路由）：同样父层各拉一次，喂给②③④⑤四个区
  // （usage 一份要同时喂④「用户在用什么」与⑤「出事了吗」的故障影响面）。
  const growthFunnel  = useGrowthFunnel(range)
  const growthCohorts = useGrowthCohorts(range)
  const growthUsage   = useGrowthUsage(range)

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
  // 增长三区（用户走到哪 / 谁留下了 / 用户在用什么）走 0064/0065 的 RPC，窗口是【闭区间
  // [今日-N, 今日]】= N+1 个日历日，比主看板那批（rangeStartDate 起、恰好 N 天）多一天。
  // 徽标必须写真实天数：表内 caption 与「口径·来源」列已经在写 windowTotalDays（= N+1），
  // 徽标若还写 N，同一块数据上会出现两个互相打架的天数。
  // ⚠️ 真源是 dashboard-growth-shared 的 `windowTotalDays = windowDays + 1`，改那边要同步这里。
  const growthRangeBadge = `近 ${windowDays + 1} 天`
  const hasRangeData = !!data && data.dailyData.some(d => d.total > 0)

  // ── 各区收起态 summary 的常驻结论数字（方案 §一骨架）──
  // ⑤区「出事了吗」：本期系统故障次数（区间口径）+ flow_events「该我们修」桶（同为区间口径，两者同源可并列；
  //      它刻意不进「今日」口径的结论条，理由见 dashboard-verdict 顶注）。flow 未到/失败时省略该段。
  const rangeFailures = data?.dailyFailures.reduce((s, d) => s + d.failures, 0) ?? 0
  const fh = flow.data
  const oursTotal = fh ? fh.aiCall.reduce((s, st) => s + st.ourSide, 0) : null
  const incidentSubtitle = `本期失败 ${rangeFailures} 次${oursTotal != null ? ` · 该我们修 ${oursTotal}` : ''}`
  // ②区：七步漏斗的两端（建号 → 拿到反馈卡），漏斗未到/降级时退回静态说明。
  //      刻意只取首尾两个数、不在 summary 里放转化率：跨源窗口下的整链转化率没有稳定含义。
  const gf = growthFunnel.data?.funnel ?? null
  const usersSubtitle = gf && gf.steps.length > 0
    ? `建号 ${gf.steps[0].users} 人 → 拿到反馈卡 ${gf.steps[gf.steps.length - 1].users} 人`
    : '七步主线漏斗 · 质量注脚 · 额度墙'
  // ③区：窗口内来过的人 + 其中核心活跃（同一批 0065 口径，可并列；不与主看板那批相减）
  const gs = growthCohorts.data?.segments ?? null
  const retentionSubtitle = gs
    ? `窗口来过 ${gs.segmentBase} 人 · 核心活跃 ${gs.coreActive} 人`
    : 'W1 留存 · 粘性 · 分层'
  // ⑦区：埋点事件健康一句话（复用 FlowSelfCheckBlock 的 groupEvents，保证判定同式）。
  //      只数红档 dead；灰档「待首次触发」不是异常、不进告警数。flow 未到时退回静态说明。
  const eventGroups = fh ? groupEvents(fh.eventCounts) : null
  const selfCheckSubtitle = fh && eventGroups
    ? (eventGroups.dead.length > 0
        ? `埋点 ${eventGroups.dead.length} 个事件疑似归零`
        : eventGroups.never.length > 0
          ? `埋点无异常 · ${eventGroups.never.length} 个事件待首次触发`
          : `埋点 ${fh.eventCounts.length} 事件全通`)
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
            className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-full text-[0.75rem] font-medium bg-v2-text-primary text-white focus-visible:ring-2 focus-visible:ring-brand-primary/40">
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
                className={`min-h-[44px] px-3.5 rounded-full text-[0.6875rem] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-primary/40 ${range === r ? 'bg-v2-text-primary text-white' : 'text-v2-text-muted'}`}>
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
        {/* 口径注脚缩成一句：细分口径已跟着各区块的 rangeBadge 与卡内小字走，不必在顶部再铺一段 */}
        <div className="text-[0.625rem] text-v2-text-muted mb-3">
          上方三数卡＝今日（东八区日历边界）；下方各区＝所选区间（{RANGE_LABEL[range]}）。
        </div>
        {/* Hero 两个数的口径必须写出来，写在这里而不是卡上（三卡本次不动）：
            「核心活跃」不写清就会被当成"打开过 App 的人"，匿名会话不写清就会被人加进注册活跃里。 */}
        <div className="text-[0.625rem] text-v2-text-muted mb-3 leading-relaxed">
          今日核心活跃口径 —— 需调用 AI / 复习闪卡 / 收藏任一，纯浏览不计入；
          匿名会话数是去重身份（按设备持久、非唯一真人），绝不与注册活跃相加。
        </div>

        {/* ── 七个问句式折叠区：顺序按产品方拍板的优先级钉死，勿调（理由见本文件顶注「信息架构」）。
            各区的 JSX 与局部逻辑分别落在 _sections/ 下的同名文件，这里只负责编排与传参。 */}
        <FeedbackSection data={data} />

        <UsersSection data={data} funnel={growthFunnel} rangeBadge={growthRangeBadge}
          windowDays={windowDays} subtitle={usersSubtitle} />

        <RetentionSection data={data} cohorts={growthCohorts} rangeBadge={growthRangeBadge} subtitle={retentionSubtitle} />

        <FeatureSection usage={growthUsage} rangeBadge={growthRangeBadge} />

        <IncidentSection data={data} flow={flow} rangeBadge={rangeBadge}
          incidentSubtitle={incidentSubtitle} rangeFailures={rangeFailures} oursTotal={oursTotal}
          usage={growthUsage} />

        <CostSection data={data} rangeBadge={rangeBadge} windowDays={windowDays} hasRangeData={hasRangeData}
          selectedService={selectedService} setSelected={setSelected} />

        <SelfCheckSection data={data} flow={flow} rangeBadge={rangeBadge} selfCheckSubtitle={selfCheckSubtitle} />
      </>)}
    </main>
  )
}
