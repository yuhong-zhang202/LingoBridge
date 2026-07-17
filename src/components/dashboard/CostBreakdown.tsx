'use client'
/**
 * @module   dashboard/CostBreakdown
 * @desc     按服务费用占比的环形饼图 + 可点击图例（recharts PieChart）
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { formatCny } from '@/lib/format-cost'

type ServiceTotal = { service: string; name: string; color: string; cost: number; calls: number }
type Props = { totals: ServiceTotal[]; selected: string | null; onSelect: (s: string | null) => void }

/** 占比百分比（保留 1 位）；总额为 0 时返回 0，避免除零 */
function pct(cost: number, total: number): number {
  return total > 0 ? Math.round((cost / total) * 1000) / 10 : 0
}

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
      {/* SVG 饼图对读屏不可读：role+aria-label 概述占比，明细走下方 sr-only 数据表 */}
      <div role="img"
        aria-label={
          total > 0
            ? `按服务费用占比环形图，合计 ${formatCny(total)}。` +
              totals.filter(t => t.cost > 0).map(t => `${t.name} ${formatCny(t.cost)}，占 ${pct(t.cost, total)}%`).join('；') +
              '。详细数据见下方数据表。'
            : '按服务费用占比环形图，本期暂无费用数据。'
        }>
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
      </div>

      {/* 可点击图例：min-h-[44px] + py 撑起 ≥44px 触控命中区（WCAG 2.5.5），补 xx% 占比 */}
      <div className="mt-1">
        {totals.map(t => (
          <button key={t.service}
            aria-pressed={selected === t.service}
            onClick={() => onSelect(selected === t.service ? null : t.service)}
            className={`w-full flex items-center gap-2 text-left min-h-[44px] py-1.5 transition-opacity ${selected && selected !== t.service ? 'opacity-40' : ''}`}
          >
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.color }} />
            <span className="text-[11px] text-v2-text-secondary flex-1 truncate">{t.name}</span>
            <span className="text-[11px] text-v2-text-muted flex-shrink-0 tabular-nums">{pct(t.cost, total)}%</span>
            <span className="text-[11px] font-medium text-v2-text-primary flex-shrink-0 tabular-nums">{formatCny(t.cost)}</span>
          </button>
        ))}
        {total > 0 && (
          <div className="text-[10px] text-v2-text-muted text-center pt-1">合计 {formatCny(total)}</div>
        )}
      </div>

      {/* 读屏兜底数据表 */}
      <table className="sr-only">
        <caption>按服务费用占比（单位人民币元）</caption>
        <thead>
          <tr><th scope="col">服务</th><th scope="col">费用</th><th scope="col">占比</th></tr>
        </thead>
        <tbody>
          {totals.map(t => (
            <tr key={t.service}>
              <th scope="row">{t.name}</th>
              <td>{formatCny(t.cost)}</td>
              <td>{pct(t.cost, total)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
