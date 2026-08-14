'use client'
/**
 * @module   dashboard/GrowthFunnelTable
 * @desc     「用户走到哪」区的七步主线漏斗（0064 口径）—— 七行表，四列：
 *           步骤 / 人数 / 较上一步 / 口径·来源。
 *
 *   【为什么是表、不是按数值递减宽度的漏斗条】沿用 GrowthFunnel 顶注里产品方拍板（勿改）的
 *   既有决定：低门槛的步骤可能反超前一步，递减条会误导。本漏斗七步来自五张不同的表/事件，
 *   **不是严格嵌套的集合链**，反超属正常。
 *
 *   🔴【跨源时照显真实转化率，不打「—」】产品方拍板：他自己知道怎么读，不要被 UI 挡住。
 *   所以六条边全部显真实数字（含 327.6% 这类 >100% 的）。告警由两处承担、缺一不可：
 *     ① 每一行的「口径·来源」列贴【偏低】两字 —— 只写在横幅里不够：读者会把横幅读成
 *        「数据不全」，而这里的偏差【方向是确定的】（同 CohortReturnTable 的 TruncatedNotice
 *        为什么必须说方向）；
 *     ② 表上方的跨界横幅，说清埋点起算日与本窗口只有几天有埋点。
 *   横幅**不用 text-error**：跨源不是故障，红色在本项目语义是「该我们改代码」
 *   （色彩契约见 FlowHealthBlocks 的 ATTRIBUTION_META）。
 *
 *   🔴【跨界时不评选「最大掉队」】biggestDropIndex 是拿全部相邻级比出来的，跨源那几级的差值
 *   混着口径缺口，选出来的「最大掉队」可能只是埋点少了 18 天。跨界时改为在【相邻两步同源】
 *   的那些级里选，并把话说成「本窗口唯一可比的一级」。
 *
 * @author   LingoBridge
 * @created  2026-08-15
 */
import type { ReactNode } from 'react'
import Tag from '@/components/Tag'
import type { FunnelStep, GrowthState, GrowthFunnelResponse } from '@/hooks/useGrowthMetrics'

/**
 * 步号的圈号（① ~ ⑦）：比裸数字更容易在「第 N 步」的口语里对上号。
 * 下标 0 留空占位 —— FunnelStep.index 是 1-based（与 0064 的 step_index 一致），直接用它取值。
 */
const CIRCLED = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦']

/**
 * source==='table' 时该步读的是哪张表（**只用于显示**）。
 * ⚠️ 刻意【不】在这里再写一份 step→source 的映射（那份的唯一真源在服务端 FUNNEL_STEP_SOURCE，
 *    UI 自抄一份会各自漂移且不报错）。这里只在后端已经说了「这步是 table」之后，补一个人话表名；
 *    某步将来改成埋点，后端的 source 会变、本表名不会被用到，回落也只是更泛的「数据表」。
 */
const TABLE_NAME: Record<string, string> = {
  signup:           '注册表',
  corpus_built:     '语料表',
  practice_started: '练习表',
}

/** 挂在特定步骤上的口径小字（这两条不写出来，这两个数一定会被误读） */
const STEP_NOTE: Record<string, string> = {
  signup:        '建号 ≈ 全新访客近似，非精确 UV',
  feedback_card: '只记主动点结束，关标签页不上报，此数偏低',
}

/**
 * 「较上一步」列的副行文案。
 * 【为什么把「流失 -66 人」改写成「反超 +66 人」】双重否定读一次就要在脑子里翻一次符号；
 * 且反超不是故障（口径缺口所致，见 deriveFunnel 顶注），故用 muted、不用警示色。
 * @param lost  相对上一步流失的人数（负数 = 反超）
 * @returns     人话副行
 */
function lostText(lost: number): string {
  if (lost > 0) return `流失 ${lost} 人`
  if (lost < 0) return `反超 +${-lost} 人`
  return '与上一步持平'
}

/**
 * 一步的「口径·来源」文案。跨界时给埋点步贴上【偏低】——每一行都要有，不能只写在横幅里。
 * @param step            该步
 * @param crossesBaseline 本窗口是否跨过埋点起算日
 * @param effectiveDays   窗口内真正有埋点数据的天数
 * @param totalDays       窗口总天数
 * @returns               口径串
 */
function sourceText(step: FunnelStep, crossesBaseline: boolean, effectiveDays: number, totalDays: number): string {
  if (step.source === 'table') return `${TABLE_NAME[step.key] ?? '数据表'} · 全窗口 ${totalDays} 天`
  if (crossesBaseline) return `埋点 · ${effectiveDays}/${totalDays} 天 · 偏低`
  return `埋点 · 全窗口 ${totalDays} 天`
}

/** 相邻两级（前一步 → 后一步），用于「掉队最多」的评选 */
type Level = { from: FunnelStep; to: FunnelStep }

/**
 * 在给定的级里挑掉人最多的一级（只看真的掉了人的级；并列取靠前那一级，理由同 deriveFunnel）。
 * @param levels  候选级
 * @returns       掉最多的一级；没有任何一级掉人时 null
 */
function pickBiggestDrop(levels: readonly Level[]): Level | null {
  let best: Level | null = null
  let bestLost = 0
  for (const lv of levels) {
    const lost = lv.to.lostFromPrev ?? 0
    if (lost > bestLost) { bestLost = lost; best = lv }
  }
  return best
}

/**
 * 一级的人话描述：「④ 匹配到题 → ⑤ 打开题目，掉 56 人（26.3%）」。
 * 掉幅百分比 = 100 - 相邻转化率（除零时 convFromPrev 为 null，此时只说人数）。
 * @param lv  相邻两级
 * @returns   描述串
 */
function levelText(lv: Level): string {
  const lost = lv.to.lostFromPrev ?? 0
  const pct = lv.to.convFromPrev === null ? null : (100 - lv.to.convFromPrev).toFixed(1)
  const head = `${CIRCLED[lv.from.index]} ${lv.from.label} → ${CIRCLED[lv.to.index]} ${lv.to.label}`
  return pct === null ? `${head}，掉 ${lost} 人` : `${head}，掉 ${lost} 人（${pct}%）`
}

/** 表头单元格（移动端整个 thead 收起，口径由每格自带的行内标签承担） */
function Th({ children, align }: { children: string; align: 'left' | 'right' }) {
  return (
    <th scope="col"
      className={`px-2 py-1.5 font-medium text-v2-text-muted ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

/**
 * 数据格：移动端塌陷成堆叠块（不做横向滚动表——手机上横滚会把最右边的「口径」列滚出屏幕，
 * 而口径正是这张表的重点）。移动端用行内小标签补出列名。
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

/**
 * 七步主线漏斗表
 * @param state  /api/dashboard/growth/funnel 的三态（父层拉一次，见 useGrowthMetrics 顶注）
 */
export default function GrowthFunnelTable({ state }: { state: GrowthState<GrowthFunnelResponse> }) {
  const res = state.data
  const funnel = res?.funnel ?? null
  const base = res?.flowBaseline ?? null

  const steps = funnel?.steps ?? []
  const flowSteps = steps.filter(s => s.source === 'flow').length
  const tableSteps = steps.length - flowSteps

  // 相邻级：跨界时只在「两步同源」的级里评选，不跨界时全部级都可比
  const levels: Level[] = steps.slice(1).map((to, i) => ({ from: steps[i], to }))
  const comparable = base?.crossesBaseline === true
    ? levels.filter(lv => lv.from.source === lv.to.source)
    : levels
  const dropByIndex = funnel?.biggestDropIndex ?? null
  const highlight = base?.crossesBaseline === true
    ? pickBiggestDrop(comparable)
    : (levels.find(lv => lv.to.index === dropByIndex) ?? null)

  return (
    <section aria-label="七步主线漏斗" className="bg-white rounded-[16px] border border-black/[0.05] p-4">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">用户走到哪一步</h2>
        <span className="text-[0.6875rem] text-v2-text-muted">七步主线 · 已剔内部账户与自测</span>
      </div>

      {state.loading && !res && (
        <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">加载中…</div>
      )}
      {state.error && (
        <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">漏斗数据暂时读取失败，刷新页面重试。</div>
      )}
      {res?.funnelPending === true && (
        <div className="text-v2-text-muted text-[0.75rem] py-4 leading-relaxed">
          七步漏斗 RPC（get_growth_funnel）尚未接入，待部署方跑迁移 0064 后自动显示真实数据。
        </div>
      )}

      {funnel && base && (<>
        {/* 跨界横幅：首屏同步内容，刻意不加 role="alert" / aria-live（它不是刚发生的事，
            也不是故障——红与打断都不该用在这里）。 */}
        {base.crossesBaseline && (
          <div className="bg-black/[0.02] rounded-[12px] px-3 py-2 mb-3">
            <p className="text-[0.6875rem] text-v2-text-secondary leading-relaxed">
              埋点自 {base.baselineStart} 起统计，本窗口 {base.windowTotalDays} 天里只有 {base.effectiveDays} 天有埋点；
              标「埋点」的 {flowSteps} 步系统性偏低，与标「表」的 {tableSteps} 步不可相减。
            </p>
          </div>
        )}

        <table className="w-full text-[0.6875rem]">
          <caption className="text-left text-[0.625rem] text-v2-text-muted pb-2 leading-relaxed">
            七步主线漏斗 · 已剔除内部账户与自测流量 · 窗口为闭区间 {base.windowTotalDays} 天。
            与下方「旧 4 段漏斗」【不同源】（那批不剔内部账户与自测），两边的人数不可相减、不可对比。
          </caption>
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-black/[0.04]">
              <Th align="left">步骤</Th>
              <Th align="right">人数</Th>
              <Th align="right">较上一步</Th>
              <Th align="left">口径·来源</Th>
            </tr>
          </thead>
          <tbody>
            {steps.map(s => (
              <tr key={s.key} className="block md:table-row border-b border-black/[0.03] py-2 md:py-0">
                <th scope="row" className="block md:table-cell px-2 py-0.5 md:py-2 text-left font-normal text-v2-text-secondary align-top">
                  <span className="text-v2-text-primary font-medium">{CIRCLED[s.index]} {s.label}</span>
                  {STEP_NOTE[s.key] && (
                    <span className="block text-[0.625rem] text-v2-text-muted leading-relaxed mt-0.5">{STEP_NOTE[s.key]}</span>
                  )}
                </th>
                <Td label="人数" align="right">
                  <span className="text-v2-text-primary font-medium">{s.users}</span> 人
                </Td>
                {/* 🔴 跨源也照显真实数字（产品方拍板）：这里没有任何「—」分支 */}
                <Td label="较上一步" align="right">
                  {s.convFromPrev === null
                    ? <span className="text-v2-text-muted">起点</span>
                    : (<>
                        <span className="text-v2-text-primary font-medium">{s.convFromPrev}%</span>
                        <span className="text-v2-text-muted"> · {lostText(s.lostFromPrev ?? 0)}</span>
                      </>)}
                </Td>
                <Td label="口径·来源" align="left">
                  <span className="text-v2-text-muted">{sourceText(s, base.crossesBaseline, base.effectiveDays, base.windowTotalDays)}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 掉队最多的一级：用 gray Tag 而不是 error 色 —— 红在本项目语义是「该我们改代码」，
            用户按自己的意愿走掉不是 bug。 */}
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <Tag variant="gray" label={base.crossesBaseline
            ? (comparable.length === 1 ? '本窗口唯一可比的一级' : '本窗口可比的一级中掉得最多')
            : '掉队最多的一级'} />
          <span className="text-[0.6875rem] text-v2-text-secondary">
            {highlight
              ? levelText(highlight)
              : (base.crossesBaseline && comparable.length === 0
                  ? '本窗口没有任何一级是相邻两步同源的，跨源差值不作数'
                  : '本期没有任何一级出现正向流失')}
          </span>
        </div>

        <div className="text-[0.625rem] text-v2-text-muted mt-2 leading-relaxed">
          「流失 / 反超」由相邻两级的人数差值推断、非直接观测：七步来自五张不同的表与事件，
          不是严格嵌套的集合链，出现反超属口径信号而非错数。
        </div>
      </>)}
    </section>
  )
}
