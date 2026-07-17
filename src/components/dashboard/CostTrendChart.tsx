'use client'
/**
 * @module   dashboard/CostTrendChart
 * @desc     按服务堆叠的费用面积趋势图（recharts AreaChart）
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

const SERVICES = [
  { key: 'doubao_asr',    name: '豆包 ASR',      color: '#D4875A' },
  { key: 'qwen_flash',    name: '千问 Qwen',     color: '#7BA699' },
  { key: 'qwen_plus',     name: '千问 Plus',     color: '#6FA8C8' },
]

type DayData = {
  date: string; doubao_asr: number; qwen_flash: number; qwen_plus: number; total: number
}
type TooltipEntry = { name: string; value: number; color: string }
type TipProps = { active?: boolean; payload?: TooltipEntry[]; label?: string }

/** 自定义 Tooltip：白底圆角，彩色圆点 + 服务名 + 金额 */
function CustomTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-[10px] border border-black/[0.05] px-3 py-2 text-[11px] shadow-sm">
      <div className="text-v2-text-muted mb-1.5">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-1.5 mb-0.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-v2-text-secondary">{SERVICES.find(s => s.key === p.name)?.name ?? p.name}</span>
          <span className="font-semibold text-v2-text-primary ml-auto pl-3">¥{Number(p.value).toFixed(4)}</span>
        </div>
      ))}
    </div>
  )
}

/** 超预算红点：仅当该日总成本 > 预算线时在堆叠顶部（=当日总额）画一个红点，其余日返回空 */
type DotProps = { cx?: number; cy?: number; payload?: DayData }
function OverBudgetDot(budget: number) {
  return function Dot({ cx, cy, payload }: DotProps) {
    if (cx == null || cy == null || !payload || payload.total <= budget) {
      return <g />   // 未超预算：不画点（recharts dot 渲染器须返回 SVG 元素，返回空 g）
    }
    return <circle cx={cx} cy={cy} r={3} fill="#AB5344" stroke="#fff" strokeWidth={1} />
  }
}

/**
 * 堆叠面积费用趋势图
 * @param data             每日聚合数据数组
 * @param selectedService  当前筛选的服务 key（null = 全选）
 * @param dailyBudget      日预算目标线金额（画一条参照线，超线的日子在顶部染红点）
 */
export default function CostTrendChart({ data, selectedService, dailyBudget }: { data: DayData[]; selectedService: string | null; dailyBudget: number }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
        <defs>
          {SERVICES.map(s => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={s.color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.03} />
            </linearGradient>
          ))}
        </defs>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#A89990' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#A89990' }} tickLine={false} axisLine={false}
          tickFormatter={v => `¥${v}`} width={40} />
        <Tooltip content={<CustomTip />} />
        {SERVICES.map(s => (
          <Area key={s.key} type="monotone" dataKey={s.key} stackId="1"
            stroke={s.color} strokeWidth={1.5} fill={`url(#grad-${s.key})`}
            opacity={!selectedService || selectedService === s.key ? 1 : 0.2}
          />
        ))}
        {/* 日预算目标线（红色虚线）+ 超线日在总额顶部染红点。非堆叠透明面积仅用于承载红点。 */}
        <ReferenceLine y={dailyBudget} stroke="#AB5344" strokeDasharray="4 3" strokeOpacity={0.6}
          label={{ value: `预算 ¥${dailyBudget}`, position: 'insideTopRight', fontSize: 9, fill: '#AB5344' }} />
        <Area type="monotone" dataKey="total" stroke="none" fill="none" activeDot={false}
          dot={OverBudgetDot(dailyBudget)} isAnimationActive={false} legendType="none" />
      </AreaChart>
    </ResponsiveContainer>
  )
}
