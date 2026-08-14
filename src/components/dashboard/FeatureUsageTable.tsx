'use client'
/**
 * @module   dashboard/FeatureUsageTable
 * @desc     「用户在用什么」区的功能使用矩阵 —— 10 行三组（主线 / 沉淀 / 复习），
 *           列：功能 / 使用人数 / 使用次数 / 人均次数 / 口径。
 *
 *   【为什么按产品语义分组、不按统计状态或数值重排】位置记忆对每天看一遍的人更值钱，
 *   理由与 dashboard/page.tsx 顶注拒绝「有事的区块自动提前」是同一条。
 *
 *   🔴【不排序、不画条形】响应自带的 tabViewCaveat 原文就写着这几格「不可与其它 tab 直接比大小」；
 *   降序排列和条形长度都是在诱导比大小，等于用版式推翻口径说明。
 *
 *   🔴【起算日之前的格不显 0，写「未开始统计」】范式直接抄 CohortReturnTable 的 PendingCell
 *   （原话：绝不显 0 冒充流失）。这里的 0 若照显，第一天就会被读成「素材库没人用」。
 *   格里写的是【中文】不是「—」：破折号对读屏念作「破折号」、语义为零，而这块的全部价值
 *   就在「这个 0 是没人用还是还没开始统计」这个语义上。
 *
 *   【人均必须贴 n】人均 11.82 可能是 11 人 130 次拉出来的；不标 n 会被当成「复习功能很粘」。
 *
 * @author   LingoBridge
 * @created  2026-08-15
 */
import type { ReactNode } from 'react'
import type { FeatureUsageEntry, GrowthState, GrowthUsageResponse } from '@/hooks/useGrowthMetrics'

/** 展示分组的顺序（与服务端 FEATURE_CATALOG 的 group 取值逐字对应；缺组不显、多组回落到末尾） */
const GROUP_ORDER = ['主线', '沉淀', '复习']

/** 表头单元格（移动端整个 thead 收起，列名由每格自带的行内标签承担） */
function Th({ children, align }: { children: string; align: 'left' | 'right' }) {
  return (
    <th scope="col"
      className={`px-2 py-1.5 font-medium text-v2-text-muted ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

/**
 * 数据格：移动端塌陷成堆叠块（不做横向滚动表——手机上最右边的「口径」列会被滚出屏幕，
 * 而这一版的重点恰恰是口径）。
 * @param label     列名（移动端行内显示）
 * @param align     桌面端对齐（数字列右对齐 + tabular-nums）
 * @param children  单元格内容
 */
function Td({ label, align, children }: { label: string; align: 'left' | 'right'; children: ReactNode }) {
  return (
    <td className={`block md:table-cell px-2 py-0.5 md:py-2 ${align === 'right' ? 'md:text-right tabular-nums' : 'text-left'}`}>
      <span className="md:hidden text-v2-text-muted">{label}：</span>
      {children}
    </td>
  )
}

/** 「未开始统计」占位（可见中文 + muted，不靠颜色单独承载语义） */
function NotStartedCell() {
  return <span className="text-v2-text-muted">未开始统计</span>
}

/**
 * 一行三格（人数 / 次数 / 人均）的三态渲染。
 * @param row        矩阵行
 * @param notStarted true = 该行依赖 page.tab_view 且本窗口跨过起算日（数据不存在，不是 0）
 * @returns          三个 <Td>
 */
function UsageCells({ row, notStarted }: { row: FeatureUsageEntry; notStarted: boolean }) {
  if (notStarted) {
    return (<>
      <Td label="使用人数" align="right"><NotStartedCell /></Td>
      <Td label="使用次数" align="right"><NotStartedCell /></Td>
      <Td label="人均次数" align="right"><NotStartedCell /></Td>
    </>)
  }
  return (<>
    <Td label="使用人数" align="right">
      <span className="text-v2-text-primary font-medium">{row.users}</span> 人
    </Td>
    <Td label="使用次数" align="right">
      <span className="text-v2-text-primary font-medium">{row.uses}</span> 次
    </Td>
    <Td label="人均次数" align="right">
      {row.perUser === null
        ? <span className="text-v2-text-muted">无人使用，人均不成立</span>
        : (<>
            <span className="text-v2-text-primary font-medium">{row.perUser}</span> 次
            <span className="text-v2-text-muted">（n={row.users} 人）</span>
          </>)}
    </Td>
  </>)
}

/**
 * 功能使用矩阵
 * @param state  /api/dashboard/growth/usage 的三态（父层拉一次，见 useGrowthMetrics 顶注）
 */
export default function FeatureUsageTable({ state }: { state: GrowthState<GrowthUsageResponse> }) {
  const res = state.data
  const matrix = res?.featureUsage ?? null
  const base = res?.tabViewBaseline ?? null
  const crosses = base?.crossesBaseline === true

  // 按产品语义分组（不按统计状态、不按数值重排）；未知分组照实排到末尾，不吞掉
  const groups = matrix
    ? [...GROUP_ORDER, ...matrix.rows.map(r => r.group).filter(g => !GROUP_ORDER.includes(g))]
      .filter((g, i, arr) => arr.indexOf(g) === i)
      .map(g => ({ group: g, rows: matrix.rows.filter(r => r.group === g) }))
      .filter(g => g.rows.length > 0)
    : []

  return (
    <section aria-label="功能使用矩阵" className="bg-white rounded-[16px] border border-black/[0.05] p-4">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">哪些功能被用了</h2>
        <span className="text-[0.6875rem] text-v2-text-muted">10 项 · 已剔内部账户与自测</span>
      </div>

      {state.loading && !res && <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">加载中…</div>}
      {state.error && <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">功能使用数据暂时读取失败，刷新页面重试。</div>}
      {res?.featureUsagePending === true && (
        <div className="text-v2-text-muted text-[0.75rem] py-4 leading-relaxed">
          功能矩阵 RPC（get_feature_usage_matrix）尚未接入，待部署方跑迁移 0065 后自动显示真实数据。
        </div>
      )}

      {matrix && base && (<>
        {crosses && (
          <div className="bg-black/[0.02] rounded-[12px] px-3 py-2 mb-3">
            <p className="text-[0.6875rem] text-v2-text-secondary leading-relaxed">
              素材库四项与题库浏览依赖 tab 切换埋点，自 {base.baselineStart} 起才有数据；
              本窗口 {base.windowTotalDays} 天里只有 {base.effectiveDays} 天有埋点，故这几行显示「未开始统计」而不是 0。
            </p>
          </div>
        )}

        <table className="w-full text-[0.6875rem]">
          <caption className="text-left text-[0.625rem] text-v2-text-muted pb-2 leading-relaxed">
            功能使用矩阵 · 按产品语义分三组（主线 / 沉淀 / 复习），刻意不排序、不画条形：
            各行口径不同，比大小没有意义。人均的分母是「用过的人」，不是全部用户。
          </caption>
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-black/[0.04]">
              <Th align="left">功能</Th>
              <Th align="right">使用人数</Th>
              <Th align="right">使用次数</Th>
              <Th align="right">人均次数</Th>
              <Th align="left">口径</Th>
            </tr>
          </thead>
          {groups.map(g => (
            <tbody key={g.group}>
              <tr className="block md:table-row">
                <th scope="colgroup" colSpan={5}
                  className="block md:table-cell px-2 pt-3 pb-1 text-left text-[0.625rem] font-medium text-v2-text-muted">
                  {g.group}
                </th>
              </tr>
              {g.rows.map(row => {
                const notStarted = row.tabViewBased && crosses
                return (
                  <tr key={row.key} className="block md:table-row border-b border-black/[0.03] py-2 md:py-0">
                    <th scope="row" className="block md:table-cell px-2 py-0.5 md:py-2 text-left font-medium text-v2-text-primary align-top">
                      {row.label}
                    </th>
                    <UsageCells row={row} notStarted={notStarted} />
                    <Td label="口径" align="left">
                      <span className="text-v2-text-muted">
                        {row.tabViewBased
                          ? `自 ${base.baselineStart} 起统计`
                          : (row.users === 0 && row.uses === 0 ? '本期无人使用' : '全窗口有统计')}
                      </span>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          ))}
        </table>

        {/* 已知偏差用 <details> 折叠：summary 自己就是一句能读懂的话，且【不放进 title 属性】
            —— 语义信息放 title 触屏与键盘都够不到（教训见 FlowHealthBlocks 的 EnumChip 注释）。 */}
        <details className="mt-2">
          <summary className="cursor-pointer list-none select-none min-h-[44px] flex items-center text-[0.6875rem] font-medium text-v2-text-secondary [&::-webkit-details-marker]:hidden">
            为什么「收藏的表达」和题库那两格天生偏高 · 展开口径说明
          </summary>
          <p className="text-[0.625rem] text-v2-text-muted leading-relaxed pb-1">{matrix.tabViewCaveat}</p>
        </details>
      </>)}
    </section>
  )
}
