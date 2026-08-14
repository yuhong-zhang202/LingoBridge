'use client'
/**
 * @module   dashboard/FailureImpactBlock
 * @desc     「出事了吗」区追加的一块：每类故障【波及了多少人】（0065 批次，口径与既有的
 *           今日故障 / 每日失败柱同源 —— 同一套 isSystemError + 环节分类，只多了「影响用户数」一列）。
 *
 *   🔴【affectedUsers=0 不等于「没影响人」】生产真实数据里，匹配 / 分析两类故障的失败行
 *   user_id 全为空（无归属调用 / 补归属列之前的老行），affectedUsers 会是 0 而 unattributed 是全部。
 *   若照直显示「影响 0 人」，会被读成"这类故障无害"。故此处显示【无法归因到人】而不是 0。
 *
 *   ⚠️ 各环节的影响人数相加 ≠ 总影响人数（同一个人可能在多个环节踩到故障，跨环节要重新去重）。
 *
 * @author   LingoBridge
 * @created  2026-08-15
 */
import type { GrowthState, GrowthUsageResponse } from '@/hooks/useGrowthMetrics'

/**
 * 每类故障的影响面
 * @param state  /api/dashboard/growth/usage 的三态（父层拉一次，见 useGrowthMetrics 顶注）
 */
export default function FailureImpactBlock({ state }: { state: GrowthState<GrowthUsageResponse> }) {
  const res = state.data
  const impact = res?.failureImpact ?? null

  return (
    <section aria-label="每类故障波及多少人" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">每类故障波及多少人</h2>
        <span className="text-[0.6875rem] text-v2-text-muted">已剔内部账户与自测</span>
      </div>

      {state.loading && !res && <div className="text-v2-text-muted text-[0.75rem] py-2">加载中…</div>}
      {state.error && <div className="text-v2-text-muted text-[0.75rem] py-2">故障影响面暂时读取失败，刷新页面重试。</div>}
      {res?.failureImpactPending === true && (
        <div className="text-v2-text-muted text-[0.75rem] py-2 leading-relaxed">
          故障影响面查询暂不可用（查询失败或迁移未跑），恢复后自动显示。
        </div>
      )}

      {/* 触顶提示放在表【之前】：数字的可信度是读表的前提（同 CohortReturnTable 的纪律） */}
      {impact?.truncated === true && (
        <div role="alert" className="text-[0.6875rem] text-error mb-2 leading-relaxed">
          <span aria-hidden="true">⚠️</span> 取数触顶：最新那批失败行被丢弃，下表次数与人数【均偏低】（不会偏高）。
        </div>
      )}

      {impact && impact.byPhase.length === 0 && (
        <div className="text-v2-text-secondary text-[0.6875rem]">本期没有系统故障。</div>
      )}

      {impact && impact.byPhase.length > 0 && (<>
        <table className="w-full text-[0.6875rem]">
          <caption className="text-left text-[0.625rem] text-v2-text-muted pb-2 leading-relaxed">
            按环节的系统故障影响面。口径与「每日故障」柱图同源（只数系统故障：不含用户输入问题 / 容量繁忙 / 网络中断）。
          </caption>
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-black/[0.04]">
              <th scope="col" className="px-2 py-1.5 text-left font-medium text-v2-text-muted">环节</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium text-v2-text-muted">失败次数</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium text-v2-text-muted">影响用户</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium text-v2-text-muted">其中无归属</th>
            </tr>
          </thead>
          <tbody>
            {impact.byPhase.map(p => (
              <tr key={p.phase} className="block md:table-row border-b border-black/[0.03] py-2 md:py-0">
                <th scope="row" className="block md:table-cell px-2 py-0.5 md:py-2 text-left font-medium text-v2-text-primary">{p.phase}</th>
                <td className="block md:table-cell px-2 py-0.5 md:py-2 md:text-right tabular-nums text-v2-text-secondary">
                  <span className="md:hidden text-v2-text-muted">失败次数：</span>{p.failures} 次
                </td>
                <td className="block md:table-cell px-2 py-0.5 md:py-2 md:text-right tabular-nums text-v2-text-secondary">
                  <span className="md:hidden text-v2-text-muted">影响用户：</span>
                  {/* 0 人 + 全是无归属 ⇒ 说「无法归因到人」，绝不显 0 冒充「没影响人」 */}
                  {p.affectedUsers === 0 && p.unattributed > 0
                    ? <span className="text-v2-text-muted">无法归因到人</span>
                    : <>{p.affectedUsers} 人</>}
                </td>
                <td className="block md:table-cell px-2 py-0.5 md:py-2 md:text-right tabular-nums text-v2-text-secondary">
                  <span className="md:hidden text-v2-text-muted">其中无归属：</span>{p.unattributed} 次
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="text-[0.6875rem] text-v2-text-secondary mt-2">
          本期系统故障 <span className="tabular-nums font-medium text-v2-text-primary">{impact.totalFailures}</span> 次 ·
          跨环节去重后波及 <span className="tabular-nums font-medium text-v2-text-primary">{impact.totalAffectedUsers}</span> 人
        </div>
      </>)}

      <div className="text-[0.625rem] text-v2-text-muted leading-relaxed mt-2">
        各行的影响用户【不可相加】：同一个人可能在多个环节踩到故障，总数是跨环节重新去重的。
        「无归属」= 失败行上没有 user_id（无归属调用 / 补归属列之前的老行），它计入失败次数、不计入影响用户；
        这一列很大时，影响用户那一列不可当成真实影响面。匿名用户按 user_id 去重 = 去重身份、不是去重真人。
      </div>
    </section>
  )
}
