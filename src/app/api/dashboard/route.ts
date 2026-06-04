/**
 * @module   api/dashboard
 * @desc     GET /api/dashboard?range=7d|14d|30d — 聚合 api_usage_logs，返回看板所需全部统计
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

const SERVICE_META: Record<string, { name: string; color: string }> = {
  doubao_asr:    { name: '豆包 ASR',      color: '#D4875A' },
  qwen_flash:    { name: '千问 Qwen',     color: '#7BA699' },
  claude_sonnet: { name: 'Claude Sonnet', color: '#9A7DB8' },
  claude_haiku:  { name: 'Claude Haiku',  color: '#E8B87A' },
}

/** 保留两位小数 */
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 解析 range 查询参数为天数
 * @param raw  URL 参数原始值
 * @returns    7 | 14 | 30
 */
function parseRange(raw: string | null): number {
  if (raw === '14d') return 14
  if (raw === '30d') return 30
  return 7
}

/**
 * 聚合 api_usage_logs，返回看板所需全部统计数据
 * @param req  GET 请求，支持 ?range=7d|14d|30d
 * @returns    三张费用卡、迷你统计、服务分组、每日趋势、小时分布、最近调用
 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url)
    const rangeDays = parseRange(searchParams.get('range'))
    const now = new Date()
    const supabase = getSupabase()

    // ── 时间边界（全部 UTC，避免服务端时区歧义） ──
    const todayStart    = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const monthStart    = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const rangeStartDate = new Date(todayStart)
    rangeStartDate.setUTCDate(rangeStartDate.getUTCDate() - (rangeDays - 1))

    // ── 6 条并行查询 ──
    const [allTimeRes, monthRes, lastMonthRes, todayRes, rangeRes, recentRes] = await Promise.all([
      supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny'),
      supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny')
        .gte('created_at', monthStart.toISOString()),
      supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny')
        .gte('created_at', lastMonthStart.toISOString())
        .lt('created_at', monthStart.toISOString()),
      supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny')
        .gte('created_at', todayStart.toISOString()),
      supabase
        .from('api_usage_logs')
        .select('service, estimated_cost_cny, latency_ms, status, created_at')
        .gte('created_at', rangeStartDate.toISOString()),
      supabase
        .from('api_usage_logs')
        .select('id, created_at, service, endpoint, usage_amount, usage_unit, estimated_cost_cny, latency_ms, status')
        .order('created_at', { ascending: false })
        .limit(30),
    ])

    const firstErr = allTimeRes.error ?? monthRes.error ?? lastMonthRes.error
      ?? todayRes.error ?? rangeRes.error ?? recentRes.error
    if (firstErr) {
      return NextResponse.json({ error: firstErr.message }, { status: 500 })
    }

    const allRows = allTimeRes.data  ?? []
    const mRows   = monthRes.data    ?? []
    const lmRows  = lastMonthRes.data ?? []
    const tdRows  = todayRes.data    ?? []
    const rngRows = rangeRes.data    ?? []
    const recent  = recentRes.data   ?? []

    // ── 三张费用卡 ──
    const allTimeCost   = r2(allRows.reduce((s, r) => s + r.estimated_cost_cny, 0))
    const allTimeCalls  = allRows.length
    const monthCost     = r2(mRows.reduce((s, r) => s + r.estimated_cost_cny, 0))
    const monthCalls    = mRows.length
    const lastMonthCost = lmRows.reduce((s, r) => s + r.estimated_cost_cny, 0)
    const monthChange   = lastMonthCost > 0
      ? r2((monthCost - lastMonthCost) / lastMonthCost * 100)
      : null
    const todayCost  = r2(tdRows.reduce((s, r) => s + r.estimated_cost_cny, 0))
    const todayCalls = tdRows.length

    // ── 迷你统计（基于 range 窗口） ──
    const successRows = rngRows.filter(r => r.status === 'success')
    const avgDailyCalls = r2(rngRows.length / rangeDays)
    const avgLatency    = successRows.length > 0
      ? Math.round(successRows.reduce((s, r) => s + r.latency_ms, 0) / successRows.length)
      : 0
    const errorRate     = rngRows.length > 0
      ? r2(rngRows.filter(r => r.status === 'error').length / rngRows.length * 100)
      : 0
    const avgDailyCost  = r2(rngRows.reduce((s, r) => s + r.estimated_cost_cny, 0) / rangeDays)

    // ── 按服务分组 ──
    const serviceTotals = Object.keys(SERVICE_META).map(svc => {
      const rows = rngRows.filter(r => r.service === svc)
      return {
        service: svc,
        name:    SERVICE_META[svc].name,
        color:   SERVICE_META[svc].color,
        cost:    r2(rows.reduce((s, r) => s + r.estimated_cost_cny, 0)),
        calls:   rows.length,
      }
    })

    // ── 每日趋势（rangeDays 天，升序） ──
    const dailyMap = new Map<string, Record<string, number>>()
    for (const row of rngRows) {
      const d   = new Date(row.created_at)
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
      if (!dailyMap.has(key)) dailyMap.set(key, {})
      const entry = dailyMap.get(key)!
      entry[row.service] = (entry[row.service] ?? 0) + row.estimated_cost_cny
      entry['total']     = (entry['total']     ?? 0) + row.estimated_cost_cny
    }
    const dailyData = Array.from({ length: rangeDays }, (_, i) => {
      const d = new Date(rangeStartDate)
      d.setUTCDate(d.getUTCDate() + i)
      const key   = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
      const entry = dailyMap.get(key) ?? {}
      return {
        date:          `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
        doubao_asr:    r2(entry['doubao_asr']    ?? 0),
        qwen_flash:    r2(entry['qwen_flash']    ?? 0),
        claude_sonnet: r2(entry['claude_sonnet'] ?? 0),
        claude_haiku:  r2(entry['claude_haiku']  ?? 0),
        total:         r2(entry['total']         ?? 0),
      }
    })

    // ── 今日小时分布（从 rngRows 中筛 today，无需额外查询） ──
    const todayTs  = todayStart.getTime()
    const hourlyMap = new Map<number, number>()
    for (const row of rngRows) {
      if (new Date(row.created_at).getTime() < todayTs) continue
      const h = new Date(row.created_at).getUTCHours()
      hourlyMap.set(h, (hourlyMap.get(h) ?? 0) + 1)
    }
    const hourlyData = Array.from({ length: 24 }, (_, h) => ({
      hour:  `${h}:00`,
      calls: hourlyMap.get(h) ?? 0,
    }))

    return NextResponse.json({
      allTimeCost,
      allTimeCalls,
      monthCost,
      monthCalls,
      monthChange,
      todayCost,
      todayCalls,
      avgDailyCalls,
      avgLatency,
      errorRate,
      avgDailyCost,
      serviceTotals,
      dailyData,
      hourlyData,
      recentLogs: recent,
    })
  } catch (e) {
    console.error('[dashboard API] error', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : '查询失败' }, { status: 500 })
  }
}
