/**
 * @module   dashboard/_sections/IncidentSection
 * @desc     经营看板折叠区③「出事了吗」及其两个局部块（PhaseFailureBreakdown / FakeEmptyStat）
 *           —— 2026-08-14 自 `dashboard/page.tsx` 原样抽出（逐字未改、只换位置）。
 *           区内顺序：摘要行 → 每日故障柱 → AI 结局分布（埋点口径）→ 失败环节 → 失败明细 →
 *           假空率 → 各环节耗时（内层再折叠）。
 * @author   LingoBridge
 * @created  2026-08-14
 */
import Card from '@/components/Card'
import CollapsibleSection from '@/components/dashboard/CollapsibleSection'
import DailyFailureChart from '@/components/dashboard/DailyFailureChart'
import RecentCallsTable from '@/components/dashboard/RecentCallsTable'
import PhaseLatencyPanel from '@/components/dashboard/PhaseLatencyPanel'
import { AiOutcomeBlock } from '@/components/dashboard/FlowHealthBlocks'
import FailureImpactBlock from '@/components/dashboard/FailureImpactBlock'
import { ANCHOR_FAILURE_DETAIL, ANCHOR_LATENCY } from '@/lib/dashboard-verdict'
import type { FlowHealthState } from '@/hooks/useFlowHealth'
import type { GrowthState, GrowthUsageResponse } from '@/hooks/useGrowthMetrics'
import { formatCny } from '@/lib/format-cost'
import { phaseDisplayName, PendingPlaceholder } from './shared'
import type { DashboardData, PhaseTotal } from './types'

/**
 * 块B「哪个环节在失败」（归「出事了吗」）— 只列 errors>0 的环节，每行 = 环节名 + 失败X次(占该环节调用Y%) + 白烧¥。
 * 如 matching 中 extraction 成功记账后 ranking 失败，从这里能一眼定位是哪个环节在漏钱。全无失败整块不渲染。
 * @param phases     环节聚合数组（内部按失败次数降序重排）
 * @param failedCost 本期全部失败调用的成本合计（白烧总额）
 */
function PhaseFailureBreakdown({ phases, failedCost }: { phases: PhaseTotal[]; failedCost: number }) {
  const failing = phases.filter(p => p.errors > 0).sort((a, b) => b.errors - a.errors || b.errorCost - a.errorCost)
  // 无失败时整块不渲染（方案 §五：删「本期各环节无失败」空占位卡——①区摘要行已交代无失败）
  if (failing.length === 0) return null
  return (
    <section aria-label="按环节失败率" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">哪个环节在失败</h2>
        {failedCost > 0 && (
          <span className="text-[0.6875rem] font-medium text-warning-text">失败白烧 {formatCny(failedCost)}</span>
        )}
      </div>
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
    </section>
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

/**
 * 「出事了吗」折叠区
 * @param data              看板数据
 * @param flow              客户端埋点观测三态（父层拉一次，AI 结局分布消费）
 * @param rangeBadge        区间口径 chip 文案
 * @param incidentSubtitle  收起态 summary 的常驻结论数字（本期失败 + 该我们修）
 * @param rangeFailures     本期系统故障次数（区间口径，摘要行用）
 * @param oursTotal         flow_events「该我们修」桶合计；flow 未到/失败时 null，摘要行省略该段
 * @param usage             使用与故障三态（本区只消费 failureImpact 一块）
 */
export default function IncidentSection({ data, flow, rangeBadge, incidentSubtitle, rangeFailures, oursTotal, usage }: {
  data: DashboardData; flow: FlowHealthState; rangeBadge: string
  incidentSubtitle: string; rangeFailures: number; oursTotal: number | null
  usage: GrowthState<GrowthUsageResponse>
}) {
  return (<>
    {/* ③ 出事了吗（defaultOpen 数据驱动：今日有计费失败才默认展开，结论条会点名）：
        每日故障柱 + AI 结局分布（埋点口径）+ 失败环节 + 失败明细 + 耗时。 */}
    <CollapsibleSection title="出事了吗" subtitle={incidentSubtitle}
      rangeBadge={rangeBadge} defaultOpen={data.todayFailuresTotal > 0}>
      {/* 顶部摘要行（方案 §五）：本期失败 + 该我们修（区间口径）+ 今日空录音（自原 Hero 失败卡
          副行移入，上次误报来源、信息不许丢）+ 最慢环节（耗时面板降收起后其摘要提到这里） */}
      <div className="text-[0.6875rem] text-v2-text-secondary mb-2 leading-relaxed">
        本期 <span className="font-medium tabular-nums">{rangeFailures}</span> 次计费失败
        {oursTotal != null && <> · 该我们修 <span className="font-medium tabular-nums">{oursTotal}</span></>}
        {' · '}今日空录音 <span className="tabular-nums">{data.emptyRecordingToday}</span> 次（不算故障）
        {data.todayStatus.slowestPhase && (
          <> · 最慢环节 {data.todayStatus.slowestPhase.name} P90 <span className="tabular-nums">{(data.todayStatus.slowestPhase.p90 / 1000).toFixed(1)}s</span></>
        )}
      </div>
      <DailyFailureChart data={data.dailyFailures} />
      <div className="mt-4">
        <AiOutcomeBlock state={flow} />
        {/* 块B「哪个环节在失败」：只列有失败的环节 + 白烧成本（计费口径）；无失败整块不渲染 */}
        <PhaseFailureBreakdown phases={data.phaseTotals} failedCost={data.failedCost} />
        {/* 每类故障波及多少人（0065 口径）：次数之外补上「影响面」，无归属的行照实说无归属、不显 0 人 */}
        <FailureImpactBlock state={usage} />
        {/* 失败明细表：仅本期有失败时渲染（删空表，方案 §五）；锚点包裹 = 结论条失败 chip 与
            「该我们修」格下钻的共同落点 */}
        {data.failedLogs.length > 0 && (
          <div id={ANCHOR_FAILURE_DETAIL} tabIndex={-1}>
            <RecentCallsTable recentLogs={data.recentLogs} costlyLogs={data.costlyLogs} failedLogs={data.failedLogs}
              views={['failed']} defaultMode="failed" />
          </div>
        )}
        {/* 假空率小卡（自用户区搬来，方案 §四/§五）：「采到声音却转写空」是采集故障性质，归本区 */}
        <div className="flex mt-4">
          {data.fakeEmpty
            ? <FakeEmptyStat fakeEmpty={data.fakeEmpty} threshold={data.fakeEmptyThreshold} />
            : <PendingPlaceholder title="假空率" reason="区间内暂无带采集信号的空录音（埋点口径生效前无数据），有空录音发生后自动显示真实占比。" />}
        </div>
        {/* 各环节耗时降为默认收起（方案 §五）：摘要已提进顶部摘要行；慢也是一种"出事了"，
            但天天展开一屏分位数没人读。锚点在 details 内层，jumpToAnchor 会连同本折叠一起展开。 */}
        <details className="mt-4">
          <summary className="cursor-pointer list-none select-none min-h-[44px] flex items-center text-[0.75rem] font-medium text-v2-text-secondary [&::-webkit-details-marker]:hidden">
            各环节耗时（点开：分布 / 趋势）
          </summary>
          <div id={ANCHOR_LATENCY} tabIndex={-1}>
            <PhaseLatencyPanel phases={data.phaseLatency} trend={data.latencyTrend}
              cutoffLabel={data.latencyCutoff} latencyWarnMs={data.latencyWarnMs} />
          </div>
        </details>
      </div>
    </CollapsibleSection>
  </>)
}
