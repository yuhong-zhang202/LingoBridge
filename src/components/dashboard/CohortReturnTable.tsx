/**
 * @module   dashboard/CohortReturnTable
 * @desc     「新注册的人还回来吗」（方案 §四）—— 近 7 天按注册日分组的回访表：
 *           注册日 / 注册人数 / 次日回来 / 至今回来。【只显人数分子/分母，不显任何百分比】
 *           （个位数样本下百分比是假精度）。「待满 1 天」的行绝不显 0 冒充流失；
 *           无注册的日子合并成一行「其余 N 天无新注册」。口径小字必须写明
 *           「回来 = 有任意使用记录（含仅浏览）」（产品方拍板的宽口径，不许省）。
 *           类型与 lib/db/dashboard-metrics 的 CohortReturns 手工对齐（该模块 server-only，
 *           客户端组件不 import，沿用 FeedbackTodoList 的同款做法）。
 * @author   LingoBridge
 * @created  2026-08-04
 */

/** 单个注册日的回访统计（与 dashboard-metrics.CohortDayStat 一致） */
export type CohortDayStat = {
  dateLabel: string
  registered: number
  d1Pending: boolean
  d1Returned: number
  totalReturned: number
}
/** cohort 整块（与 dashboard-metrics.CohortReturns 一致） */
export type CohortReturns = { days: CohortDayStat[]; emptyDays: number }

/** 「x/y」分数格（tabular-nums 对齐） */
function Fraction({ num, den }: { num: number; den: number }) {
  return <span className="tabular-nums text-v2-text-primary font-medium">{num}/{den}</span>
}

/** 「待满 1 天」占位（muted，绝不显 0 冒充流失） */
function PendingCell() {
  return <span className="text-v2-text-muted">待满 1 天</span>
}

/**
 * 近 7 天注册回访表
 * @param cohort  /api/dashboard 的 cohortReturns 字段；null = 读取失败降级
 */
export default function CohortReturnTable({ cohort }: { cohort: CohortReturns | null }) {
  return (
    <section aria-label="新注册的人还回来吗" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mt-4">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">新注册的人还回来吗</h2>
        <span className="text-[0.6875rem] text-v2-text-muted">近 7 天注册分组 · 固定窗口</span>
      </div>

      {cohort == null && (
        <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">回访数据暂时读取失败，刷新页面重试。</div>
      )}

      {cohort != null && cohort.days.length === 0 && (
        <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">近 7 天无新注册。</div>
      )}

      {cohort != null && cohort.days.length > 0 && (
        <table className="w-full text-[0.6875rem]">
          <thead>
            <tr className="border-b border-black/[0.04]">
              <th scope="col" className="px-2 py-1.5 text-left font-medium text-v2-text-muted">注册日</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium text-v2-text-muted">注册</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium text-v2-text-muted">次日回来</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium text-v2-text-muted">至今回来</th>
            </tr>
          </thead>
          <tbody>
            {cohort.days.map(d => (
              <tr key={d.dateLabel} className="border-b border-black/[0.03]">
                <th scope="row" className="px-2 py-2 text-left font-normal text-v2-text-secondary tabular-nums">{d.dateLabel}</th>
                <td className="px-2 py-2 text-right text-v2-text-secondary tabular-nums">{d.registered} 人</td>
                <td className="px-2 py-2 text-right">
                  {d.d1Pending ? <PendingCell /> : <Fraction num={d.d1Returned} den={d.registered} />}
                </td>
                {/* 「至今」在注册日+1 未过完时同样待满：按口径「注册当天不算回来」，此时显 0 只会冒充流失 */}
                <td className="px-2 py-2 text-right">
                  {d.d1Pending ? <PendingCell /> : <Fraction num={d.totalReturned} den={d.registered} />}
                </td>
              </tr>
            ))}
            {cohort.emptyDays > 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-2 text-v2-text-muted">其余 {cohort.emptyDays} 天无新注册</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {/* 口径小字：宽口径措辞是产品方拍板原文，不许省（方案开头「两个已按建议执行的决定」之一） */}
      <div className="text-[0.625rem] text-v2-text-muted mt-2 leading-relaxed">
        口径：回来 = 当日有任意使用记录（含仅浏览）· 注册当天不算 · 东八区；未满次日的行显「待满 1 天」，不显 0。
        已剔除自测流量与内部账户。
      </div>
    </section>
  )
}
