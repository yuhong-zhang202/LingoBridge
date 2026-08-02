'use client'
/**
 * @module   dashboard/DailyFailureChart
 * @desc     「每日失败次数」柱图 —— 只数系统故障（与顶部错误率同口径），
 *           把散在明细表里的几条失败聚成一根扎眼的高柱，"哪天真的坏了"一眼可见。
 * @author   LingoBridge
 * @created  2026-07-20
 */
import { BarChart, Bar, XAxis, LabelList, ResponsiveContainer, Cell } from 'recharts'

// 坐标轴刻度色：recharts 的 tick fill 只吃色值、吃不了 Tailwind class，故硬编码 v2-text-muted 值。
const AXIS_TICK_FILL = '#7C6B5E'

// 失败色 = error token（#AB5344）。0 失败的日子压到极低透明度，只留"这天有记录"的底噪。
const FAIL_COLOR = '#AB5344'

type DayFailure = { date: string; failures: number }

/**
 * 每日失败次数柱图
 * @param data  区间内每日系统故障次数（与费用趋势同一日期轴）
 */
export default function DailyFailureChart({ data }: { data: DayFailure[] }) {
  const total = data.reduce((s, d) => s + d.failures, 0)
  const peak  = data.reduce((m, d) => (d.failures > m.failures ? d : m), data[0] ?? { date: '', failures: 0 })
  return (
    <div>
      {/* 状态不只靠颜色：总数与峰值日以文字/数字承载，柱上另标数字（见 LabelList） */}
      <div className="text-[0.6875rem] text-v2-text-secondary mb-2">
        {total === 0
          ? <span>本期无失败</span>
          : <span>本期共 <span className="font-semibold text-error tabular-nums">{total}</span> 次失败，峰值 {peak.date} <span className="tabular-nums">{peak.failures}</span> 次</span>}
      </div>
      <div role="img"
        aria-label={`每日失败次数柱状图，共 ${data.length} 天，合计 ${total} 次系统故障${total > 0 ? `，峰值 ${peak.date} 共 ${peak.failures} 次` : ''}。详细数据见下方数据表。`}>
        <ResponsiveContainer width="100%" height={100}>
          <BarChart data={data} barSize={10} margin={{ top: 12, right: 0, bottom: 0, left: -16 }}>
            <XAxis dataKey="date" tick={{ fontSize: '0.5625rem', fill: AXIS_TICK_FILL }} tickLine={false} axisLine={false} />
            <Bar dataKey="failures" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={FAIL_COLOR} fillOpacity={d.failures > 0 ? 0.75 : 0.12} />
              ))}
              {/* 柱上标数字：仅 >0 时显示，0 的日子标一片"0"只会变成噪音 */}
              <LabelList dataKey="failures" position="top" fontSize="0.5625rem" fill={FAIL_COLOR}
                formatter={(v: unknown) => (Number(v) > 0 ? String(v) : '')} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* 读屏兜底数据表：同页另两张图都有，这里缺了就是破坏本项目自己的标准 */}
      <table className="sr-only">
        <caption>每日失败次数（仅系统故障，不含用户输入问题）</caption>
        <thead>
          <tr><th scope="col">日期</th><th scope="col">失败次数</th></tr>
        </thead>
        <tbody>
          {data.map(d => (
            <tr key={d.date}><th scope="row">{d.date}</th><td>{d.failures}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
