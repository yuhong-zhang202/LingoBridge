'use client'
/**
 * @module   dashboard/CostBreakdown
 * @desc     按服务费用占比的环形饼图 + 可点击图例（recharts PieChart）
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

type ServiceTotal = { service: string; name: string; color: string; cost: number; calls: number }
type Props = { totals: ServiceTotal[]; selected: string | null; onSelect: (s: string | null) => void }

/**
 * 环形占比图 + 可点击图例，点击切换筛选服务
 * @param totals    按服务聚合的费用数组
 * @param selected  当前选中的服务 key（null = 全选）
 * @param onSelect  切换筛选回调
 */
export default function CostBreakdown({ totals, selected, onSelect }: Props) {
  const total = totals.reduce((s, t) => s + t.cost, 0)

  return (
    <div className="flex flex-col h-full">
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie
            data={totals} dataKey="cost" nameKey="service"
            innerRadius={42} outerRadius={68} paddingAngle={3}
            onClick={(d: unknown) => {
              const svc = (d as ServiceTotal).service
              onSelect(selected === svc ? null : svc)
            }}
          >
            {totals.map(t => (
              <Cell key={t.service} fill={t.color}
                opacity={!selected || selected === t.service ? 1 : 0.3}
                style={{ cursor: 'pointer' }}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {/* 可点击图例 */}
      <div className="mt-2 space-y-1.5">
        {totals.map(t => (
          <button key={t.service}
            onClick={() => onSelect(selected === t.service ? null : t.service)}
            className={`w-full flex items-center gap-2 text-left transition-opacity ${selected && selected !== t.service ? 'opacity-40' : ''}`}
          >
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.color }} />
            <span className="text-[11px] text-v2-text-secondary flex-1 truncate">{t.name}</span>
            <span className="text-[11px] font-medium text-v2-text-primary">¥{t.cost.toFixed(4)}</span>
          </button>
        ))}
        {total > 0 && (
          <div className="text-[10px] text-v2-text-muted text-center pt-1">合计 ¥{total.toFixed(4)}</div>
        )}
      </div>
    </div>
  )
}
