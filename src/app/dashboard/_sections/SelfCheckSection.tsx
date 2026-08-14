/**
 * @module   dashboard/_sections/SelfCheckSection
 * @desc     经营看板折叠区⑤「看板自己还准吗」及其迷你统计条 —— 2026-08-14 自
 *           `dashboard/page.tsx` 原样抽出（逐字未改、只换位置）。
 *           这一区回答「我的传感器还活着吗」：埋点自检 + 迷你统计 + 最近/最贵调用明细。
 * @author   LingoBridge
 * @created  2026-08-14
 */
import CollapsibleSection from '@/components/dashboard/CollapsibleSection'
import RecentCallsTable from '@/components/dashboard/RecentCallsTable'
import { FlowSelfCheckBlock } from '@/components/dashboard/FlowHealthBlocks'
import type { FlowHealthState } from '@/hooks/useFlowHealth'
import { formatCny } from '@/lib/format-cost'
import type { DashboardData } from './types'

// 迷你统计条 —— 归「看板自己还准吗」的技术明细。2026-08-04 瘦身（方案 §六）：
// 删「中位数延迟 / P95 延迟」（与①区耗时面板双口径打架、是误导源）与「错误率」（与①区重复），
// 只留三项；route 返回字段不动、仅不展示。
const MINI_STATS = (d: DashboardData) => [
  { label: '日均调用', value: d.avgDailyCalls.toFixed(1) },
  { label: '日均费用', value: formatCny(d.avgDailyCost) },
  { label: '估算占比', value: `${d.estimateRatio}%` },
]

/**
 * 「看板自己还准吗」折叠区
 * @param data              看板数据（迷你统计条与调用明细消费）
 * @param flow              客户端埋点观测三态（父层拉一次，埋点自检消费）
 * @param rangeBadge        区间口径 chip 文案
 * @param selfCheckSubtitle 收起态 summary 的埋点健康一句话
 */
export default function SelfCheckSection({ data, flow, rangeBadge, selfCheckSubtitle }: {
  data: DashboardData; flow: FlowHealthState; rangeBadge: string; selfCheckSubtitle: string
}) {
  return (<>
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

      {/* 「今日调用分布」小时柱图已删（方案 §六瘦身：单人日读没有按小时排障的场景，
          route 的 hourlyData 字段保留、仅不展示） */}

      {/* 调用明细表格：本区给最近 / 最贵（失败视图归「出事了吗」） */}
      <RecentCallsTable recentLogs={data.recentLogs} costlyLogs={data.costlyLogs} failedLogs={data.failedLogs}
        views={['recent', 'costly']} defaultMode="recent" />
    </CollapsibleSection>
  </>)
}
