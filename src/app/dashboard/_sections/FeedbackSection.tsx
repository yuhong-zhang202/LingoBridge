/**
 * @module   dashboard/_sections/FeedbackSection
 * @desc     经营看板折叠区①「有新反馈吗」—— 2026-08-14 自 `dashboard/page.tsx` 原样抽出
 *           （逐字未改、只换位置）。全量口径、不随区间选择器变，故本区块不收 rangeBadge。
 * @author   LingoBridge
 * @created  2026-08-14
 */
import FeedbackTodoList from '@/components/dashboard/FeedbackTodoList'
import { ANCHOR_FEEDBACK } from '@/lib/dashboard-verdict'
import type { DashboardData } from './types'

/**
 * 「有新反馈吗」区块
 * @param data  看板数据（只消费 feedback 一项）
 */
export default function FeedbackSection({ data }: { data: DashboardData }) {
  return (<>
    {/* ① 有新反馈吗（第一区，产品方拍板优先级最高；全量口径、不随区间选择器变）。
        锚点包裹（tabIndex=-1 接受移焦）：结论条「反馈 N 条未处理」chip 跳到这里并展开。 */}
    <div id={ANCHOR_FEEDBACK} tabIndex={-1}>
      <FeedbackTodoList feedback={data.feedback} />
    </div>
  </>)
}
