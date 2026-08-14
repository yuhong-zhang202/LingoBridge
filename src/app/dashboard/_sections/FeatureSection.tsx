/**
 * @module   dashboard/_sections/FeatureSection
 * @desc     经营看板折叠区④「用户在用什么」（2026-08-15 新增）—— 只放功能使用矩阵一块：
 *           10 项功能按产品语义分三组（主线 / 沉淀 / 复习），给人数 / 次数 / 人均（贴样本量 n）。
 *
 *   ⚠️ 这一区刻意不排序、不画条形、不给"最受欢迎功能"这类总结句：各行口径不同
 *      （详见 FeatureUsageTable 顶注与响应自带的 tabViewCaveat），任何比大小的版式都是误导。
 *
 * @author   LingoBridge
 * @created  2026-08-15
 */
import CollapsibleSection from '@/components/dashboard/CollapsibleSection'
import FeatureUsageTable from '@/components/dashboard/FeatureUsageTable'
import type { GrowthState, GrowthUsageResponse } from '@/hooks/useGrowthMetrics'

/**
 * 「用户在用什么」折叠区
 * @param usage       使用与故障三态（父层拉一次，见 useGrowthMetrics 顶注）
 * @param rangeBadge  区间口径 chip 文案
 */
export default function FeatureSection({ usage, rangeBadge }: {
  usage: GrowthState<GrowthUsageResponse>; rangeBadge: string
}) {
  return (<>
    {/* ④ 用户在用什么（默认收起）：功能使用矩阵 10 行三组。 */}
    <CollapsibleSection title="用户在用什么" subtitle="主线 / 沉淀 / 复习 · 人数·次数·人均"
      rangeBadge={rangeBadge}>
      <FeatureUsageTable state={usage} />
    </CollapsibleSection>
  </>)
}
