/**
 * @module   dashboard/TodayStatusBar
 * @desc     顶部「今日状况」条 —— 内测期一眼判断"今天有没有出事"：失败 / 费用 / 最慢环节三格。
 *           整条底色随状态变（有失败即染色），扫过去只要不是白的就该点进去看。
 * @author   LingoBridge
 * @created  2026-07-20
 */
import type { ReactNode } from 'react'
import { formatCny } from '@/lib/format-cost'

type TodayStatus = {
  todayFailures: number
  avgDailyFailures7: number
  avgDailyCost7: number
  slowestPhase: { name: string; p90: number } | null
}

/** 毫秒转秒（1 位小数），单位在耗时相关展示里统一为秒 */
function toSec(ms: number): string {
  return (ms / 1000).toFixed(1)
}

/**
 * 单格外壳：标题小字 + 主值 + 副行基线值，三格结构一致，只有主值字号/配色不同
 * @param label  格标题
 * @param main   主值节点（已带好字号与配色）
 * @param sub    副行小字（近 7 日基线，无则不渲染）
 */
function Cell({ label, main, sub }: { label: string; main: ReactNode; sub?: string }) {
  return (
    <div className="flex-1 px-4 py-3">
      <div className="text-[11px] text-v2-text-muted mb-1">{label}</div>
      {main}
      {sub && <div className="text-[10px] text-v2-text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

/**
 * 今日状况条
 *
 * 时间窗【固定为今日 + 近 7 日基线】，不随区间选择器变（与「按用户成本」的「全时段累计」同理）：
 * 判断"今天是否异常"要跟稳定基线比，基线跟着区间漂移会让 30 天视图稀释掉今天的异常。
 *
 * @param status         今日失败/费用基线/最慢环节聚合
 * @param todayCost      今日花费（日历口径，与费用卡同源）
 * @param dailyBudget    日预算参照线金额
 * @param latencyWarnMs  环节 P90 警示阈值（毫秒）
 */
export default function TodayStatusBar({
  status, todayCost, dailyBudget, latencyWarnMs,
}: {
  status: TodayStatus; todayCost: number; dailyBudget: number; latencyWarnMs: number
}) {
  const hasFailure = status.todayFailures > 0
  // 费用异常：超近 7 日均值 2 倍（突增）或超日预算参照线（绝对值过高），两者任一即告警
  const costWarn = (status.avgDailyCost7 > 0 && todayCost > status.avgDailyCost7 * 2) || todayCost > dailyBudget
  const slow     = status.slowestPhase
  const slowWarn = !!slow && slow.p90 > latencyWarnMs

  // 有失败 = 整条染红底 + 红边。这是"一眼"的核心：不是白的就有事。
  const shell = hasFailure
    ? 'bg-error/[0.06] border-error/20'
    : 'bg-white border-black/[0.05]'

  // 状态【不只靠颜色】承载：失败格始终有"今日无失败 / 今日失败 N 次"的文字与数字
  const aria = hasFailure
    ? `今日状况：失败 ${status.todayFailures} 次，近 7 日日均 ${status.avgDailyFailures7} 次`
    : '今日状况：今日无失败'

  return (
    <section aria-label={aria}
      className={`rounded-[16px] border grid grid-cols-1 md:flex md:divide-x divide-black/[0.05] mb-4 overflow-hidden ${shell}`}>
      <Cell
        label="今日失败"
        main={
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${hasFailure ? 'bg-error' : 'bg-success'}`} />
            <span className={`text-[18px] font-bold tabular-nums ${hasFailure ? 'text-error' : 'text-v2-text-primary'}`}>
              {hasFailure ? `今日失败 ${status.todayFailures} 次` : '今日无失败'}
            </span>
          </div>
        }
        sub={`近 7 日日均 ${status.avgDailyFailures7} 次`}
      />
      <Cell
        label="今日花费"
        main={
          <div className={`text-[14px] font-semibold tabular-nums ${costWarn ? 'text-warning-text' : 'text-v2-text-primary'}`}>
            {formatCny(todayCost)}
            {costWarn && <span className="ml-1.5 text-[11px] font-medium">偏高</span>}
          </div>
        }
        sub={`近 7 日日均 ${formatCny(status.avgDailyCost7)} · 日预算 ¥${dailyBudget}`}
      />
      <Cell
        label="最慢环节"
        main={
          <div className={`text-[14px] font-semibold tabular-nums ${slowWarn ? 'text-warning-text' : 'text-v2-text-primary'}`}>
            {slow ? `${slow.name} P90 ${toSec(slow.p90)}s` : '暂无耗时数据'}
            {slowWarn && <span className="ml-1.5 text-[11px] font-medium">超 {toSec(latencyWarnMs)}s</span>}
          </div>
        }
        sub={slow ? `P90 超 ${toSec(latencyWarnMs)}s 即标记` : undefined}
      />
    </section>
  )
}
