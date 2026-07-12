'use client'
/**
 * @module   dashboard/page
 * @desc     API 用量看板 — 开发者工具页，不含 TabBar/TopBar，展示三方 API 费用与性能
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from 'recharts'
import CostCards     from '@/components/dashboard/CostCards'
import CostTrendChart from '@/components/dashboard/CostTrendChart'
import CostBreakdown  from '@/components/dashboard/CostBreakdown'
import RecentCallsTable from '@/components/dashboard/RecentCallsTable'
import { apiFetch } from '@/lib/api-client'

type ServiceTotal = { service: string; name: string; color: string; cost: number; calls: number }
type DashboardData = {
  allTimeCost: number; allTimeCalls: number
  monthCost: number;  monthCalls: number; monthChange: number | null
  todayCost:  number; todayCalls: number
  avgDailyCalls: number; avgLatency: number; errorRate: number; avgDailyCost: number
  serviceTotals: ServiceTotal[]
  dailyData: Array<{ date: string; doubao_asr: number; qwen_flash: number; qwen_plus: number; claude_sonnet: number; claude_haiku: number; total: number }>
  hourlyData: Array<{ hour: string; calls: number }>
  recentLogs: Array<{ id: string; created_at: string; service: string; endpoint: string; usage_amount: number; usage_unit: string; estimated_cost_cny: number; latency_ms: number; status: string }>
}

const RANGES = ['7d', '14d', '30d'] as const
type Range = typeof RANGES[number]
const RANGE_LABEL: Record<Range, string> = { '7d': '7天', '14d': '14天', '30d': '30天' }

const MINI_STATS = (d: DashboardData) => [
  { label: '日均调用', value: d.avgDailyCalls.toFixed(1) },
  { label: '平均延迟', value: `${d.avgLatency}ms` },
  { label: '错误率',   value: `${d.errorRate}%` },
  { label: '日均费用', value: `¥${d.avgDailyCost}` },
]

/**
 * API 用量看板主页
 */
export default function DashboardPage() {
  const [range, setRange]               = useState<Range>('7d')
  const [selectedService, setSelected]  = useState<string | null>(null)
  const [data, setData]                 = useState<DashboardData | null>(null)
  const [loading, setLoading]           = useState(true)
  // 成本看板仅管理员可见：API 返回 401/403 时置 denied，展示无权访问态而非空看板
  const [denied, setDenied]             = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    ;(async () => {
      try {
        const res = await apiFetch(`/api/dashboard?range=${range}`, { signal: ac.signal })
        if (ac.signal.aborted) return
        if (res.status === 401 || res.status === 403) { setDenied(true); setLoading(false); return }
        if (!res.ok) { setLoading(false); return }
        const d = (await res.json()) as DashboardData
        if (ac.signal.aborted) return
        setDenied(false); setData(d); setLoading(false)
      } catch {
        if (ac.signal.aborted) return          // 中断不算错误，忽略
        setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [range])

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '40px 40px 48px' }}>
      {/* 顶部标题 */}
      <div className="mb-6">
        <div className="text-[11px] text-v2-text-muted tracking-[1.5px] uppercase mb-1">LINGOBRIDGE</div>
        <div className="text-[22px] font-bold text-v2-text-primary">API 用量看板</div>
      </div>

      {denied && (
        <div className="text-v2-text-muted text-sm py-10 text-center">无权访问：成本看板仅对管理员开放。</div>
      )}

      {loading && !denied && <div className="text-v2-text-muted text-sm py-10 text-center">加载中…</div>}

      {data && !loading && !denied && (<>
        {/* 三张费用卡 */}
        <CostCards data={data} />

        {/* 迷你统计条 */}
        <div className="bg-white rounded-[12px] border border-black/[0.05] flex divide-x divide-black/[0.05] mt-4 mb-5">
          {MINI_STATS(data).map(s => (
            <div key={s.label} className="flex-1 px-4 py-3 text-center">
              <div className="text-[11px] text-v2-text-muted mb-0.5">{s.label}</div>
              <div className="text-[14px] font-semibold text-v2-text-primary">{s.value}</div>
            </div>
          ))}
        </div>

        {/* 时间选择器 */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[14px] font-semibold text-v2-text-primary">详细趋势</span>
          <div className="flex bg-white rounded-full border border-black/[0.05] p-0.5 gap-0.5">
            {RANGES.map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${range === r ? 'bg-v2-text-primary text-white' : 'text-v2-text-muted'}`}>
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>

        {/* 趋势图 + 饼图 */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="col-span-2 bg-white rounded-[16px] border border-black/[0.05] p-4">
            <CostTrendChart data={data.dailyData} selectedService={selectedService} />
          </div>
          <div className="col-span-1 bg-white rounded-[16px] border border-black/[0.05] p-4">
            <CostBreakdown totals={data.serviceTotals} selected={selectedService} onSelect={setSelected} />
          </div>
        </div>

        {/* 今日调用分布 */}
        <div className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
          <div className="text-[12px] font-medium text-v2-text-secondary mb-2">今日调用分布</div>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={data.hourlyData} barSize={6} margin={{ top: 0, right: 0, bottom: 0, left: -16 }}>
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#A89990' }} tickLine={false} axisLine={false} interval={3} />
              <Bar dataKey="calls" radius={[2, 2, 0, 0]}>
                {data.hourlyData.map((h, i) => (
                  <Cell key={i} fill="#7BA699" fillOpacity={h.calls > 0 ? 0.6 : 0.15} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 最近调用表格 */}
        <RecentCallsTable logs={data.recentLogs} />

        {/* 底部单价参考 */}
        <div className="bg-white rounded-[12px] border border-black/[0.05] px-4 py-3 mt-4">
          <div className="text-[11px] text-v2-text-muted leading-relaxed">
            单价参考（估算依据）&nbsp;|&nbsp;豆包 ASR ≈ ¥0.003/秒&nbsp;|&nbsp;千问 Qwen Flash ≈ ¥0.0008/千token&nbsp;|&nbsp;Claude Sonnet ≈ $3/$15 per M token&nbsp;|&nbsp;Claude Haiku ≈ $0.25/$1.25 per M token
          </div>
          <div className="text-[10px] text-v2-text-muted mt-1.5">
            * 所有费用为基于单价的估算值，实际账单以各平台控制台为准。汇率按 1 USD = 7.2 CNY 换算。
          </div>
        </div>
      </>)}
    </div>
  )
}
