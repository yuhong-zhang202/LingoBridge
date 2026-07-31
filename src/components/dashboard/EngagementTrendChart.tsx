'use client'
/**
 * @module   dashboard/EngagementTrendChart
 * @desc     每日参与度三线趋势 —— 活跃人数（注册去重）+ 练习场次 + 新增注册（真注册口径）。
 *           新增注册线为可降级项：route 迁移 0044 未跑时 newReg 整条为 null，本组件不渲染这条线
 *           （图例也不显），只保留原两条，绝不画一条全 0 / 断裂的线误导。
 *           轴 / tooltip / 图例皮肤复用 CostTrendChart，含 role=img + aria-label + sr-only 数据表（本项目图表既有标准）。
 * @author   LingoBridge
 * @created  2026-07-25
 */
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { METRIC_DEFINITION_CHANGED_AT } from '@/lib/constants'

// 坐标轴刻度色：recharts 的 tick fill 只吃色值、吃不了 Tailwind class，故硬编码 v2-text-muted 值（同 CostTrendChart）。
const AXIS_TICK_FILL = '#7C6B5E'
// 口径变更参考线色：recharts 只吃色值、吃不了 Tailwind class，故硬编码取自 v2-text-muted token（同 AXIS_TICK_FILL 模式）。
const METRIC_CHANGE_LINE = '#7C6B5E'

// 把口径变更生效日（'YYYY-MM-DD'）格式化成与 data[].date 完全相同的 x 轴键。
// ⚠️ data[].date 由 route dayBuckets 产出 `月/日`（斜杠、无前导零，如 7/31），非 '07-31'——核对过、勿假设。
const [, MC_MM, MC_DD] = METRIC_DEFINITION_CHANGED_AT.split('-')
const METRIC_CHANGE_KEY = `${Number(MC_MM)}/${Number(MC_DD)}`

// 三条线的色值均取自 DESIGN.md 调色板：活跃人数=brand-primary（暖橙）、练习场次=brand-accent（绿蓝）、
// 新增注册=band-70（品牌紫 #9A7DB8），与前两色区分明显、不自造刺眼色。
const ACTIVE_SERIES = { key: 'activeUsers',      name: '核心活跃人数', color: '#D4875A' } as const   // brand-primary
const NEWREG_SERIES = { key: 'newReg',           name: '新增注册', color: '#9A7DB8' } as const   // band-70 品牌紫
const SESSION_SERIES = { key: 'practiceSessions', name: '练习场次', color: '#7BA699' } as const   // brand-accent

type SeriesDef = { key: string; name: string; color: string }

// newReg 可缺失/为 null：route 降级态（迁移 0044 未跑）下整条为 null，本组件据此不渲染新增注册线。
type DayData = { date: string; activeUsers: number; practiceSessions: number; newReg?: number | null }
type TooltipEntry = { name: string; value: number; color: string }
type TipProps = { active?: boolean; payload?: TooltipEntry[]; label?: string; series: readonly SeriesDef[] }

/** 自定义 Tooltip：白底圆角 + 彩色圆点 + 系列名 + 数值（同 CostTrendChart 皮肤） */
function CustomTip({ active, payload, label, series }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-[12px] border border-black/[0.05] px-3 py-2 text-[11px] shadow-sm">
      <div className="text-v2-text-muted mb-1.5">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-1.5 mb-0.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-v2-text-secondary">{series.find(s => s.key === p.name)?.name ?? p.name}</span>
          <span className="font-semibold text-v2-text-primary ml-auto pl-3 tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * 每日参与度三线趋势图
 * @param data  每日「活跃人数 + 练习场次 + 新增注册」数组（与费用趋势同一日期轴）；
 *              newReg 整条为 null/缺失（route 降级态）时不渲染新增注册这条线，只画前两条
 */
export default function EngagementTrendChart({ data }: { data: DayData[] }) {
  // 新增注册线降级判定：只要有任意一天有真实注册数（非 null/undefined）就渲染这条线；
  // 全为 null（迁移 0044 未跑）则整条不画、图例也不显，避免误导成「每天 0 注册」。
  const hasNewReg = data.some(d => d.newReg != null)
  const series: readonly SeriesDef[] = hasNewReg
    ? [ACTIVE_SERIES, NEWREG_SERIES, SESSION_SERIES]
    : [ACTIVE_SERIES, SESSION_SERIES]

  const totalActive   = data.reduce((s, d) => s + d.activeUsers, 0)
  const totalSessions = data.reduce((s, d) => s + d.practiceSessions, 0)
  const totalNewReg   = data.reduce((s, d) => s + (d.newReg ?? 0), 0)
  const peakActive    = data.reduce((m, d) => (d.activeUsers > m.activeUsers ? d : m), data[0] ?? { date: '', activeUsers: 0, practiceSessions: 0 })
  const ariaNewReg    = hasNewReg ? `，新增注册合计 ${totalNewReg}` : ''
  // 口径变更参考线只在当前窗口确实覆盖到生效日那天才画（虚线对读屏不可读，文字等价物见 aria-label 末尾）。
  const showChangeLine = data.some(d => d.date === METRIC_CHANGE_KEY)
  return (
    <div>
      {/* 自带图例：移动端无 hover tooltip，靠色点+名读出每条线代表什么 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
        {series.map(s => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-[11px] text-v2-text-secondary">{s.name}</span>
          </span>
        ))}
      </div>
      {/* 图表可视区：SVG 对读屏不可读，给 role+aria-label 概述，另附下方 sr-only 数据表兜底 */}
      <div role="img"
        aria-label={`每日参与度趋势图，共 ${data.length} 天，核心活跃人数合计 ${totalActive}（峰值 ${peakActive.date} 共 ${peakActive.activeUsers} 人），练习场次合计 ${totalSessions}${ariaNewReg}。注：${METRIC_DEFINITION_CHANGED_AT} 起活跃口径放宽（AI/闪卡/收藏任一即算），此后活跃线台阶式抬升属口径变化非自然增长。详细数据见下方数据表。`}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickLine={false} axisLine={false}
              allowDecimals={false} width={32} />
            <Tooltip content={<CustomTip series={series} />} />
            {/* 口径变更竖虚线：仅当窗口覆盖到生效日那天才渲染（see showChangeLine）；读屏等价物在上方 aria-label */}
            {showChangeLine && (
              <ReferenceLine x={METRIC_CHANGE_KEY} strokeWidth={1} strokeDasharray="3 3" stroke={METRIC_CHANGE_LINE}
                label={{ value: '口径变更', position: 'top', fontSize: 9, fill: METRIC_CHANGE_LINE }} />
            )}
            {series.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color}
                strokeWidth={1.5} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* 读屏兜底数据表：视觉隐藏、屏幕阅读器可读（同页其余图表均有此表，缺了即破坏本项目标准） */}
      <table className="sr-only">
        <caption>每日参与度（活跃人数为注册去重，练习场次含新练+复练，新增注册为真注册口径）</caption>
        <thead>
          <tr>
            <th scope="col">日期</th>
            <th scope="col">核心活跃人数</th>
            <th scope="col">练习场次</th>
            {hasNewReg && <th scope="col">新增注册</th>}
          </tr>
        </thead>
        <tbody>
          {data.map(d => (
            <tr key={d.date}>
              <th scope="row">{d.date}</th>
              <td>{d.activeUsers}</td>
              <td>{d.practiceSessions}</td>
              {hasNewReg && <td>{d.newReg ?? 0}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
