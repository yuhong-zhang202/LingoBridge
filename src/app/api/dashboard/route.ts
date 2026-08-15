/**
 * @module   api/dashboard
 * @desc     GET /api/dashboard?range=7d|14d|30d — 聚合 api_usage_logs，返回看板所需全部统计。
 *           聚合类查询一律经 fetchAllRows 分页拉全量，绝不裸查（PostgREST 会静默截断到 1000 行）。
 *
 *   【文件边界】2026-08-14 纯结构拆分：十条表查询搬到 `lib/db/dashboard-queries`，聚合计算按主题
 *   搬到 `lib/db/dashboard-{cost,today,trends,health}`（逐字未改、只换位置），本文件只剩
 *   【鉴权 → 并发发起取数（RPC + 表查询）→ 编排计算 → 组装响应】。各口径注释随各自的计算搬过去了。
 *
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin, authErrorResponse } from '@/lib/api-auth'
// 看板指标 RPC 读取帮手（各自独立自降级、RPC 缺失/出错返 null）——从本文件抽出以守 <1000 行红线（见该模块头注释）。
import {
  fetchRetention, fetchRegistration, fetchDailyRegistrations, fetchActiveRegistered,
  fetchCoreActive, fetchWindowCoreActive, fetchActivation, fetchWeeklyRetention,
  fetchCohortReturns,
  // 成本看板身份口径（迁移 0058）：用户【当前】身份读取 + 按当前身份聚合 Top-N / 匿名占比。
  fetchUserAnonFlags, aggregateUserCosts,
  // 表级 fetcher 触顶时的日志措辞（唯一真源，勿在此另写一份）。
  TRUNCATION_LOG_HINT,
} from '@/lib/db/dashboard-metrics'
// 「有新反馈吗」待办清单读取（未处理全量 + 已处理近 20）：同样抽出成帮手守 <1000 行红线；
// 三态自降级（迁移 0055 未跑 → 近 7 天只读；读表异常 → loadFailed），绝不让主看板 500。
import { fetchDashboardFeedback } from '@/lib/db/dashboard-feedback'
// 十条表查询 + 分页/截断处理 + 行归一化（查询定义逐字搬出，见该模块头注释）。
import { fetchDashboardTables } from '@/lib/db/dashboard-queries'
// ── 四个聚合模块：金额 / 今日 / 每日序列 / 健康信号。全是纯函数，口径注释随计算一并搬过去了。──
import {
  computeCostCards, computeRangeStats, computeServiceTotals, computePhaseTotals,
} from '@/lib/db/dashboard-cost'
import { computeTodayIdentity, computeTodayPractice, computeTodayFailures } from '@/lib/db/dashboard-today'
import {
  buildDayBuckets, computeDailyData, computeDailyFailures, computeEngagement, computeHourlyData,
} from '@/lib/db/dashboard-trends'
import { computeFakeEmpty, computeLatency, computeTodayStatus } from '@/lib/db/dashboard-health'

import {
  COST_QA_BASELINE_START,
  DAILY_BUDGET_CNY,
  FAKE_EMPTY_PEAK_THRESHOLD,
  HK_OFFSET_MS,
  LATENCY_CUTOFF_LABEL,
  LATENCY_WARN_MS,
  TOP_USER_N,
  hkDayStartUtc,
  parseRange,
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
 *             迁移未跑时对应段独立降级、绝不 500）；
 *             另有两个【取数完整性】标志，各自对应一块数据、语义都是「这块偏低，别当真实值」：
 *             dataTruncated（api_usage_logs 金额）/ cohortReturns.truncated（回访人数）。
 *             两者刻意不合并 —— 前端文案与各自的块一一对应。
 *             （原第三个 pageViewsTruncated 已随「哪些页面被用得多」整链于 2026-08-15 删除。）
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
    // 用户【当前】身份表（0058·get_user_anon_flags，成本看板 Top-N 与匿名占比的口径权威源）：
    // 与主查询并发、自带降级；null = 迁移未跑/出错/结果疑似被截断 → 下方逐字回退旧标记口径并置 pending。
    const userFlagsPromise = fetchUserAnonFlags(supabase)

    // ── 十条表查询（前 5 条 + practice/profiles 是聚合类，分页拉全量；其余 3 条自带 limit）──
    // 查询定义与两个排除过滤（内部账户 / QA 自测流量）逐条见 dashboard-queries 模块。
    const tables = await fetchDashboardTables(supabase, { monthStart, lastMonthStart, todayStart, rangeStartDate })
    if (tables.error) {
      return NextResponse.json({ error: tables.error.message }, { status: 500 })
    }
    const { allRows, mRows, lmRows, tdRows, rngRows, practiceRows, profilesTdRows,
      recent, costly, failed, dataTruncated } = tables

    // ── 三张费用卡 ──
    const { allTimeCost, allTimeCalls, monthCost, monthCalls, monthLabel, monthChange, todayCost, todayCalls }
      = computeCostCards({ allRows, mRows, lmRows, tdRows, nowHk })

    // ── 今日经营口径（活跃/匿名会话数、练习新练复练、故障按环节、空录音）──
    const { registeredActiveFallback, anonSessionsToday } = computeTodayIdentity(tdRows)
    const { practiceNew, practiceReview, practiceTotal }  = computeTodayPractice(practiceRows, todayStart)
    const { todayFailuresByPhase, todayFailuresTotal, emptyRecordingToday } = computeTodayFailures(tdRows)

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

    // ── 今日新增注册（真注册口径优先）──
    // 真注册 = auth.users 非匿名·有邮箱（get_registration_stats RPC）。原 profiles 计数把匿名也算进来、虚高
    // （实测 7/28 profiles 13 / 真注册 3）。RPC 未接入（迁移未跑）时回退 profiles 计数并置 pending，
    // 前端据此在卡上标注「含匿名·待迁移生效」，不静默显错数。
    const registration = await registrationPromise
    const newRegistrationsToday   = registration ? registration.todayCount : profilesTdRows.length
    const newRegistrationsPending = registration === null

    // ── 区间口径：迷你统计 / 假空率 / 按服务 / 按环节 ──
    const { avgDailyCalls, p50Latency, p95Latency, errorRate, avgDailyCost, failedCost, estimateRatio }
      = computeRangeStats(rngRows, rangeDays)
    const { fakeEmpty, fakeEmptyPending } = computeFakeEmpty(rngRows)
    const serviceTotals = computeServiceTotals(rngRows)
    const phaseTotals   = computePhaseTotals(rngRows)

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

    // ── 每日序列（费用趋势 / 失败 / 参与度共用同一套日期轴，勿各算各的）──
    const dayBuckets    = buildDayBuckets(rangeStartDate, rangeDays)
    const dailyData     = computeDailyData(rngRows, dayBuckets)
    const dailyFailures = computeDailyFailures(rngRows, dayBuckets)
    // 每日新增注册映射（RPC 并发结果）：null = 迁移未跑/出错，下方 newReg 整条置 null，前端降级不画该线。
    const dailyReg = await dailyRegPromise
    const { engagementTrend, windowActiveSet } = computeEngagement({ rngRows, practiceRows, dayBuckets, activeMap, dailyReg })

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

    // ── 各环节耗时（分布 + 趋势）/ 今日状况条 / 今日小时分布 ──
    const { phaseLatency, latencyTrend } = computeLatency(rngRows, dayBuckets)
    const todayStatus = computeTodayStatus({ rngRows, todayStart, phaseLatency })
    const hourlyData  = computeHourlyData(rngRows, todayStart)

    // 留存 RPC 结果（与主查询并发、自带降级）：null = 迁移未跑/出错，前端显降级态。
    const retention = await retentionPromise
    // 激活漏斗 / W1 首周留存（0047，与主查询并发、自带降级）：null = 迁移 0047 未跑/出错，前端漏斗对应段走降级态。
    const activation      = await activationPromise
    const weeklyRetention = await weeklyRetentionPromise
    // 反馈待办（并发结果，自带降级、恒有值）：未处理全量 + 已处理近 20 + handledSupported / loadFailed 标记。
    const feedback = await feedbackPromise
    // 用户区扩充（2026-08-04 方案 §四）：cohort 回访，失败降级 null、不 500。
    const cohortReturns = await cohortPromise
    // 这块的取数触顶 = 最新那批数据被丢弃、人数偏低（口径没错、数据不全），故【不并入
    // dataTruncated】——后者专指 api_usage_logs 的金额偏低，前端文案与它一一对应，混在一起两边都说不清。
    // 与金额那条同一条纪律：触顶绝不静默，打错误日志 + 随响应返标志、由 UI 明说方向（偏低）。
    if (cohortReturns?.truncated) {
      logErr('[dashboard API]', new Error(`cohort 回访取数${TRUNCATION_LOG_HINT}`))
    }

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
      // 自带 truncated：true = 取数触顶、注册与回访人数均偏低，前端在该块顶部明说（不静默）。
      cohortReturns,
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
      // 成本口径「剔除自测流量」的起算日（0059 生效日）：此日之前的行无法回溯标记、仍混着产品方自测，
      // 前端据此在费用区打一行口径小字（别拿起算日前后做同比）。唯一真源见 COST_QA_BASELINE_START。
      costQaBaselineStart: COST_QA_BASELINE_START,
    })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[dashboard API]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : '查询失败' }, { status: 500 })
  }
}
