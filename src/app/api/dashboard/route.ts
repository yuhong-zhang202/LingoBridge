/**
 * @module   api/dashboard
 * @desc     GET /api/dashboard?range=7d|14d|30d — 聚合 api_usage_logs，返回看板所需全部统计
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin, authErrorResponse } from '@/lib/api-auth'

const SERVICE_META: Record<string, { name: string; color: string }> = {
  doubao_asr:    { name: '豆包 ASR',      color: '#D4875A' },
  qwen_flash:    { name: '千问 Qwen',     color: '#7BA699' },
  qwen_plus:     { name: '千问 Plus',     color: '#6FA8C8' },
}

// 环节（phase）中文名：各 route 在 metadata.phase 打的标签。无 phase 的行（如 transcribe）归入 other。
const PHASE_META: Record<string, string> = {
  extraction:  '观察点萃取',
  ranking:     '题目重排',
  analysis:    '侧重点分析',
  coach:       '教练对话',
  phrases:     '词组生成',
  pronounce:   '发音提示',
  restructure: '语料整理',
  polish:      '单句润色',
  other:       '其他（含语音转写）',
}

// 部署形态：Vercel + 香港节点。DB 存 UTC，"今日"/日界/小时桶一律按东八区（UTC+8，无夏令时）折算，
// 否则香港用户看到的"今日"和"小时分布"会错位 8 小时。
const HK_OFFSET_MS = 8 * 60 * 60 * 1000

// 预算目标线（内测占位常量，非告警阈值）：趋势图画一条日预算线、超了染红。
// 告警推送是上线前的事，本轮不做。内测阶段先按此值做视觉参照。
const DAILY_BUDGET_CNY = 20

/** 保留两位小数 */
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 计算一组数值的第 p 百分位（线性插值，nearest-rank 的连续版）。
 * 用于成功调用延迟 p95：均值会被长尾拉平，p95 才暴露"偶发慢请求"。
 * @param values  数值数组（无需预排序）
 * @param p       百分位（0–100）
 * @returns       该百分位值；空数组返回 0，四舍五入到整数毫秒
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return Math.round(sorted[0])
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  const frac = rank - lo
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * frac)
}

/** 最贵调用视图取前 N 条 */
const TOP_COST_N = 20

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

/** api_usage_logs 行的最小读取形状（metadata 为 jsonb，只取本看板用到的两键） */
type LogMeta = { phase?: string; cost_source?: string } | null
type RangeRow = {
  service: string; estimated_cost_cny: number; latency_ms: number
  status: string; created_at: string; metadata: LogMeta
}
type RecentRow = {
  id: string; created_at: string; service: string; endpoint: string
  usage_amount: number; usage_unit: string; estimated_cost_cny: number
  latency_ms: number; status: string; metadata: LogMeta
}

/** 把某一 UTC 时刻按东八区折算，返回该日 0 点对应的 UTC 时刻（供日界/月界计算） */
function hkDayStartUtc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d) - HK_OFFSET_MS)
}

/** 取某 ISO 时刻在东八区的「年-月-日」桶键（月为 0-based，只用于分桶不展示） */
function hkDayKey(iso: string): string {
  const hk = new Date(new Date(iso).getTime() + HK_OFFSET_MS)
  return `${hk.getUTCFullYear()}-${hk.getUTCMonth()}-${hk.getUTCDate()}`
}

/**
 * 聚合 api_usage_logs，返回看板所需全部统计数据
 * @param req  GET 请求，支持 ?range=7d|14d|30d
 * @returns    三张费用卡、迷你统计、服务分组、按环节成本、每日趋势、小时分布、最近调用
 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    // 成本看板暴露全平台 API 花费，仅管理员白名单可读
    await requireAdmin(req)
    const { searchParams } = new URL(req.url)
    const rangeDays = parseRange(searchParams.get('range'))
    const now = new Date()
    // service_role 读 api_usage_logs：0012 已开 RLS 且不给 authenticated 加 select 策略，
    // 成本数据仅 service_role 可读（绕 RLS）；接口本身由 requireAdmin 挡非 admin 访问。
    const supabase = getSupabaseServer()

    // ── 时间边界（按东八区折算日界/月界，落到 UTC 时刻供 DB 过滤） ──
    const nowHk = new Date(now.getTime() + HK_OFFSET_MS)   // UTC 字段 = 香港墙上时钟
    const todayStart     = hkDayStartUtc(nowHk.getUTCFullYear(), nowHk.getUTCMonth(), nowHk.getUTCDate())
    const monthStart     = hkDayStartUtc(nowHk.getUTCFullYear(), nowHk.getUTCMonth(), 1)
    const lastMonthStart = hkDayStartUtc(nowHk.getUTCFullYear(), nowHk.getUTCMonth() - 1, 1)
    const rangeStartDate = new Date(todayStart.getTime() - (rangeDays - 1) * 24 * 60 * 60 * 1000)

    // ── 7 条并行查询 ──
    const [allTimeRes, monthRes, lastMonthRes, todayRes, rangeRes, recentRes, costlyRes] = await Promise.all([
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
        .select('service, estimated_cost_cny, latency_ms, status, created_at, metadata')
        .gte('created_at', rangeStartDate.toISOString()),
      supabase
        .from('api_usage_logs')
        .select('id, created_at, service, endpoint, usage_amount, usage_unit, estimated_cost_cny, latency_ms, status, metadata')
        .order('created_at', { ascending: false })
        .limit(30),
      // 最贵 Top-N（全时段按成本降序）：时间序的"最近调用"抓不到某次异常昂贵，需独立按成本排。
      supabase
        .from('api_usage_logs')
        .select('id, created_at, service, endpoint, usage_amount, usage_unit, estimated_cost_cny, latency_ms, status, metadata')
        .order('estimated_cost_cny', { ascending: false })
        .limit(TOP_COST_N),
    ])

    const firstErr = allTimeRes.error ?? monthRes.error ?? lastMonthRes.error
      ?? todayRes.error ?? rangeRes.error ?? recentRes.error ?? costlyRes.error
    if (firstErr) {
      return NextResponse.json({ error: firstErr.message }, { status: 500 })
    }

    const allRows = allTimeRes.data  ?? []
    const mRows   = monthRes.data    ?? []
    const lmRows  = lastMonthRes.data ?? []
    const tdRows  = todayRes.data    ?? []
    const rngRows = (rangeRes.data  ?? []) as RangeRow[]
    const recent  = (recentRes.data ?? []) as RecentRow[]
    const costly  = (costlyRes.data ?? []) as RecentRow[]

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
    // p95 延迟：均值藏长尾，p95 才暴露偶发慢请求。只算成功调用（失败常瞬时返回，混入会拉低）。
    const p95Latency    = percentile(successRows.map(r => r.latency_ms), 95)
    const errorRate     = rngRows.length > 0
      ? r2(rngRows.filter(r => r.status === 'error').length / rngRows.length * 100)
      : 0
    const rangeCost     = rngRows.reduce((s, r) => s + r.estimated_cost_cny, 0)
    const avgDailyCost  = r2(rangeCost / rangeDays)
    // 失败成本（白烧）：状态为 error 的调用仍可能已消耗 token（如 ranking 失败前已产出部分输出）。
    // 汇总一个总额，配合按环节失败率定位"钱花了但没拿到结果"的环节。
    const failedCost    = r2(rngRows.filter(r => r.status === 'error').reduce((s, r) => s + r.estimated_cost_cny, 0))

    // ── 估算占比（本期成本 X% 为估算）：cost_source='estimate' 的成本 ÷ 本期总成本 ──
    // 缺 cost_source 的行（如 transcribe，按真实时长计）不计入估算，避免高估估算占比。
    const estimateCost = rngRows
      .filter(r => r.metadata?.cost_source === 'estimate')
      .reduce((s, r) => s + r.estimated_cost_cny, 0)
    const estimateRatio = rangeCost > 0 ? r2(estimateCost / rangeCost * 100) : 0

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

    // ── 按环节成本 + 按环节失败率（哪个环节最贵 / 哪个环节在失败）：按 metadata.phase 聚合，降序 ──
    // errors/errorCost 让"部分失败白烧"在 phase 级可见：如 matching 中 extraction 成功记账后 ranking 失败，
    // extraction 有成本、error 行落在对应 phase（无 phase 的失败归 other），错误率一眼可辨是哪环节在漏。
    const phaseMap = new Map<string, { cost: number; calls: number; errors: number; errorCost: number }>()
    for (const row of rngRows) {
      const key = row.metadata?.phase ?? 'other'
      const cur = phaseMap.get(key) ?? { cost: 0, calls: 0, errors: 0, errorCost: 0 }
      cur.cost += row.estimated_cost_cny
      cur.calls += 1
      if (row.status === 'error') {
        cur.errors += 1
        cur.errorCost += row.estimated_cost_cny
      }
      phaseMap.set(key, cur)
    }
    const phaseTotals = Array.from(phaseMap.entries())
      .map(([phase, v]) => ({
        phase,
        name:      PHASE_META[phase] ?? phase,
        cost:      r2(v.cost),
        calls:     v.calls,
        errors:    v.errors,
        errorCost: r2(v.errorCost),
        errorRate: v.calls > 0 ? r2(v.errors / v.calls * 100) : 0,
      }))
      .sort((a, b) => b.cost - a.cost)

    // ── 每日趋势（rangeDays 天，升序，按东八区分桶） ──
    const dailyMap = new Map<string, Record<string, number>>()
    for (const row of rngRows) {
      const key = hkDayKey(row.created_at)
      if (!dailyMap.has(key)) dailyMap.set(key, {})
      const entry = dailyMap.get(key)!
      entry[row.service] = (entry[row.service] ?? 0) + row.estimated_cost_cny
      entry['total']     = (entry['total']     ?? 0) + row.estimated_cost_cny
    }
    const dailyData = Array.from({ length: rangeDays }, (_, i) => {
      const dayStart = new Date(rangeStartDate.getTime() + i * 24 * 60 * 60 * 1000)
      const hk  = new Date(dayStart.getTime() + HK_OFFSET_MS)
      const key = `${hk.getUTCFullYear()}-${hk.getUTCMonth()}-${hk.getUTCDate()}`
      const entry = dailyMap.get(key) ?? {}
      return {
        date:          `${hk.getUTCMonth() + 1}/${hk.getUTCDate()}`,
        doubao_asr:    r2(entry['doubao_asr']    ?? 0),
        qwen_flash:    r2(entry['qwen_flash']    ?? 0),
        qwen_plus:     r2(entry['qwen_plus']     ?? 0),
        total:         r2(entry['total']         ?? 0),
      }
    })

    // ── 今日小时分布（从 rngRows 中筛 today，按东八区取小时桶） ──
    const todayTs  = todayStart.getTime()
    const hourlyMap = new Map<number, number>()
    for (const row of rngRows) {
      if (new Date(row.created_at).getTime() < todayTs) continue
      const h = new Date(new Date(row.created_at).getTime() + HK_OFFSET_MS).getUTCHours()
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
      p95Latency,
      errorRate,
      avgDailyCost,
      failedCost,
      estimateRatio,
      dailyBudget: DAILY_BUDGET_CNY,
      serviceTotals,
      phaseTotals,
      dailyData,
      hourlyData,
      recentLogs: recent,
      costlyLogs: costly,
    })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[dashboard API]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : '查询失败' }, { status: 500 })
  }
}
