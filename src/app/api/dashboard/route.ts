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
// 看板指标 RPC 读取帮手（各自独立自降级、RPC 缺失/出错返 null）——从本文件抽出以守 <1000 行红线（见该模块头注释）。
import {
  fetchRetention, fetchRegistration, fetchDailyRegistrations, fetchActiveRegistered,
  fetchCoreActive, fetchWindowCoreActive, fetchActivation, fetchWeeklyRetention,
  fetchCohortReturns, fetchPageViewStats,
  // 成本看板身份口径（迁移 0058）：用户【当前】身份读取 + 按当前身份聚合 Top-N / 匿名占比。
  fetchUserAnonFlags, aggregateUserCosts,
} from '@/lib/db/dashboard-metrics'
// 「有新反馈吗」待办清单读取（未处理全量 + 已处理近 20）：同样抽出成帮手守 <1000 行红线；
// 三态自降级（迁移 0055 未跑 → 近 7 天只读；读表异常 → loadFailed），绝不让主看板 500。
import { fetchDashboardFeedback } from '@/lib/db/dashboard-feedback'

import {
  AttribRow,
  CostRow,
  DAILY_BUDGET_CNY,
  EXCLUDE_INTERNAL_BY_ID,
  EXCLUDE_INTERNAL_BY_USER,
  FAILED_LOG_N,
  FAKE_EMPTY_PEAK_THRESHOLD,
  FailedRow,
  HK_OFFSET_MS,
  LATENCY_CUTOFF_LABEL,
  LATENCY_CUTOFF_TS,
  LATENCY_WARN_MS,
  MAX_PAGES,
  PAGE_SIZE,
  PHASE_META,
  PracticeRow,
  ProfileRow,
  RangeRow,
  RecentRow,
  SERVICE_META,
  TOP_COST_N,
  TOP_USER_N,
  TREND_PHASE_N,
  TodayRow,
  fetchAllRows,
  hkDayKey,
  hkDayStartUtc,
  isSystemError,
  parseRange,
  percentile,
  r2,
  resolvePhase,
  todayPhaseName,
} from '@/lib/db/dashboard-shared'

/**
 * 聚合 api_usage_logs，返回看板所需全部统计数据
 * @param req  GET 请求，支持 ?range=7d|14d|30d
 * @returns    Tier1 今日经营（活跃注册/匿名会话数/练习新练复练/故障按环节/空录音/新增注册）、
 *             三张费用卡、迷你统计、服务分组、按环节成本、按用户成本 Top-N（含匿名/登录占比；身份取
 *             auth.users 当前身份，0058 RPC，迁移未跑时回退旧标记口径并置 userIdentityPending）、
 *             每日费用趋势 + 每日参与度趋势（活跃+场次+新增注册）、每日失败次数、各环节耗时（分布 + 趋势）、
 *             今日状况、小时分布、最近 / 最贵 / 失败三份调用明细；注册用户留存（D1/D7 池化，get_retention_stats RPC，
 *             迁移未跑时优雅降级 null）；假空率（区间内空录音 peak≥阈值占比，无带信号样本时 pending 降级）；
 *             增长漏斗（0047 三 RPC：activation 累计注册/激活、weeklyRetention W1 首周留存、windowCoreActive
 *             窗口核心活跃去重；活跃口径三级降级 = 核心活跃 0047 → 活跃注册 0045 → is_anonymous 去重，各 RPC
 *             迁移未跑时对应段独立降级、绝不 500）
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

    // 留存 / 真注册两个 RPC 与下方 10 条查询并发跑（独立于 Promise.all，自带降级、绝不 reject 拖垮主看板）。
    const retentionPromise    = fetchRetention(supabase, rangeDays)
    const registrationPromise = fetchRegistration(supabase, rangeDays)
    // 每日新增注册（趋势图第三条线）：与主查询并发、自带降级；null = 迁移 0044 未跑/出错，前端不渲染该线。
    const dailyRegPromise     = fetchDailyRegistrations(supabase, rangeDays)
    // 每日活跃注册（0045 口径，活跃三级降级的第 2 级）：与主查询并发、自带降级；
    // null = 迁移 0045 未跑/出错，回退旧 is_anonymous 标记口径（见下方消费处）。
    const activeRegPromise    = fetchActiveRegistered(supabase, rangeDays)
    // 每日核心活跃（0047 新·权威，活跃三级降级的第 1 级）：AI 环节/闪卡/收藏任一即算；
    // null → 回退 activeReg(0045) → 再回退 is_anonymous 去重。与主查询并发、自带降级。
    const coreActivePromise   = fetchCoreActive(supabase, rangeDays)
    // 窗口核心活跃去重标量（0047·get_window_core_active，漏斗③主数字权威源）：DB 侧窗口级去重（全 7 信号）；
    // null（迁移未跑/出错）→ 回退 rngRows 现算的 AI-only 近似（windowActiveSet.size）。与主查询并发、自带降级。
    const windowCorePromise   = fetchWindowCoreActive(supabase, rangeDays)
    // 激活漏斗（0047）：累计注册/激活 + 本周期群组；null = 迁移未跑/出错，前端漏斗①②走降级态。
    const activationPromise    = fetchActivation(supabase, rangeDays)
    // W1 首周留存（0047）：null = 迁移未跑/出错，前端漏斗④主区降级、D1/D7 对照行仍由旧 retention 承担。
    const weeklyRetentionPromise = fetchWeeklyRetention(supabase, rangeDays)
    // 用户反馈待办清单（不随区间选择器变）：与主查询并发、自带三态降级（见 dashboard-feedback 顶注）。
    const feedbackPromise = fetchDashboardFeedback(supabase)
    // 「新注册的人还回来吗」cohort（固定近 7 天注册分组，不随区间选择器变）：与主查询并发、失败降级 null。
    const cohortPromise = fetchCohortReturns(supabase)
    // 「哪些页面被用得多」（窗口 page.view 聚合，随区间选择器变）：与主查询并发、失败降级 null。
    const pageViewsPromise = fetchPageViewStats(supabase, rangeDays)
    // 用户【当前】身份表（0058·get_user_anon_flags，成本看板 Top-N 与匿名占比的口径权威源）：
    // 与主查询并发、自带降级；null = 迁移未跑/出错/结果疑似被截断 → 下方逐字回退旧标记口径并置 pending。
    const userFlagsPromise = fetchUserAnonFlags(supabase)

    // ── 10 条并行查询 ──
    // 前 5 条 + practice/profiles 两条是【聚合类】：结果集大小随数据量无上限增长，必须分页拉全量（见 fetchAllRows）。
    // 其余 3 条是【榜单类】：自带 .limit()，天然在 1000 行以内，直接查即可。
    const [allTimeRes, monthRes, lastMonthRes, todayRes, rangeRes, recentRes, costlyRes, failedRes, practiceRes, profilesRes] = await Promise.all([
      // 全时段：既算累计总花费卡，又供「按用户成本 Top-N」按 user_id 归因，故一并取归属列。
      // 这条永不设时间下界、行数只增不减，是最先撞 1000 行上限、也是少报最严重的一条。
      fetchAllRows<AttribRow>(() => supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny, user_id, is_anonymous')
        .or(EXCLUDE_INTERNAL_BY_USER)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      fetchAllRows<CostRow>(() => supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny')
        .or(EXCLUDE_INTERNAL_BY_USER)
        .gte('created_at', monthStart.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      fetchAllRows<CostRow>(() => supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny')
        .or(EXCLUDE_INTERNAL_BY_USER)
        .gte('created_at', lastMonthStart.toISOString())
        .lt('created_at', monthStart.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      fetchAllRows<TodayRow>(() => supabase
        .from('api_usage_logs')
        .select('estimated_cost_cny, user_id, is_anonymous, status, service, metadata')
        .or(EXCLUDE_INTERNAL_BY_USER)
        .gte('created_at', todayStart.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      fetchAllRows<RangeRow>(() => supabase
        .from('api_usage_logs')
        .select('service, estimated_cost_cny, latency_ms, status, created_at, metadata, user_id, is_anonymous')
        .or(EXCLUDE_INTERNAL_BY_USER)
        .gte('created_at', rangeStartDate.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      supabase
        .from('api_usage_logs')
        .select('id, created_at, service, endpoint, usage_amount, usage_unit, estimated_cost_cny, latency_ms, status, metadata')
        .or(EXCLUDE_INTERNAL_BY_USER)
        .order('created_at', { ascending: false })
        .limit(30),
      // 最贵 Top-N（全时段按成本降序）：时间序的"最近调用"抓不到某次异常昂贵，需独立按成本排。
      supabase
        .from('api_usage_logs')
        .select('id, created_at, service, endpoint, usage_amount, usage_unit, estimated_cost_cny, latency_ms, status, metadata')
        .or(EXCLUDE_INTERNAL_BY_USER)
        .order('estimated_cost_cny', { ascending: false })
        .limit(TOP_COST_N),
      // 失败明细（区间内 status='error'，时间倒序）：每日失败柱图的下钻出口。
      // 刻意【不】在 SQL 层摘掉 user_input —— 明细表要能看到"这条失败到底是哪一类"，
      // 由前端按 error_kind 列展示；柱图的计数口径才只数系统故障（与 errorRate 一致）。
      // 另取 user_id + is_anonymous（S4 告警四件套①「带影响者」）：返回前截前 8 位，完整 id 不出接口。
      supabase
        .from('api_usage_logs')
        .select('id, created_at, service, endpoint, usage_amount, usage_unit, estimated_cost_cny, latency_ms, status, metadata, user_id, is_anonymous')
        .or(EXCLUDE_INTERNAL_BY_USER)
        .eq('status', 'error')
        .gte('created_at', rangeStartDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(FAILED_LOG_N),
      // 练习场次（区间内）：今日新练/复练拆分取其今日子集、每日趋势场次取全区间，一次查询两用。
      fetchAllRows<PracticeRow>(() => supabase
        .from('practice_sessions')
        .select('is_review, created_at')
        .or(EXCLUDE_INTERNAL_BY_USER)
        .gte('created_at', rangeStartDate.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      // 今日新增注册：profiles 今日 created_at 计数。只取 id，隐私红线 —— 绝不 join 邮箱/姓名。
      fetchAllRows<ProfileRow>(() => supabase
        .from('profiles')
        .select('id')
        .or(EXCLUDE_INTERNAL_BY_ID)
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
    // 失败明细带影响者（S4①）：服务端截 user_id 前 8 位（辨识够用、完整 id 不出接口），匿名标记随行。
    const failed  = ((failedRes.data ?? []) as FailedRow[]).map(({ user_id, is_anonymous, ...rest }) => ({
      ...rest,
      userIdShort: user_id ? user_id.slice(0, 8) : null,
      isAnonymous: is_anonymous,
    }))

    // ── 三张费用卡 ──
    const allTimeCost   = r2(allRows.reduce((s, r) => s + r.estimated_cost_cny, 0))
    const allTimeCalls  = allRows.length
    const monthCost     = r2(mRows.reduce((s, r) => s + r.estimated_cost_cny, 0))
    const monthCalls    = mRows.length
    // 「本月」标签取【东八区月份】（与 monthCost 的 monthStart 同源 nowHk.getUTCMonth）——
    // 修客户端 new Date().getMonth() 的时区错标：跨月又跨时区时（如东八区已 8 月、浏览器本地仍 7 月），
    // 客户端月份会把「本月(8月)」错标成「7月」。标签必须服务端算、与数字口径一致。
    const monthLabel    = `${nowHk.getUTCMonth() + 1}月`
    const lastMonthCost = lmRows.reduce((s, r) => s + r.estimated_cost_cny, 0)
    const monthChange   = lastMonthCost > 0
      ? r2((monthCost - lastMonthCost) / lastMonthCost * 100)
      : null
    const todayCost  = r2(tdRows.reduce((s, r) => s + r.estimated_cost_cny, 0))
    const todayCalls = tdRows.length

    // ── 今日活跃（注册）与匿名试用会话数 ──
    // 先把今日每个 user_id 按 is_anonymous 标记归成匿名 / 注册（同一 user_id 只要有一条 is_anonymous=true
    // 即整体标匿名），再各自去重计数。user_id 为空的行（老行/无归属）无法归到人，跳过。此处两个计数是：
    //   · anonSessionsToday    = COUNT(DISTINCT 匿名 user_id)   —— 是「去重身份」不是去重真人：
    //     匿名 user_id 按设备持久（同一设备重复访问仍是同一 id、会被去重），但同一真人换设备 / 清缓存会分到
    //     新 id，故它高估真人数（非唯一真人）、绝不与注册活跃相加。前端措辞据此写「去重身份·按设备持久·非唯一真人」。
    //     匿名无权威表可依，维持此标记口径不变。
    //   · registeredActiveFallback = COUNT(DISTINCT 非匿名 user_id) —— 仅作【降级兜底】：
    //     注册活跃的权威值改由 0045 RPC（读 auth.users）算，见下方 registeredActiveToday。
    //     旧口径靠 api_usage_logs.is_anonymous 标记，而该标记正是旧 stale JWT bug 会写错的不可靠字段。
    const todayUserAnon = new Map<string, boolean>()
    for (const row of tdRows) {
      if (row.user_id == null) continue
      const prev = todayUserAnon.get(row.user_id) ?? false
      todayUserAnon.set(row.user_id, prev || row.is_anonymous === true)
    }
    let registeredActiveFallback = 0
    let anonSessionsToday        = 0
    for (const isAnon of todayUserAnon.values()) {
      if (isAnon) anonSessionsToday++
      else        registeredActiveFallback++
    }
    // 今日活跃·注册【三级降级】：核心活跃(0047 权威) → 活跃注册(0045) → is_anonymous 标记去重(registeredActiveFallback)。
    // activeMap = 前两级中最先可用者的每日映射；两级 RPC 皆 null 时走 fallback。取当天格。
    // 匿名会话数（anonSessionsToday）不变——匿名本就"非唯一真人"、无权威表可依，维持旧标记口径。
    // 今日日桶键：与 dayBuckets/hkDayKey 同格式（`年-月(0基)-日`），用香港墙上时钟的今日。
    const coreActive = await coreActivePromise
    const activeReg = await activeRegPromise
    const activeMap = coreActive ?? activeReg
    const todayBucketKey = `${nowHk.getUTCFullYear()}-${nowHk.getUTCMonth()}-${nowHk.getUTCDate()}`
    const registeredActiveToday = activeMap
      ? (activeMap.get(todayBucketKey) ?? 0)
      : registeredActiveFallback

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

    // ── 今日新增注册（真注册口径优先）──
    // 真注册 = auth.users 非匿名·有邮箱（get_registration_stats RPC）。原 profiles 计数把匿名也算进来、虚高
    // （实测 7/28 profiles 13 / 真注册 3）。RPC 未接入（迁移未跑）时回退 profiles 计数并置 pending，
    // 前端据此在卡上标注「含匿名·待迁移生效」，不静默显错数。
    const registration = await registrationPromise
    const newRegistrationsToday   = registration ? registration.todayCount : profilesTdRows.length
    const newRegistrationsPending = registration === null

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

    // ── 假空率（区间窗口）：空录音里"采到了声音却转写空"的占比 ──
    // 空录音 = error_kind=user_input（EMPTY_TRANSCRIPT / 豆包静音 20000003，见 transcribe route）。
    // 只把带 audio 采集信号（口径生效后）的空录音计入分母：老数据无 audio 字段，无从判真伪，排除不误算。
    //   · 假空 = peak ≥ 阈值（采到真实声音却转写空 → 疑似采集/上传/ASR 问题）
    //   · 真空 = peak < 阈值（用户真没出声，良性）
    // n（分母）为 0（区间内无带信号的空录音）→ 置 null + pending，前端保留「待接入」，不显误导的 0%。
    const emptyAudioRows = rngRows.filter(r =>
      r.metadata?.error_kind === ERROR_KIND_USER_INPUT
      && r.metadata.audio != null
      && typeof r.metadata.audio.peak === 'number')
    const fakeEmptyN     = emptyAudioRows.length
    const fakeEmptyCount = emptyAudioRows.filter(r => (r.metadata!.audio!.peak as number) >= FAKE_EMPTY_PEAK_THRESHOLD).length
    const fakeEmptyPending = fakeEmptyN === 0
    const fakeEmpty = fakeEmptyPending
      ? null
      : { rate: r2(fakeEmptyCount / fakeEmptyN * 100), n: fakeEmptyN, fakeCount: fakeEmptyCount }

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
    // user_id 为空的行（补归属字段前的老行 / 无归属调用）无法归因到人，跳过分组、也不计入占比两侧。
    // 隐私：只按 user_id（UUID、非邮箱/姓名）归因，刻意不 join users 表拉个人信息进成本看板。
    //   ⚠️ 0058 的 RPC 同样【只返回 (id, is_anonymous) 两列】，这条红线不因引入身份表而松动。
    //
    // ⚠️⚠️【为什么身份【不能】用 api_usage_logs.is_anonymous 判 —— 别再"顺手优化"改回去】
    //   该列记的是【调用发生那一刻】的身份，而本项目「注册 = updateUser({email,password}) 升级
    //   当前匿名账号、user_id 不变」（src/lib/auth.ts 顶注）。于是：
    //     ① 任何「先匿名试用、后注册」的转化用户都永久带着一批 is_anonymous=true 的历史行，
    //        旧口径「同一 user_id 只要有一条匿名即标匿名」会把转化最成功的用户标成匿名 ——
    //        2026-08-07 线上确证：某用户匿名期 2 次调用即注册、之后作为注册用户用了 107 次，
    //        却在成本榜上顶着「匿名」排第一，看起来像在薅羊毛；
    //     ② 绑邮箱后 updateUser 不换发新 token（stale JWT），注册后一小段时间的调用仍记成匿名。
    //   故身份一律取【当前】身份（auth.users 权威源，0058 RPC），与「今日活跃·注册」(0045)、
    //   「新增注册」(0043/0044)、漏斗 (0047) 的口径同源。历史行的 is_anonymous 只用于降级兜底。
    //
    // 历史 NULL 行：analysis / phrases / matching 三个路由在 2026-08-07 前没写 is_anonymous
    //   （写进去是 NULL），这些行有 user_id 就照常计入该用户、身份取当前身份（NULL 不参与判断），
    //   无 user_id 才被跳过 —— 详见 aggregateUserCosts 顶注。
    const userFlags = await userFlagsPromise
    // true = 迁移 0058 未跑 / RPC 出错 / 结果疑似被截断 → 下面走旧标记口径，前端卡片标注「口径待生效」。
    const userIdentityPending = userFlags === null
    const { userTotals, anonymousCost, loggedInCost } = aggregateUserCosts(allRows, userFlags, TOP_USER_N)

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

    // ── 每日参与度趋势（活跃人数 + 练习场次 + 新增注册，与 dailyData 同一日期轴）──
    // 活跃人数【三级降级】：核心活跃(0047)→活跃注册(0045)→is_anonymous 标记去重。每天取 activeMap 当天格；
    //   activeMap 为 null（两级 RPC 皆缺失/出错）→ 回退旧 is_anonymous 标记去重（activeUsersByDay），不 500。
    //   刻意只数注册、不掺匿名——掺进来会与「匿名绝不和注册相加」的产品口径打架，且匿名会话数每天暴涨会淹没真实活跃。
    // 练习场次：每天 practice_sessions 计数（新练+复练合计）。
    // 新增注册：每天真注册数（get_daily_registrations RPC，0044；口径 = auth.users 非匿名·有邮箱）。
    //   dailyReg 为 null（迁移未跑/RPC 出错）时该字段整条置 null，前端不渲染这条线（不画全 0 线误导）。
    // windowActiveSet：窗口内【核心活跃三级降级第 3 级】的去重人数（漏斗③）——注册用户在窗口内任一天有 AI 环节
    //   活动即计。⚠️ 仅覆盖 api_usage_logs 信号：0047 的 per-day RPC 无法在 JS 侧跨天去重成「窗口去重」，故窗口
    //   聚合值只能由 rngRows 现算（这也正是活跃口径的第 3 级降级源，恒可算、绝不拖垮看板）。见响应处 windowCoreActive。
    const activeUsersByDay = new Map<string, Set<string>>()
    const windowActiveSet  = new Set<string>()
    for (const row of rngRows) {
      if (row.is_anonymous !== false || row.user_id == null) continue   // 只计注册（is_anonymous=false）且能归属的行
      windowActiveSet.add(row.user_id)
      const key = hkDayKey(row.created_at)
      const set = activeUsersByDay.get(key)
      if (set) set.add(row.user_id)
      else activeUsersByDay.set(key, new Set([row.user_id]))
    }
    // 窗口核心活跃去重人数（漏斗③主数字）：优先 0047 标量 RPC（全 7 信号·DB 侧窗口去重、值准）；
    // null（迁移未跑/出错）→ 回退 windowActiveSet.size（rngRows 现算的 AI-only 近似，恒可算保底）。
    const windowCoreRpc = await windowCorePromise
    const windowCoreActive = windowCoreRpc ?? windowActiveSet.size
    // windowCoreApprox：仅当回退到 AI-only 近似时置真（RPC 缺失/出错），供未来 UI 需要时标注「近似」用；
    // happy path（RPC 已部署）恒为 false、值权威。
    const windowCoreApprox = windowCoreRpc == null
    // 核心活跃「三级全失败」标记：两级每日权威 RPC 皆不可用时置真，前端漏斗③改走降级态（口径不可信）。
    // 至少一级 RPC 可用则 false。⚠️ 与 windowCoreApprox 正交：前者判每日口径链健康、后者判③标量是否走近似。
    const activePending = coreActive == null && activeReg == null
    const practiceByDay = new Map<string, number>()
    for (const row of practiceRows) {
      const key = hkDayKey(row.created_at)
      practiceByDay.set(key, (practiceByDay.get(key) ?? 0) + 1)
    }
    // 每日新增注册映射（RPC 并发结果）：null = 迁移未跑/出错，下方 newReg 整条置 null，前端降级不画该线。
    const dailyReg = await dailyRegPromise
    const engagementTrend = dayBuckets.map(({ key, date }) => ({
      date,
      // 活跃人数：三级降级——activeMap（核心活跃 0047 → 活跃注册 0045）可用时取当天格；
      // null（两级 RPC 皆缺失/出错）回退旧标记去重 activeUsersByDay。
      activeUsers:      activeMap ? (activeMap.get(key) ?? 0) : (activeUsersByDay.get(key)?.size ?? 0),
      practiceSessions: practiceByDay.get(key) ?? 0,
      newReg:           dailyReg ? (dailyReg.get(key) ?? 0) : null,
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

    // 留存 RPC 结果（与主查询并发、自带降级）：null = 迁移未跑/出错，前端显降级态。
    const retention = await retentionPromise
    // 激活漏斗 / W1 首周留存（0047，与主查询并发、自带降级）：null = 迁移 0047 未跑/出错，前端漏斗对应段走降级态。
    const activation      = await activationPromise
    const weeklyRetention = await weeklyRetentionPromise
    // 反馈待办（并发结果，自带降级、恒有值）：未处理全量 + 已处理近 20 + handledSupported / loadFailed 标记。
    const feedback = await feedbackPromise
    // 用户区扩充（2026-08-04 方案 §四）：cohort 回访 + 页面浏览聚合，各自失败降级 null、不 500。
    const cohortReturns = await cohortPromise
    const pageViewStats = await pageViewsPromise

    return NextResponse.json({
      // 用户反馈待办清单（「有新反馈吗」区块）：handledSupported=false 表示迁移 0055 未跑、前端退化只读；
      // 条目 user_id 已被服务端截前 8 位、context.email 只进本管理员接口（PII 红线，勿再转发/落日志）。
      feedback,
      allTimeCost,
      allTimeCalls,
      monthCost,
      monthLabel,
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
      // 今日新增注册：真注册口径（RPC 可用时）；windowCount 供未来窗口口径用，本轮前端只渲染 today。
      newRegistrationsToday,
      newRegistrationsWindow: registration?.windowCount ?? null,
      // true = RPC 未接入、newRegistrationsToday 为 profiles 降级值（含匿名），前端卡标注「含匿名·待迁移生效」。
      newRegistrationsPending,
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
      // 按用户成本 Top-N + 匿名/登录成本占比：身份取【当前】身份（0058 RPC），非历史调用标记。
      // 占比按【用户】归类（转化用户匿名期的成本计入登录侧），与榜单标签同源、可对账。
      userTotals,
      anonymousCost,
      loggedInCost,
      // userIdentityPending：true = 0058 未跑/RPC 不可用，以上三项回退旧标记口径（转化用户会被误标匿名），
      // 前端在该卡上标「口径待生效」+ 说明，不静默显错数（范式同 newRegistrationsPending / activePending）。
      userIdentityPending,
      dailyData,
      dailyFailures,
      // Tier2 每日参与度趋势（活跃人数 + 练习场次 + 新增注册），所选区间口径。
      // 每项 newReg = 当日真注册数（0044 RPC）；整条 newReg 为 null 即降级态，前端不渲染这条线。
      engagementTrend,
      // Tier2 留存：get_retention_stats RPC（0043）算注册用户 D1/D7 池化留存 + 样本量。
      // ⚠️ D1/D7 为旧口径（精确等日留存），W1 上线后仅作漏斗④对照行，后续移除。
      retention,
      // retentionPending：留存 RPC 未接入的降级标记（现语义 = 迁移未跑/出错，而非「功能未实现」），
      // 供前端降级判断与既有口径断言沿用。retention 有数即 false。
      retentionPending: retention === null,
      // ── 增长漏斗（0047 三 RPC，迁移未跑时各段独立降级、不 500）──
      // 激活漏斗①②：累计注册/激活 + 本周期群组（激活 = corpus≥1 条）。null = 迁移未跑/出错，前端①②同时降级。
      activation,
      activationPending: activation === null,
      // W1 首周留存（漏斗④主区）：首活后 D+1~D+7 任一天再活跃的区间留存。null = 迁移未跑/出错，
      // 前端④主区降级、D1/D7 对照行仍由上面 retention 独立承担。
      weeklyRetention,
      weeklyRetentionPending: weeklyRetention === null,
      // 窗口核心活跃去重人数（漏斗③主数字）：0047 标量 RPC（全 7 信号）优先，null 回退 rngRows AI-only 近似。
      windowCoreActive,
      // windowCoreApprox：③ 本次是否为 AI-only 近似（RPC 回退时 true）。当前口径小字不据此改，留给未来 UI 用。
      windowCoreApprox,
      // activePending：核心活跃两级【每日】权威 RPC（0047→0045，趋势线/今日值口径）皆不可用时置真，
      // 前端漏斗③走降级态（沿用原判定）。⚠️ 与③标量口径（windowCoreActive/windowCoreApprox）正交——
      // 后者由独立的 get_window_core_active 决定是否走 AI-only 近似，两套 RPC 各自降级、互不代表。
      activePending,
      // 假空率（区间窗口）：空录音里 peak≥阈值（采到声音却转写空）的占比 + 样本量 n。
      // fakeEmpty=null 且 fakeEmptyPending=true = 区间内无带 audio 信号的空录音（口径生效前无数据），前端显「待接入」。
      fakeEmpty,
      fakeEmptyPending,
      // 假空判据阈值（前端口径小字用；待真实数据标定）。
      fakeEmptyThreshold: FAKE_EMPTY_PEAK_THRESHOLD,
      // 「新注册的人还回来吗」（固定近 7 天注册分组）：null = 读取失败降级，前端显「暂不可用」。
      cohortReturns,
      // 「哪些页面被用得多」（窗口 page.view 按 route 聚合，剔 QA 与内部账户）：null = 读取失败降级。
      pageViewStats,
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
