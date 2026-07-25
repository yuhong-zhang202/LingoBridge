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
import { ERROR_KIND_USER_INPUT, ERROR_KIND_CAPACITY } from '@/lib/constants'

const SERVICE_META: Record<string, { name: string; color: string }> = {
  doubao_asr:    { name: '豆包 ASR',      color: '#D4875A' },
  qwen_flash:    { name: '千问 Qwen',     color: '#7BA699' },
  qwen_plus:     { name: '千问 Plus',     color: '#6FA8C8' },
}

// 环节（phase）中文名：各 route 在 metadata.phase 打的标签。
// transcribe（最高频环节）自 2026-07-25 起补打 phase，其失败不再落 other 桶、可按环节归位；
// 2026-07-26 起再按客户端 scene 细分 transcribe_story（语料链路）/ transcribe_practice（练习对话轮次）；
// 裸 transcribe 保留 = 细分前的历史行 + 旧客户端缓存页面的兜底。
// matching 是 /api/matching catch 处无法判定挂在哪步时的兜底 phase，补此键避免前端显示生字符串 'matching'。
const PHASE_META: Record<string, string> = {
  extraction:  '观察点萃取',
  ranking:     '题目重排',
  matching:    '匹配',
  analysis:    '侧重点分析',
  coach:       '教练对话',
  phrases:     '词组生成',
  pronounce:   '发音提示',
  restructure: '语料整理',
  polish:      '单句润色',
  transcribe:  '语音转写',
  transcribe_story:    '语料转写',
  transcribe_practice: '练习转写',
  other:       '其他',
}

// 部署形态：Zeabur + 腾讯云香港 VPS（next start 常驻进程）。DB 存 UTC，"今日"/日界/小时桶一律按东八区（UTC+8，无夏令时）折算，
// 否则香港用户看到的"今日"和"小时分布"会错位 8 小时。
const HK_OFFSET_MS = 8 * 60 * 60 * 1000

// 预算目标线（内测占位常量，非告警阈值）：趋势图画一条日预算线、超了染红。
// 告警推送是上线前的事，本轮不做。内测阶段先按此值做视觉参照。
const DAILY_BUDGET_CNY = 20

// ── 延迟口径断点（取 UTC 2026-07-20 19:00 = 香港 07-21 03:00） ──
// 此前 matching 的 extraction / ranking 两条日志的 latency_ms 【都】写请求总耗时（同一时长记两遍），
// fc0dbb8（提交于 UTC 2026-07-20 18:40）才改成各自分段实测。跨断点画线会看到"性能突然变好一半"——
// 那是口径修正、不是真变快。按小时看 ranking 延迟：18Z 之前仍是 20s+ 旧口径高值，19Z 那批降到 10.5s
// 新口径生效，故断点钉在 UTC 07-20 19:00（原先设的 07-19 16:00 早了整整一天，把 7/20 全天混口径都算进来了）。
// 故【按环节耗时】区块（分布 + 趋势两视图）一律只取断点之后的行；历史行不追溯改写，也不参与耗时统计。
// ⚠️ 顶部迷你条的 p50/p95 沿用全区间旧口径（那是既有指标，本轮不动），两者数字不一致属预期。
const LATENCY_CUTOFF_TS = Date.parse('2026-07-20T19:00:00.000Z')

/** 断点日期的展示串（给前端标"数据窗口"小字用，避免前端再硬编码一遍日期）。
 *  取断点在香港墙上时钟的日期：UTC 07-20 19:00 = 香港 07-21 03:00，故首个有数据的日桶为 07-21。 */
const LATENCY_CUTOFF_LABEL = '2026-07-21'

/** 环节耗时警示阈值：P90 超过 30 秒即视为"最坏体验已经很坏"，条色/文字转警示暖色。
 *  实测 ranking/extraction 的 P90 常态约 27s、最慢 58.5s，30s 阈值下正常波动不报警、真出问题才亮。 */
const LATENCY_WARN_MS = 30_000

/** 耗时趋势只画最慢的前 N 个环节：环节有 9 个，全画成线团，看不出任何东西 */
const TREND_PHASE_N = 3

/** 失败明细视图取前 N 条（区间内按时间倒序）：自带 limit、天然在分页上限内 */
const FAILED_LOG_N = 100

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
//
// 每页行数。【必须严格小于 PostgREST 的 db-max-rows（默认 1000）】——这是判停不变式的护栏，
// 不是随手取的数：fetchAllRows 靠「batch.length < PAGE_SIZE = 已到表尾」判停，而带 range 的请求
// 同样被 db-max-rows 封顶。一旦 PAGE_SIZE ≥ db-max-rows，满页会被 cap 削成"不满页" → 误判到底、
// 提前收工，且 dataTruncated 仍为 false —— 静默少报（正是 b56ee61 修掉那个 bug）就此无声复活。
// 取 500 而非贴着上限的 1000：留足余量，使判停不再依赖运维把 db-max-rows 恰好留在 1000
//（把 db-max-rows 调低到 500 防慢查询是常见运维动作，那会让 =1000 的旧值当场失真）。
// 代价：页数翻倍（1237 行 2 页 → 3 页），每页多一次往返；看板仅管理员低频打开，此量级无感。
const PAGE_SIZE = 500

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

// api_usage_logs 行的最小读取形状（metadata 为 jsonb，只取本看板用到的键）。
// error_code/error_message/logId 三键自 2026-07-25 起由各 route 失败记账补写（全部取自供应商响应、无 PII），
// 失败明细表据此一眼区分「并发超限 / 真故障」；无需改 select——它们随已 select 的整块 metadata jsonb 一并返回。
type LogMeta = {
  phase?: string; cost_source?: string; error_kind?: string
  error_code?: string; error_message?: string; logId?: string
} | null
// 全时段归因行：累计总花费卡与「按用户成本 Top-N」共用这一次全量查询，避免再开一条查询。
// user_id 是 UUID（0021 迁移补的归属列），补字段前的老行 / 无归属调用为 null。
type AttribRow = { estimated_cost_cny: number; user_id: string | null; is_anonymous: boolean | null }
/** 纯金额行：月/上月费用卡只需成本一列 */
type CostRow = { estimated_cost_cny: number }
// 今日行：既算今日费用卡，又供「今日活跃/匿名会话」（按 user_id 去重分类）与「今日故障按环节」，
// 故一并取归属列 + status + metadata + service（无 phase 时按 service 兜底成环节名）。
type TodayRow = {
  estimated_cost_cny: number; user_id: string | null; is_anonymous: boolean | null
  status: string; service: string; metadata: LogMeta
}
// 练习场次行：今日新练/复练拆分（今日子集）+ 每日趋势场次序列共用这一次区间查询。
type PracticeRow = { is_review: boolean; created_at: string }
/** 注册档行：今日新增注册按 created_at 过滤后计数（只取 id，绝不 join 任何个人信息） */
type ProfileRow = { id: string }
type RangeRow = {
  service: string; estimated_cost_cny: number; latency_ms: number
  status: string; created_at: string; metadata: LogMeta
  // 每日趋势的「活跃人数」按 user_id 去重需要归属列（只用于去重计数，不返回明细）
  user_id: string | null; is_anonymous: boolean | null
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
 *   · 容量繁忙 —— metadata.error_kind='capacity'（豆包并发超限 45000292，对用户返回 503 ASR_BUSY）。
 *     「人多稍等」不是故障；高峰期排队本会大量产生，混进错误率会把真实故障信号淹成一片红。
 * 只有【错误率】这一个口径按此过滤；失败成本 / 按环节 errorCost 一律照旧全量统计 error 行
 * （钱确实花了，产品方拍板：从错误率摘出、留在失败成本里）。
 * 历史行没有该键 → 归为系统故障，口径变化不追溯改写历史数据。
 * @param row  日志行（只用到 status 与 metadata.error_kind）
 */
function isSystemError(row: { status: string; metadata: LogMeta }): boolean {
  const kind = row.metadata?.error_kind
  return row.status === 'error' && kind !== ERROR_KIND_USER_INPUT && kind !== ERROR_KIND_CAPACITY
}

/** 豆包 ASR 是唯一「只做语音转写」的 service：无 phase 的豆包行 100% 是埋点前的转写调用（非某个未知环节）。 */
function isDoubaoAsr(row: { service: string }): boolean {
  return row.service === 'doubao_asr'
}

/**
 * 解析一行的环节 key：优先 metadata.phase；缺失时若为豆包 ASR（唯一只做转写的 service）确定性兜底为
 * 'transcribe'，据此消灭「其他/未标注」桶（那 100% 是埋点前缺 phase 的转写行，非未知环节）。
 * 非豆包又无 phase 的行返回 undefined（千问各环节成功/失败都带 phase，正常不该有这种行）。
 * @param row  日志行（用到 metadata.phase 与 service）
 */
function resolvePhase(row: { metadata: LogMeta; service: string }): string | undefined {
  return row.metadata?.phase ?? (isDoubaoAsr(row) ? 'transcribe' : undefined)
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
 * 今日故障归属的「环节中文名」：优先 metadata.phase 经 PHASE_META 映射；
 * 缺 phase 的历史行（如 2026-07-25 补埋点前的 transcribe 失败）用 service 兜底成一个可读桶名，
 * 绝不落进无意义的生 key。仅用于「今日故障按环节」分组展示。
 * @param row  今日日志行（用到 metadata.phase 与 service）
 */
function todayPhaseName(row: { metadata: LogMeta; service: string }): string {
  const phase = row.metadata?.phase
  if (phase) return PHASE_META[phase] ?? phase
  return SERVICE_META[row.service]?.name ?? row.service
}

/**
 * 聚合 api_usage_logs，返回看板所需全部统计数据
 * @param req  GET 请求，支持 ?range=7d|14d|30d
 * @returns    Tier1 今日经营（活跃注册/匿名会话数/练习新练复练/故障按环节/空录音/新增注册）、
 *             三张费用卡、迷你统计、服务分组、按环节成本、按用户成本 Top-N（含匿名/登录占比）、
 *             每日费用趋势 + 每日参与度趋势（活跃+场次）、每日失败次数、各环节耗时（分布 + 趋势）、
 *             今日状况、小时分布、最近 / 最贵 / 失败三份调用明细；留存/假空率本轮为 pending 占位
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

    // ── 10 条并行查询 ──
    // 前 5 条 + practice/profiles 两条是【聚合类】：结果集大小随数据量无上限增长，必须分页拉全量（见 fetchAllRows）。
    // 其余 3 条是【榜单类】：自带 .limit()，天然在 1000 行以内，直接查即可。
    const [allTimeRes, monthRes, lastMonthRes, todayRes, rangeRes, recentRes, costlyRes, failedRes, practiceRes, profilesRes] = await Promise.all([
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
      fetchAllRows<TodayRow>(() => supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny, user_id, is_anonymous, status, service, metadata')
        .gte('created_at', todayStart.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      fetchAllRows<RangeRow>(() => supabase
        .from('api_usage_logs')
        .select('service, estimated_cost_cny, latency_ms, status, created_at, metadata, user_id, is_anonymous')
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
      // 失败明细（区间内 status='error'，时间倒序）：每日失败柱图的下钻出口。
      // 刻意【不】在 SQL 层摘掉 user_input —— 明细表要能看到"这条失败到底是哪一类"，
      // 由前端按 error_kind 列展示；柱图的计数口径才只数系统故障（与 errorRate 一致）。
      supabase
        .from('api_usage_logs')
        .select('id, created_at, service, endpoint, usage_amount, usage_unit, estimated_cost_cny, latency_ms, status, metadata')
        .eq('status', 'error')
        .gte('created_at', rangeStartDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(FAILED_LOG_N),
      // 练习场次（区间内）：今日新练/复练拆分取其今日子集、每日趋势场次取全区间，一次查询两用。
      fetchAllRows<PracticeRow>(() => supabase
        .from('practice_sessions')
        .select('is_review, created_at')
        .gte('created_at', rangeStartDate.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      // 今日新增注册：profiles 今日 created_at 计数。只取 id，隐私红线 —— 绝不 join 邮箱/姓名。
      fetchAllRows<ProfileRow>(() => supabase
        .from('profiles')
        .select('id')
        .gte('created_at', todayStart.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
    ])

    const firstErr = allTimeRes.error ?? monthRes.error ?? lastMonthRes.error
      ?? todayRes.error ?? rangeRes.error ?? recentRes.error ?? costlyRes.error ?? failedRes.error
      ?? practiceRes.error ?? profilesRes.error
    if (firstErr) {
      return NextResponse.json({ error: firstErr.message }, { status: 500 })
    }

    // 分页触顶 = 数据不完整、看板在少报。绝不静默：打日志 + 随响应返回标记。
    const dataTruncated = allTimeRes.truncated || monthRes.truncated
      || lastMonthRes.truncated || todayRes.truncated || rangeRes.truncated
      || practiceRes.truncated || profilesRes.truncated
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
    const practiceRows     = practiceRes.data
    const profilesTdRows   = profilesRes.data
    const recent  = (recentRes.data ?? []) as RecentRow[]
    const costly  = (costlyRes.data ?? []) as RecentRow[]
    const failed  = (failedRes.data ?? []) as RecentRow[]

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

    // ── 今日活跃（注册）与匿名试用会话数 ──
    // 复用「按用户成本」同款分类逻辑：先把今日每个 user_id 归成匿名 / 注册（同一 user_id 只要有一条
    // is_anonymous=true 即整体标匿名），再各自去重计数。user_id 为空的行（老行/无归属）无法归到人，跳过。
    //   · registeredActiveToday = COUNT(DISTINCT 非匿名 user_id) —— 北极星「今日活跃真人」。
    //   · anonSessionsToday    = COUNT(DISTINCT 匿名 user_id)   —— 是「去重身份」不是去重真人：
    //     匿名 user_id 按设备持久（同一设备重复访问仍是同一 id、会被去重），但同一真人换设备 / 清缓存会分到
    //     新 id，故它高估真人数（非唯一真人）、绝不与注册活跃相加。前端措辞据此写「去重身份·按设备持久·非唯一真人」。
    const todayUserAnon = new Map<string, boolean>()
    for (const row of tdRows) {
      if (row.user_id == null) continue
      const prev = todayUserAnon.get(row.user_id) ?? false
      todayUserAnon.set(row.user_id, prev || row.is_anonymous === true)
    }
    let registeredActiveToday = 0
    let anonSessionsToday      = 0
    for (const isAnon of todayUserAnon.values()) {
      if (isAnon) anonSessionsToday++
      else        registeredActiveToday++
    }

    // ── 今日练习场次（新练 / 复练拆分）：practice_sessions 今日子集，按 is_review 分。 ──
    const todayTsForPractice = todayStart.getTime()
    const practiceTdRows   = practiceRows.filter(r => new Date(r.created_at).getTime() >= todayTsForPractice)
    const practiceReview   = practiceTdRows.filter(r => r.is_review).length
    const practiceNew      = practiceTdRows.length - practiceReview
    const practiceTotal    = practiceTdRows.length

    // ── 今日系统故障按环节 + 空录音（不算故障）──
    // 只数系统故障（isSystemError，与顶部错误率同口径）；按环节名分组降序。
    // emptyRecordingToday 单列：空录音是用户输入问题（error_kind=user_input），钱花了但服务是好的，不算故障。
    const todayFailPhaseMap = new Map<string, number>()
    for (const row of tdRows) {
      if (!isSystemError(row)) continue
      const name = todayPhaseName(row)
      todayFailPhaseMap.set(name, (todayFailPhaseMap.get(name) ?? 0) + 1)
    }
    const todayFailuresByPhase = Array.from(todayFailPhaseMap.entries())
      .map(([phase, count]) => ({ phase, count }))
      .sort((a, b) => b.count - a.count)
    const todayFailuresTotal  = todayFailuresByPhase.reduce((s, p) => s + p.count, 0)
    const emptyRecordingToday = tdRows.filter(r => r.metadata?.error_kind === ERROR_KIND_USER_INPUT).length

    // ── 今日新增注册（profiles 今日 created_at count）──
    const newRegistrationsToday = profilesTdRows.length

    // ── 迷你统计（基于 range 窗口） ──
    const successRows = rngRows.filter(r => r.status === 'success')
    const avgDailyCalls = r2(rngRows.length / rangeDays)
    // ⚠️ latency 口径断点 2026-07-20（fc0dbb8）：此前 matching 的 extraction / ranking 两条日志
    //    latency_ms 【都】写请求总耗时（同一个时长记两遍），之后才改成各自分段实测。
    //    故 range 窗口跨越 2026-07-20 时，avgLatency / p95Latency 是新旧两种口径的混合值，
    //    会显得"性能突然变好了一半"——那是口径修正，不是真的变快。历史行不追溯改写。
    // 用【中位数】而非均值：同一环节的延迟随输入长度能差 3 倍，均值谁也不代表；
    // 中位数答"典型一次要等多久"，配合 p95 答"最坏能有多坏"，两个数才拼得出体感。
    const p50Latency    = percentile(successRows.map(r => r.latency_ms), 50)
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
      // resolvePhase：豆包无 phase 兜底成 transcribe，消灭「其他」桶（成本块/失败块都读 phaseTotals）。
      const key = resolvePhase(row) ?? 'other'
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
    // 区间内每一天的「分桶键 + 展示标签」骨架：费用趋势、每日失败、耗时趋势三处共用同一套日期轴，
    // 各自单独生成的话，某天无数据时三张图的横轴会错位对不上。
    const dayBuckets = Array.from({ length: rangeDays }, (_, i) => {
      const hk = new Date(rangeStartDate.getTime() + i * 24 * 60 * 60 * 1000 + HK_OFFSET_MS)
      return {
        key:   `${hk.getUTCFullYear()}-${hk.getUTCMonth()}-${hk.getUTCDate()}`,
        date:  `${hk.getUTCMonth() + 1}/${hk.getUTCDate()}`,
      }
    })
    const dailyData = dayBuckets.map(({ key, date }) => {
      const entry = dailyMap.get(key) ?? {}
      return {
        date,
        doubao_asr:    r2(entry['doubao_asr']    ?? 0),
        qwen_flash:    r2(entry['qwen_flash']    ?? 0),
        qwen_plus:     r2(entry['qwen_plus']     ?? 0),
        total:         r2(entry['total']         ?? 0),
      }
    })

    // ── 每日失败次数（rangeDays 天，与 dailyData 同一日期轴） ──
    // 口径【只数系统故障】，与顶部 errorRate 一致：空录音之类的用户输入问题混进来会淹掉真故障，
    // 而这张图存在的唯一意义就是"哪天真的坏了"。金额口径的 failedCost 仍是全量 error，两者刻意不同。
    const failureMap = new Map<string, number>()
    for (const row of rngRows) {
      if (!isSystemError(row)) continue
      const key = hkDayKey(row.created_at)
      failureMap.set(key, (failureMap.get(key) ?? 0) + 1)
    }
    const dailyFailures = dayBuckets.map(({ key, date }) => ({ date, failures: failureMap.get(key) ?? 0 }))

    // ── 每日参与度趋势（活跃人数 + 练习场次，与 dailyData 同一日期轴）──
    // 活跃人数：每天在 api_usage_logs 里【去重的注册 user_id】数（与北极星「今日活跃·注册」同口径，
    //   刻意只数注册、不掺匿名——掺进来会与「匿名绝不和注册相加」的产品口径打架，且匿名会话数每天暴涨会淹没真实活跃）。
    // 练习场次：每天 practice_sessions 计数（新练+复练合计）。
    const activeUsersByDay = new Map<string, Set<string>>()
    for (const row of rngRows) {
      if (row.is_anonymous !== false || row.user_id == null) continue   // 只计注册（is_anonymous=false）且能归属的行
      const key = hkDayKey(row.created_at)
      const set = activeUsersByDay.get(key)
      if (set) set.add(row.user_id)
      else activeUsersByDay.set(key, new Set([row.user_id]))
    }
    const practiceByDay = new Map<string, number>()
    for (const row of practiceRows) {
      const key = hkDayKey(row.created_at)
      practiceByDay.set(key, (practiceByDay.get(key) ?? 0) + 1)
    }
    const engagementTrend = dayBuckets.map(({ key, date }) => ({
      date,
      activeUsers:      activeUsersByDay.get(key)?.size ?? 0,
      practiceSessions: practiceByDay.get(key) ?? 0,
    }))

    // ── 各环节耗时（分布 + 趋势）──
    // 只取成功调用（失败常瞬时返回，混入会把 P50 拉低成假象）且只取口径断点之后的行（见 LATENCY_CUTOFF_TS）。
    const latencyRows = rngRows.filter(r =>
      r.status === 'success' && new Date(r.created_at).getTime() >= LATENCY_CUTOFF_TS)

    const latencyByPhase = new Map<string, number[]>()
    for (const row of latencyRows) {
      const key = row.metadata?.phase ?? 'other'
      const arr = latencyByPhase.get(key)
      if (arr) arr.push(row.latency_ms)
      else latencyByPhase.set(key, [row.latency_ms])
    }
    // 按 P90 降序：要看的是"最坏体验有多坏"，最慢的排最上面。刻意【不给均值列】——
    // 同一环节不同输入的延迟能差 3 倍，均值谁也不代表，给了只会被当成"正常水平"误读。
    const phaseLatency = Array.from(latencyByPhase.entries())
      .map(([phase, ms]) => ({
        phase,
        name:  PHASE_META[phase] ?? phase,
        p50:   percentile(ms, 50),
        p90:   percentile(ms, 90),
        max:   Math.round(ms.reduce((m, v) => Math.max(m, v), 0)),
        calls: ms.length,
      }))
      .sort((a, b) => b.p90 - a.p90)

    // 耗时趋势：只画最慢的前 N 个环节，且一次只让前端画一个环节的 P50/P90 双线（见 PhaseLatencyPanel）。
    // 断点之前的日子给 null 而非 0 —— 0 会被画成"那几天延迟为零"的假谷底，null 让折线直接断开。
    const latencyTrend = phaseLatency.slice(0, TREND_PHASE_N).map(p => {
      const perDay = new Map<string, number[]>()
      for (const row of latencyRows) {
        if ((row.metadata?.phase ?? 'other') !== p.phase) continue
        const key = hkDayKey(row.created_at)
        const arr = perDay.get(key)
        if (arr) arr.push(row.latency_ms)
        else perDay.set(key, [row.latency_ms])
      }
      return {
        phase: p.phase,
        name:  p.name,
        days:  dayBuckets.map(({ key, date }) => {
          const ms = perDay.get(key)
          return ms && ms.length > 0
            ? { date, p50: percentile(ms, 50), p90: percentile(ms, 90), calls: ms.length }
            : { date, p50: null, p90: null, calls: 0 }
        }),
      }
    })

    // ── 今日状况条（顶部"一眼看出今天有没有出事"）──
    // 时间窗【固定近 7 日】、不随区间选择器变：判断"今天是不是异常"要跟一个稳定的近期基线比，
    // 基线跟着区间一起漂移的话，切到 30 天就会因为均值被稀释而看不出今天的异常。
    // rangeDays 最小值就是 7，故 rngRows 必然覆盖得到这 7 天。
    const last7StartTs = todayStart.getTime() - 6 * 24 * 60 * 60 * 1000
    const last7Rows    = rngRows.filter(r => new Date(r.created_at).getTime() >= last7StartTs)
    const todayRowsInRange = rngRows.filter(r => new Date(r.created_at).getTime() >= todayStart.getTime())
    const slowest = phaseLatency[0] ?? null
    const todayStatus = {
      todayFailures:     todayRowsInRange.filter(isSystemError).length,
      avgDailyFailures7: r2(last7Rows.filter(isSystemError).length / 7),
      avgDailyCost7:     r2(last7Rows.reduce((s, r) => s + r.estimated_cost_cny, 0) / 7),
      slowestPhase:      slowest ? { name: slowest.name, p90: slowest.p90 } : null,
    }

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
      // ── Tier1 今日经营口径（今日日历边界，不随下方区间选择器变）──
      registeredActiveToday,
      anonSessionsToday,
      practiceNew,
      practiceReview,
      practiceTotal,
      todayFailuresByPhase,
      todayFailuresTotal,
      emptyRecordingToday,
      newRegistrationsToday,
      avgDailyCalls,
      p50Latency,
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
      dailyFailures,
      // Tier2 每日参与度趋势（活跃人数 + 练习场次），所选区间口径
      engagementTrend,
      // Tier2 留存 / 假空率：本轮只给占位。留存需 user_id 跨天配对、假空率需读 flow_events，
      // 口径较重，先返回 pending 让前端做「下一步接入」空态，不硬编错数误导判断。
      retentionPending: true,
      fakeEmptyPending: true,
      phaseLatency,
      latencyTrend,
      // 耗时两视图的数据起点（口径断点）：前端在区块标题右侧标出，避免被误读成"只有这几天有调用"
      latencyCutoff: LATENCY_CUTOFF_LABEL,
      latencyWarnMs: LATENCY_WARN_MS,
      todayStatus,
      hourlyData,
      recentLogs: recent,
      costlyLogs: costly,
      failedLogs: failed,
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
