'use client'
/**
 * @module   dashboard/EngagementTrendChart
 * @desc     每日参与度双线趋势 —— 活跃人数（注册去重）+ 练习场次。
 *           轴 / tooltip / 图例皮肤复用 CostTrendChart，含 role=img + aria-label + sr-only 数据表（本项目图表既有标准）。
 * @author   LingoBridge
 * @created  2026-07-25
 */
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// 坐标轴刻度色：recharts 的 tick fill 只吃色值、吃不了 Tailwind class，故硬编码 v2-text-muted 值（同 CostTrendChart）。
const AXIS_TICK_FILL = '#7C6B5E'

const SERIES = [
  { key: 'activeUsers',      name: '活跃人数',   color: '#D4875A' },   // brand-primary
  { key: 'practiceSessions', name: '练习场次',   color: '#7BA699' },   // brand-accent
] as const

type DayData = { date: string; activeUsers: number; practiceSessions: number }
type TooltipEntry = { name: string; value: number; color: string }
type TipProps = { active?: boolean; payload?: TooltipEntry[]; label?: string }

/** 自定义 Tooltip：白底圆角 + 彩色圆点 + 系列名 + 数值（同 CostTrendChart 皮肤） */
function CustomTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-[12px] border border-black/[0.05] px-3 py-2 text-[11px] shadow-sm">
      <div className="text-v2-text-muted mb-1.5">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-1.5 mb-0.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-v2-text-secondary">{SERIES.find(s => s.key === p.name)?.name ?? p.name}</span>
          <span className="font-semibold text-v2-text-primary ml-auto pl-3 tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * 每日参与度双线趋势图
 * @param data  每日「活跃人数 + 练习场次」数组（与费用趋势同一日期轴）
 */
export default function EngagementTrendChart({ data }: { data: DayData[] }) {
  const totalActive   = data.reduce((s, d) => s + d.activeUsers, 0)
  const totalSessions = data.reduce((s, d) => s + d.practiceSessions, 0)
  const peakActive    = data.reduce((m, d) => (d.activeUsers > m.activeUsers ? d : m), data[0] ?? { date: '', activeUsers: 0, practiceSessions: 0 })
  return (
    <div>
      {/* 自带图例：移动端无 hover tooltip，靠色点+名读出每条线代表什么 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
        {SERIES.map(s => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-[11px] text-v2-text-secondary">{s.name}</span>
          </span>
        ))}
      </div>
      {/* 图表可视区：SVG 对读屏不可读，给 role+aria-label 概述，另附下方 sr-only 数据表兜底 */}
      <div role="img"
        aria-label={`每日参与度双线趋势图，共 ${data.length} 天，活跃人数合计 ${totalActive}（峰值 ${peakActive.date} 共 ${peakActive.activeUsers} 人），练习场次合计 ${totalSessions}。详细数据见下方数据表。`}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickLine={false} axisLine={false}
              allowDecimals={false} width={32} />
            <Tooltip content={<CustomTip />} />
            {SERIES.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color}
                strokeWidth={1.5} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* 读屏兜底数据表：视觉隐藏、屏幕阅读器可读（同页其余图表均有此表，缺了即破坏本项目标准） */}
      <table className="sr-only">
        <caption>每日参与度（活跃人数为注册去重，练习场次含新练+复练）</caption>
        <thead>
          <tr>
            <th scope="col">日期</th>
            <th scope="col">活跃人数</th>
            <th scope="col">练习场次</th>
          </tr>
        </thead>
        <tbody>
          {data.map(d => (
            <tr key={d.date}>
              <th scope="row">{d.date}</th>
              <td>{d.activeUsers}</td>
              <td>{d.practiceSessions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
