/**
 * @module   dashboard/_sections/RetentionSection
 * @desc     经营看板折叠区③「谁留下了」（2026-08-15 新增）—— 群组类指标集中在这一区：
 *           W1 留存曲线（按周、每点标 n）→ 粘性 DAU/MAU → 用户分层 × 各层留存 + 核心活跃拆分
 *           → 新注册回访表（自「用户走到哪」搬来，它回答的也是「人还回来吗」）。
 *
 *   ⚠️ 本区三块来自 0065 批次（剔内部账户与自测），而回访表来自主看板的 0047 批次（不剔）。
 *      两批人数不可相减 —— 回访表自带口径小字，本区不做任何跨块对照的表达。
 *
 * @author   LingoBridge
 * @created  2026-08-15
 */
import CollapsibleSection from '@/components/dashboard/CollapsibleSection'
import CohortReturnTable from '@/components/dashboard/CohortReturnTable'
import {
  RetentionSeriesBlock, StickinessBlock, UserSegmentsBlock,
} from '@/components/dashboard/CohortGrowthBlocks'
import type { GrowthState, GrowthCohortsResponse } from '@/hooks/useGrowthMetrics'
import type { DashboardData } from './types'

/**
 * 「谁留下了」折叠区
 * @param data        看板数据（本区只消费 cohortReturns）
 * @param cohorts     群组指标三态（父层拉一次，见 useGrowthMetrics 顶注）
 * @param rangeBadge  区间口径 chip 文案
 * @param subtitle    收起态 summary 的常驻结论数字
 */
export default function RetentionSection({ data, cohorts, rangeBadge, subtitle }: {
  data: DashboardData; cohorts: GrowthState<GrowthCohortsResponse>
  rangeBadge: string; subtitle: string
}) {
  return (<>
    {/* ③ 谁留下了（默认收起）：留存曲线 · 粘性 · 分层 · 回访表。 */}
    <CollapsibleSection title="谁留下了" subtitle={subtitle} rangeBadge={rangeBadge}>
      <RetentionSeriesBlock state={cohorts} />
      <StickinessBlock state={cohorts} />
      <UserSegmentsBlock state={cohorts} />
      {/* 新注册的人还回来吗（窗口跟随区间选择器 = rangeDays+1，与本区徽标同数；只显人数分子/分母） */}
      <CohortReturnTable cohort={data.cohortReturns} />
    </CollapsibleSection>
  </>)
}
