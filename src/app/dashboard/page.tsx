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
type PhaseTotal   = { phase: string; name: string; cost: number; calls: number }
type RecentLog = {
  id: string; created_at: string; service: string; endpoint: string
  usage_amount: number; usage_unit: string; estimated_cost_cny: number; latency_ms: number; status: string
  metadata?: { phase?: string; cost_source?: string } | null
}
type DashboardData = {
  allTimeCost: number; allTimeCalls: number
  monthCost: number;  monthCalls: number; monthChange: number | null
  todayCost:  number; todayCalls: number
  avgDailyCalls: number; avgLatency: number; errorRate: number; avgDailyCost: number
  estimateRatio: number; dailyBudget: number
  serviceTotals: ServiceTotal[]
  phaseTotals: PhaseTotal[]
  dailyData: Array<{ date: string; doubao_asr: number; qwen_flash: number; qwen_plus: number; total: number }>
  hourlyData: Array<{ hour: string; calls: number }>
  recentLogs: RecentLog[]
}

const RANGES = ['7d', '14d', '30d'] as const
type Range = typeof RANGES[number]
const RANGE_LABEL: Record<Range, string> = { '7d': '7天', '14d': '14天', '30d': '30天' }

const MINI_STATS = (d: DashboardData) => [
  { label: '日均调用', value: d.avgDailyCalls.toFixed(1) },
  { label: '平均延迟', value: `${d.avgLatency}ms` },
  { label: '错误率',   value: `${d.errorRate}%` },
  { label: '日均费用', value: `¥${d.avgDailyCost}` },
  { label: '估算占比', value: `${d.estimateRatio}%` },
]

/**
 * 「按环节成本」视图 — 哪个环节最贵。横向条按最高成本归一化。
 * @param phases  已按成本降序的环节聚合数组
 */
function PhaseBreakdown({ phases }: { phases: PhaseTotal[] }) {
  const max = phases.reduce((m, p) => Math.max(m, p.cost), 0)
  return (
    <div className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
      <div className="text-[13px] font-semibold text-v2-text-primary mb-3">按环节成本</div>
      {phases.length === 0 ? (
        <div className="text-v2-text-muted text-[12px] py-4 text-center">本期暂无环节数据</div>
      ) : (
        <div className="space-y-2">
          {phases.map(p => (
            <div key={p.phase} className="flex items-center gap-3">
              <span className="text-[11px] text-v2-text-secondary w-24 flex-shrink-0 truncate">{p.name}</span>
              <div className="flex-1 h-2 bg-black/[0.04] rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-brand-accent/70"
                  style={{ width: `${max > 0 ? (p.cost / max) * 100 : 0}%` }} />
              </div>
              <span className="text-[11px] font-medium text-v2-text-primary w-16 text-right flex-shrink-0">¥{p.cost.toFixed(4)}</span>
              <span className="text-[10px] text-v2-text-muted w-14 text-right flex-shrink-0">{p.calls} 次</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
  // 加载失败（非鉴权）独立态：展示「加载失败，请重试」+ 重试按钮，不再留空白死胡同
  const [error, setError]               = useState(false)
  // 重试计数：递增即重新触发 useEffect 拉取
  const [reloadKey, setReloadKey]       = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(false)
    ;(async () => {
      try {
        const res = await apiFetch(`/api/dashboard?range=${range}`, { signal: ac.signal })
        if (ac.signal.aborted) return
        if (res.status === 401 || res.status === 403) { setDenied(true); setLoading(false); return }
        if (!res.ok) { setError(true); setLoading(false); return }
        const d = (await res.json()) as DashboardData
        if (ac.signal.aborted) return
        setDenied(false); setData(d); setLoading(false)
      } catch {
        if (ac.signal.aborted) return          // 中断不算错误，忽略
        setError(true); setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [range, reloadKey])

  const hasRangeData = !!data && data.dailyData.some(d => d.total > 0)
  const hasTodayData = !!data && data.hourlyData.some(h => h.calls > 0)

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-10 pt-8 pb-12">
      {/* 顶部标题 */}
      <div className="mb-6">
        <div className="text-[11px] text-v2-text-muted tracking-[1.5px] uppercase mb-1">LINGOBRIDGE</div>
        <div className="text-[22px] font-bold text-v2-text-primary">API 用量看板</div>
      </div>

      {denied && (
        <div className="text-v2-text-muted text-sm py-10 text-center">无权访问：成本看板仅对管理员开放。</div>
      )}

      {loading && !denied && <div className="text-v2-text-muted text-sm py-10 text-center">加载中…</div>}

      {error && !loading && !denied && (
        <div className="flex flex-col items-center gap-3 py-16">
          <div className="text-v2-text-secondary text-sm">加载失败，请重试</div>
          <button onClick={() => setReloadKey(k => k + 1)}
            className="px-4 py-1.5 rounded-full text-[12px] font-medium bg-v2-text-primary text-white">
            重试
          </button>
        </div>
      )}

      {data && !loading && !denied && !error && (<>
        {/* 三张费用卡 */}
        <CostCards data={data} />

        {/* 迷你统计条 */}
        <div className="bg-white rounded-[12px] border border-black/[0.05] grid grid-cols-2 md:flex md:divide-x divide-black/[0.05] mt-4 mb-5 overflow-hidden">
          {MINI_STATS(data).map(s => (
            <div key={s.label} className="flex-1 px-4 py-3 text-center border-b md:border-b-0 border-black/[0.05]">
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="md:col-span-2 bg-white rounded-[16px] border border-black/[0.05] p-4">
            {hasRangeData
              ? <CostTrendChart data={data.dailyData} selectedService={selectedService} dailyBudget={data.dailyBudget} />
              : <div className="text-v2-text-muted text-[12px] h-[180px] flex items-center justify-center">本期暂无费用数据</div>}
          </div>
          <div className="md:col-span-1 bg-white rounded-[16px] border border-black/[0.05] p-4">
            <CostBreakdown totals={data.serviceTotals} selected={selectedService} onSelect={setSelected} />
          </div>
        </div>

        {/* 按环节成本 */}
        <PhaseBreakdown phases={data.phaseTotals} />

        {/* 今日调用分布 */}
        <div className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
          <div className="text-[12px] font-medium text-v2-text-secondary mb-2">今日调用分布</div>
          {hasTodayData ? (
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
          ) : (
            <div className="text-v2-text-muted text-[12px] h-[100px] flex items-center justify-center">今日暂无调用</div>
          )}
        </div>

        {/* 最近调用表格 */}
        <RecentCallsTable logs={data.recentLogs} />

        {/* 底部单价参考 */}
        <div className="bg-white rounded-[12px] border border-black/[0.05] px-4 py-3 mt-4">
          <div className="text-[11px] text-v2-text-muted leading-relaxed">
            单价参考（估算依据）&nbsp;|&nbsp;豆包 ASR ≈ ¥0.003/秒&nbsp;|&nbsp;千问 Qwen Flash ≈ ¥0.0008/千token&nbsp;|&nbsp;千问 Plus ≈ ¥0.8/¥2.0 per M token（输入/输出）
          </div>
          <div className="text-[10px] text-v2-text-muted mt-1.5">
            * 优先按模型返回的真实 token 计费；无真实用量时回退按字数估算（记录标 cost_source=estimate）。实际账单以各平台控制台为准。
          </div>
        </div>
      </>)}
    </div>
  )
}
