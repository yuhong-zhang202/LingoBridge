'use client'
/**
 * @module   dashboard/PhaseLatencyPanel
 * @desc     「各环节耗时」区块，两视图切换：
 *           · 分布 —— 按 P90 归一的横条 + P50 / P90 / 最慢 / 次数（哪个环节最慢，最坏能多坏）
 *           · 趋势 —— 单个环节的每日 P50 / P90 双线（这个环节是在变慢还是在变快）
 *           刻意不给均值列：同一环节不同输入的延迟能差 3 倍，均值谁也不代表。
 * @author   LingoBridge
 * @created  2026-07-20
 */
import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// 坐标轴刻度色：recharts 的 tick fill 只吃色值、吃不了 Tailwind class，故硬编码 v2-text-muted 值。
const AXIS_TICK_FILL = '#7C6B5E'

type PhaseLatency = { phase: string; name: string; p50: number; p90: number; max: number; calls: number }
type TrendDay     = { date: string; p50: number | null; p90: number | null; calls: number }
type TrendPhase   = { phase: string; name: string; days: TrendDay[] }
type View         = 'dist' | 'trend'

/** 毫秒转秒（1 位小数）：耗时展示单位全区块统一为秒 */
function toSec(ms: number): string {
  return (ms / 1000).toFixed(1)
}

/**
 * 端到端口径脚注（静态一行，非真链路追踪 —— 那需要 trace id，数据层不支持）。
 * 内测期看这块最容易误读成"用户等了 21 秒"，实际匹配一次是两段串联、还不含网络与渲染。
 */
function Footnote() {
  return (
    <div className="text-[10px] text-v2-text-muted mt-3 leading-relaxed">
      用户实际等待为链路串联之和：匹配 ≈ 萃取 + 重排；分析与词组为独立请求。此处为单次 AI 调用耗时，不含网络与前端渲染。
    </div>
  )
}

/**
 * 分布视图：按 P90 归一的横条 + 三个分位数字。按 P90 降序（最慢在最上）。
 * @param phases       已按 P90 降序的分环节耗时
 * @param latencyWarn  P90 警示阈值（毫秒），超阈值条色转警示暖色
 */
function DistView({ phases, latencyWarn }: { phases: PhaseLatency[]; latencyWarn: number }) {
  // 横条按 P90 归一，不按 P50：这块要回答的是"最坏体验有多坏"，拿典型值归一会把长尾压平看不见。
  const max = phases.reduce((m, p) => Math.max(m, p.p90), 0)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[10px] text-v2-text-muted">
        <span className="w-24 flex-shrink-0">环节</span>
        <span className="flex-1" />
        <span className="w-12 text-right flex-shrink-0">P50</span>
        <span className="w-12 text-right flex-shrink-0">P90</span>
        <span className="w-12 text-right flex-shrink-0">最慢</span>
        <span className="w-12 text-right flex-shrink-0">次数</span>
      </div>
      {phases.map(p => (
        <div key={p.phase} className="flex items-center gap-3">
          <span className="text-[11px] text-v2-text-secondary w-24 flex-shrink-0 truncate">{p.name}</span>
          <div className="flex-1 h-2 bg-black/[0.04] rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${p.p90 > latencyWarn ? 'bg-warning/70' : 'bg-brand-accent/70'}`}
              style={{ width: `${max > 0 ? (p.p90 / max) * 100 : 0}%` }} />
          </div>
          <span className="text-[11px] text-v2-text-secondary w-12 text-right flex-shrink-0 tabular-nums">{toSec(p.p50)}s</span>
          <span className={`text-[11px] font-medium w-12 text-right flex-shrink-0 tabular-nums ${p.p90 > latencyWarn ? 'text-warning-text' : 'text-v2-text-primary'}`}>
            {toSec(p.p90)}s
          </span>
          <span className="text-[11px] text-v2-text-secondary w-12 text-right flex-shrink-0 tabular-nums">{toSec(p.max)}s</span>
          <span className="text-[10px] text-v2-text-muted w-12 text-right flex-shrink-0 tabular-nums">{p.calls}</span>
        </div>
      ))}
      {/* 读屏兜底数据表：横条与数字是 div 排版、语义上不成表，读屏用户拿不到行列关系 */}
      <table className="sr-only">
        <caption>各环节耗时分位（单位秒）</caption>
        <thead>
          <tr>
            <th scope="col">环节</th><th scope="col">P50</th><th scope="col">P90</th>
            <th scope="col">最慢</th><th scope="col">调用次数</th>
          </tr>
        </thead>
        <tbody>
          {phases.map(p => (
            <tr key={p.phase}>
              <th scope="row">{p.name}</th>
              <td>{toSec(p.p50)}</td><td>{toSec(p.p90)}</td><td>{toSec(p.max)}</td><td>{p.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type TipEntry = { name: string; value: number | null; color: string }
type TipProps = { active?: boolean; payload?: TipEntry[]; label?: string }

/** 趋势图 Tooltip：白底圆角，与 CostTrendChart 同款 */
function LatencyTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-[12px] border border-black/[0.05] px-3 py-2 text-[11px] shadow-sm">
      <div className="text-v2-text-muted mb-1.5">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-1.5 mb-0.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-v2-text-secondary">{p.name === 'p50' ? 'P50' : 'P90'}</span>
          <span className="font-semibold text-v2-text-primary ml-auto pl-3">
            {p.value == null ? '—' : `${toSec(Number(p.value))}s`}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * 趋势视图：一次只画【一个】环节的 P50 / P90 双线。
 * 环节有 9 个，全部画上去是 18 条线的线团；这里改成环节切换 + 两条线，
 * 任何时刻图上只有两条线，"典型值"与"最坏值"的差距一眼可读。
 * @param trend         最慢的前 N 个环节的每日分位序列
 * @param latencyWarn   P90 警示阈值（毫秒），用于 aria 概述措辞
 */
function TrendView({ trend, latencyWarn }: { trend: TrendPhase[]; latencyWarn: number }) {
  const [phase, setPhase] = useState(trend[0]?.phase ?? '')
  const cur  = trend.find(t => t.phase === phase) ?? trend[0]
  if (!cur) return null
  const days = cur.days
  const withData = days.filter(d => d.p90 != null)
  const peak = withData.reduce<TrendDay | null>((m, d) => (m == null || (d.p90 ?? 0) > (m.p90 ?? 0) ? d : m), null)

  return (
    <div>
      {/* 环节切换：只列最慢的几个（其余环节本来就不是耗时问题的嫌疑人） */}
      {trend.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="选择环节">
          {trend.map(t => (
            <button key={t.phase} onClick={() => setPhase(t.phase)} aria-pressed={t.phase === cur.phase}
              className={`inline-flex items-center justify-center min-h-[44px] px-3 rounded-full text-[11px] font-medium transition-colors ${
                t.phase === cur.phase ? 'bg-v2-text-primary text-white' : 'bg-black/[0.03] text-v2-text-muted'}`}>
              {t.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-brand-accent" />
          <span className="text-[11px] text-v2-text-secondary">P50（典型）</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-warning" />
          <span className="text-[11px] text-v2-text-secondary">P90（最坏）</span>
        </span>
      </div>
      {withData.length === 0 ? (
        <div className="text-v2-text-muted text-[12px] h-[180px] flex items-center justify-center">本期暂无可用耗时数据</div>
      ) : (
        <div role="img"
          aria-label={`${cur.name}环节每日耗时趋势折线图，共 ${withData.length} 天有数据，P90 峰值 ${peak?.date ?? ''} 约 ${toSec(peak?.p90 ?? 0)} 秒，警示阈值 ${toSec(latencyWarn)} 秒。详细数据见下方数据表。`}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={days} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickLine={false} axisLine={false}
                tickFormatter={v => `${Math.round(Number(v) / 1000)}s`} width={40} />
              <Tooltip content={<LatencyTip />} />
              {/* connectNulls 关闭：口径断点前的日子是 null，连起来等于伪造那几天的数据 */}
              <Line type="monotone" dataKey="p50" stroke="#7BA699" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="p90" stroke="#C4965A" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {/* 读屏兜底数据表：SVG 折线对读屏完全不可读 */}
      <table className="sr-only">
        <caption>{cur.name}环节每日耗时（单位秒）</caption>
        <thead>
          <tr><th scope="col">日期</th><th scope="col">P50</th><th scope="col">P90</th><th scope="col">调用次数</th></tr>
        </thead>
        <tbody>
          {days.map(d => (
            <tr key={d.date}>
              <th scope="row">{d.date}</th>
              <td>{d.p50 == null ? '无数据' : toSec(d.p50)}</td>
              <td>{d.p90 == null ? '无数据' : toSec(d.p90)}</td>
              <td>{d.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 各环节耗时区块（分布 / 趋势可切换）
 * @param phases        已按 P90 降序的分环节耗时
 * @param trend         最慢的前 N 个环节的每日分位序列
 * @param cutoffLabel   数据起点（延迟口径断点日期），标在标题右侧
 * @param latencyWarnMs P90 警示阈值（毫秒）
 */
export default function PhaseLatencyPanel({
  phases, trend, cutoffLabel, latencyWarnMs,
}: {
  phases: PhaseLatency[]; trend: TrendPhase[]; cutoffLabel: string; latencyWarnMs: number
}) {
  const [view, setView] = useState<View>('dist')
  return (
    <section aria-label="各环节耗时" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-semibold text-v2-text-primary">各环节耗时</h2>
          {/* 数据窗口独立于区间选择器：断点前 extraction/ranking 的 latency 是同一总时长记了两遍，
              画进来会看到"性能突然变好一半"（口径修正、非真变快），故只取断点之后 */}
          <span className="text-[10px] text-v2-text-muted">仅 {cutoffLabel} 起（此前延迟口径不同）</span>
        </div>
        <div className="flex bg-black/[0.03] rounded-full p-0.5 gap-0.5" role="group" aria-label="耗时视图">
          {(['dist', 'trend'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className={`inline-flex items-center justify-center min-h-[44px] px-3 rounded-full text-[11px] font-medium transition-colors ${
                view === v ? 'bg-white text-v2-text-primary shadow-sm' : 'text-v2-text-muted'}`}>
              {v === 'dist' ? '分布' : '趋势'}
            </button>
          ))}
        </div>
      </div>
      {phases.length === 0 ? (
        <div className="text-v2-text-muted text-[12px] py-4 text-center">{cutoffLabel} 起暂无耗时数据</div>
      ) : view === 'dist' ? (
        <DistView phases={phases} latencyWarn={latencyWarnMs} />
      ) : (
        <TrendView trend={trend} latencyWarn={latencyWarnMs} />
      )}
      <Footnote />
    </section>
  )
}
