/**
 * @module   dashboard/_sections/UsersSection
 * @desc     经营看板折叠区②「用户走到哪」—— 2026-08-14 自 `dashboard/page.tsx` 原样抽出
 *           （JSX 逐字未改、只换位置）。区内顺序：增长漏斗 → 注册回访 cohort → 页面活跃 →
 *           离开页占位 → 参与度趋势。
 * @author   LingoBridge
 * @created  2026-08-14
 */
import CohortReturnTable from '@/components/dashboard/CohortReturnTable'
import PageActivityList from '@/components/dashboard/PageActivityList'
import CollapsibleSection from '@/components/dashboard/CollapsibleSection'
import EngagementTrendChart from '@/components/dashboard/EngagementTrendChart'
import { GrowthFunnel } from './GrowthFunnel'
import { PendingPlaceholder } from './shared'
import type { DashboardData } from './types'

/**
 * 「用户走到哪」折叠区
 * @param data        看板数据（区内各块各取所需字段）
 * @param rangeBadge  区间口径 chip 文案（收起态也看得见这块数据的时间范围）
 * @param windowDays  区间天数（7/14/30），漏斗③与页面活跃的「近 N 天」口径用
 */
export default function UsersSection({ data, rangeBadge, windowDays }: {
  data: DashboardData; rangeBadge: string; windowDays: number
}) {
  return (<>
    {/* ② 用户走到哪（默认收起）：增长漏斗 → 注册回访 cohort → 页面活跃 → 离开页占位 → 参与度趋势。
        与 Hero 重复的「今日新增注册」「今日匿名活跃」两张小卡已删（Hero 三卡承接）；
        假空率小卡挪去「出事了吗」区（它是采集故障性质，不是用户行为）。 */}
    <CollapsibleSection title="用户走到哪" subtitle="注册→激活→留存 · 页面活跃"
      rangeBadge={rangeBadge}>
      {/* 增长漏斗：③ 窗口核心活跃跟随区间选择器（近 N 天） */}
      <GrowthFunnel data={data} windowDays={windowDays} />
      {/* 新注册的人还回来吗（固定近 7 天注册分组，只显人数分子/分母） */}
      <CohortReturnTable cohort={data.cohortReturns} />
      {/* 哪些页面被用得多（窗口 page.view 聚合；防 UV 误读见组件顶注） */}
      <PageActivityList stats={data.pageViewStats} truncated={data.pageViewsTruncated} windowDays={windowDays} />
      {/* 离开页分布：暂缓项占位（埋点满 14 天且周活跃 ≥ 5 人再上，方案 §八记录在案） */}
      <div className="flex mt-3">
        <PendingPlaceholder title="离开页分布"
          reason="数据积累中，页面埋点满 14 天后此处自动显示（首页缺口会把部分离开错记到前一页，届时一并标注）。" />
      </div>
      {/* 参与度趋势（活跃 + 场次 + 新增注册 三线；新增注册线在迁移未跑/降级时不渲染）并入本组 */}
      <div className="mt-4">
        <div className="text-[0.75rem] font-medium text-v2-text-secondary mb-2">参与度趋势 · 核心活跃人数 + 练习场次 + 新增注册</div>
        {data.engagementTrend.some(d => d.activeUsers > 0 || d.practiceSessions > 0)
          ? <EngagementTrendChart data={data.engagementTrend} />
          : <div className="text-v2-text-muted text-[0.75rem] h-[180px] flex items-center justify-center">本期暂无参与度数据</div>}
      </div>
    </CollapsibleSection>
  </>)
}
