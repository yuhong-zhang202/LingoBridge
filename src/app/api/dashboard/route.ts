/**
 * @module   api/dashboard
 * @desc     GET /api/dashboard?range=7d|14d|30d — 聚合 api_usage_logs，返回看板所需全部统计。
 *           聚合类查询一律经 fetchAllRows 分页拉全量，绝不裸查（PostgREST 会静默截断到 1000 行）。
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin, authErrorResponse } from '@/lib/api-auth'
import { ERROR_KIND_USER_INPUT } from '@/lib/constants'

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

// ── 分页拉取（绕开 PostgREST max-rows=1000 截断） ──
// PostgREST 对任何不带 range 的 select 强制只返回前 1000 行，且【不报错、不提示】。
// 本看板此前 5 条聚合查询全部裸查，撞上限后是【静默少报】：实测 1237 行 / ¥13.7828 被算成
// 1000 次 / ¥12.01（少 12.9%），且行数越涨少报越多、永不回正 —— 对唯一的花费仪表这是致命的。
// 修法：按 range() 逐页拉全量，Node 侧汇总口径一字不动（见 fetchAllRows）。
const PAGE_SIZE = 1000

// 分页上限（= 20 万行）：宁可截断也不让看板无限翻页把请求挂死。
// ⚠️ 触顶时【绝不静默】——置 dataTruncated 并打错误日志，因为"静默少报"正是本次修的 bug 本身。
// 触顶即意味着该换方案（把汇总下推成 DB 端 RPC / 物化日汇总表），不要简单调大这个数。
const MAX_PAGES = 200

/** 分页查询的最小响应形状（只取本文件用到的两键，避免耦合 supabase-js 内部类型） */
type QueryResponse<T> = { data: T[] | null; error: { message: string } | null }

/** 汇总结果：data 为全量行；truncated 表示撞到 MAX_PAGES 上限、数据不完整 */
type PagedResult<T> = { data: T[]; error: { message: string } | null; truncated: boolean }

/**
 * 逐页拉取一条查询的全部结果行，绕开 PostgREST 的 1000 行默认上限。
 *
 * 入参是【工厂函数】而非查询对象：PostgrestBuilder 每次 await 即发请求且不可重复使用，
 * 每页必须重新构造一条查询。调用方在工厂里务必带上稳定排序（created_at asc, id asc），
 * 否则无序分页在 OFFSET 下会漏行/重行；按 created_at 升序还能保证分页期间新写入的行
 * 一律追加在尾部，不会挤动已翻过的页。
 *
 * @param makeQuery  每次调用返回一条【新的】待执行查询（须已带 select/过滤/排序）
 * @returns          全量行 + 首个错误 + 是否因触顶而截断
 */
async function fetchAllRows<T>(
  makeQuery: () => { range: (from: number, to: number) => PromiseLike<QueryResponse<T>> },
): Promise<PagedResult<T>> {
  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1)
    if (error) return { data: [], error, truncated: false }
    const batch = data ?? []
    for (const row of batch) rows.push(row)
    // 不满一页 = 已到表尾。满页则可能还有，继续翻。
    if (batch.length < PAGE_SIZE) return { data: rows, error: null, truncated: false }
  }
  return { data: rows, error: null, truncated: true }
}

/** 最贵调用视图取前 N 条 */
const TOP_COST_N = 20

/** 按用户成本视图取前 N 名（谁烧最多在最前）：内测 200 陌生人下抓"某用户刷爆钱"的核心。 */
const TOP_USER_N = 20

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

/** api_usage_logs 行的最小读取形状（metadata 为 jsonb，只取本看板用到的三键） */
type LogMeta = { phase?: string; cost_source?: string; error_kind?: string } | null
// 全时段归因行：累计总花费卡与「按用户成本 Top-N」共用这一次全量查询，避免再开一条查询。
// user_id 是 UUID（0021 迁移补的归属列），补字段前的老行 / 无归属调用为 null。
type AttribRow = { estimated_cost_cny: number; user_id: string | null; is_anonymous: boolean | null }
/** 纯金额行：月/上月/今日三张费用卡只需成本一列 */
type CostRow = { estimated_cost_cny: number }
type RangeRow = {
  service: string; estimated_cost_cny: number; latency_ms: number
  status: string; created_at: string; metadata: LogMeta
}
type RecentRow = {
  id: string; created_at: string; service: string; endpoint: string
  usage_amount: number; usage_unit: string; estimated_cost_cny: number
  latency_ms: number; status: string; metadata: LogMeta
}

/**
 * 这条失败是不是「系统故障」（用于错误率口径）。
 *
 * status='error' 里混着两类东西，混在一起算错误率会让真实故障被噪音淹没：
 *   （注：早先注释称「历史 62.75% 几乎全是空录音」——2026-07-20 实测证伪。全表 1168 行里
 *    error 仅 66 条、全时段错误率 5.65%；62.75% 是「other」分桶数，因 error 行不写 phase、
 *    全部落进只装失败的 other 桶所致。转写失败只占 error 的 9/66，摘除空录音仅值约 2 个百分点。）
 *   · 系统故障 —— 模型报错、上游超时、我方 bug。这是错误率要盯的信号。
 *   · 用户输入问题 —— metadata.error_kind='user_input'（如没有人声的空录音）。服务本身是好的。
 * 只有【错误率】这一个口径按此过滤；失败成本 / 按环节 errorCost 一律照旧全量统计 error 行
 * （钱确实花了，产品方拍板：从错误率摘出、留在失败成本里）。
 * 历史行没有该键 → 归为系统故障，口径变化不追溯改写历史数据。
 * @param row  日志行（只用到 status 与 metadata.error_kind）
 */
function isSystemError(row: { status: string; metadata: LogMeta }): boolean {
  return row.status === 'error' && row.metadata?.error_kind !== ERROR_KIND_USER_INPUT
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
 * @returns    三张费用卡、迷你统计、服务分组、按环节成本、按用户成本 Top-N（含匿名/登录占比）、
 *             每日趋势、小时分布、最近调用
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
    // 前 5 条是【聚合类】：结果集大小随数据量无上限增长，必须分页拉全量（见 fetchAllRows）。
    // 后 2 条是【榜单类】：自带 .limit()，天然在 1000 行以内，直接查即可。
    const [allTimeRes, monthRes, lastMonthRes, todayRes, rangeRes, recentRes, costlyRes] = await Promise.all([
      // 全时段：既算累计总花费卡，又供「按用户成本 Top-N」按 user_id 归因，故一并取归属列。
      // 这条永不设时间下界、行数只增不减，是最先撞 1000 行上限、也是少报最严重的一条。
      fetchAllRows<AttribRow>(() => supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny, user_id, is_anonymous')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      fetchAllRows<CostRow>(() => supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny')
        .gte('created_at', monthStart.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      fetchAllRows<CostRow>(() => supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny')
        .gte('created_at', lastMonthStart.toISOString())
        .lt('created_at', monthStart.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      fetchAllRows<CostRow>(() => supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny')
        .gte('created_at', todayStart.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      fetchAllRows<RangeRow>(() => supabase
        .from('api_usage_logs')
        .select('service, estimated_cost_cny, latency_ms, status, created_at, metadata')
        .gte('created_at', rangeStartDate.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
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

    // 分页触顶 = 数据不完整、看板在少报。绝不静默：打日志 + 随响应返回标记。
    const dataTruncated = allTimeRes.truncated || monthRes.truncated
      || lastMonthRes.truncated || todayRes.truncated || rangeRes.truncated
    if (dataTruncated) {
      logErr('[dashboard API]', new Error(
        `api_usage_logs 分页触顶（${MAX_PAGES} 页 × ${PAGE_SIZE} 行），统计已被截断、金额偏低；该把汇总下推到 DB 端了`,
      ))
    }

    const allRows = allTimeRes.data
    const mRows   = monthRes.data
    const lmRows  = lastMonthRes.data
    const tdRows  = todayRes.data
    const rngRows = rangeRes.data
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
    // ⚠️ latency 口径断点 2026-07-20（fc0dbb8）：此前 matching 的 extraction / ranking 两条日志
    //    latency_ms 【都】写请求总耗时（同一个时长记两遍），之后才改成各自分段实测。
    //    故 range 窗口跨越 2026-07-20 时，avgLatency / p95Latency 是新旧两种口径的混合值，
    //    会显得"性能突然变好了一半"——那是口径修正，不是真的变快。历史行不追溯改写。
    const avgLatency    = successRows.length > 0
      ? Math.round(successRows.reduce((s, r) => s + r.latency_ms, 0) / successRows.length)
      : 0
    // p95 延迟：均值藏长尾，p95 才暴露偶发慢请求。只算成功调用（失败常瞬时返回，混入会拉低）。
    const p95Latency    = percentile(successRows.map(r => r.latency_ms), 95)
    // 错误率只算系统故障：用户输入问题（空录音等）不是故障，混进来会淹没真实故障信号。见 isSystemError。
    const errorRate     = rngRows.length > 0
      ? r2(rngRows.filter(isSystemError).length / rngRows.length * 100)
      : 0
    const rangeCost     = rngRows.reduce((s, r) => s + r.estimated_cost_cny, 0)
    const avgDailyCost  = r2(rangeCost / rangeDays)
    // 失败成本（白烧）：状态为 error 的调用仍可能已消耗 token（如 ranking 失败前已产出部分输出）。
    // 汇总一个总额，配合按环节失败率定位"钱花了但没拿到结果"的环节。
    // ⚠️ 口径刻意与 errorRate 不同：这里【全量】统计 error 行，用户输入问题（空录音）同样计入 ——
    //    豆包被调用过、音频被处理过，钱是真花了。摘出错误率不等于当作没花钱。
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
    // errors 与顶部 errorRate 同口径（只数系统故障），否则顶部 3% 而 other 环节 60% 会自相矛盾、没法下钻；
    // errorCost 则与 failedCost 同口径（全量 error 行），两者刻意不同 —— 一个问"哪坏了"，一个问"钱哪去了"。
    const phaseMap = new Map<string, { cost: number; calls: number; errors: number; errorCost: number }>()
    for (const row of rngRows) {
      const key = row.metadata?.phase ?? 'other'
      const cur = phaseMap.get(key) ?? { cost: 0, calls: 0, errors: 0, errorCost: 0 }
      cur.cost += row.estimated_cost_cny
      cur.calls += 1
      if (isSystemError(row)) cur.errors += 1
      if (row.status === 'error') cur.errorCost += row.estimated_cost_cny
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

    // ── 按用户成本 Top-N（谁烧最多）+ 匿名/登录成本占比 ──
    // 归因口径：按 user_id（UUID）分组累计全时段成本，降序取前 N（烧最多在最前）。
    // user_id 为空的行（补归属字段前的老行 / 无归属调用）无法归因到人，跳过分组；
    // 但匿名 vs 登录的成本占比按 is_anonymous 标记独立统计，不受 user_id 是否存在影响。
    // 隐私：只按 user_id（UUID、非邮箱/姓名）归因，刻意不 join users 表拉个人信息进成本看板。
    const userMap = new Map<string, { cost: number; calls: number; isAnonymous: boolean }>()
    let anonymousCost = 0
    let loggedInCost  = 0
    for (const row of allRows) {
      if (row.is_anonymous === true)       anonymousCost += row.estimated_cost_cny
      else if (row.is_anonymous === false) loggedInCost  += row.estimated_cost_cny
      if (row.user_id == null) continue
      const cur = userMap.get(row.user_id) ?? { cost: 0, calls: 0, isAnonymous: row.is_anonymous === true }
      cur.cost += row.estimated_cost_cny
      cur.calls += 1
      if (row.is_anonymous === true) cur.isAnonymous = true   // 同一 user_id 只要有一条匿名即标匿名
      userMap.set(row.user_id, cur)
    }
    const userTotals = Array.from(userMap.entries())
      .map(([userId, v]) => ({ userId, isAnonymous: v.isAnonymous, cost: r2(v.cost), calls: v.calls }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, TOP_USER_N)

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
      userTotals,
      anonymousCost: r2(anonymousCost),
      loggedInCost:  r2(loggedInCost),
      dailyData,
      hourlyData,
      recentLogs: recent,
      costlyLogs: costly,
      // 数据完整性标记：true = 分页触顶、以上金额均偏低，不可当作真实花费看。正常恒为 false。
      dataTruncated,
    })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[dashboard API]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : '查询失败' }, { status: 500 })
  }
}
