/**
 * @module   global-budget-breaker
 * @desc     【仅服务端】全局预算熔断 —— 今日（东八区）全站 AI 花费触线后，拒绝**匿名会话**的新 AI 调用。
 *           注册用户完全不受影响。接线方式：各花钱路由在自己既有额度闸的正前方调 requireGlobalBudget()。
 *
 *   【为什么要它】其余每一道防线都建立在「猜对方会怎么来」之上：每日额度按账号计、终身闸按账号计、
 *   并发闸按进程计 —— 而匿名账号可以无限创建（清一次存储就是一个新号）。本闸是唯一一条**与攻击手段无关**
 *   的止损：不管对方用什么方式，只要今天全站总花费触线就停。它不替代任何既有闸，是它们全部失效时的底。
 *
 *   ⚠️【买保险，不是救火】2026-08-12 审计与复查均确认目前无任何攻击痕迹（392 个匿名账号里 324 个是
 *   零事件垃圾号；匿名 14 天合计仅花 ¥4.68 ≈ ¥0.33/天）。故本闸的设计取向一律是**宁可漏断，不可误伤**：
 *   每一处不确定都往「放行」偏，理由见下面各条。
 *
 *   ── 判定口径 ──
 *   「今日总花费」= 迁移 0063 的 global_ai_cost_today_cny()，三条口径全在 SQL 侧、与看板成本口径同义：
 *   东八区日界（沿用 quota-period / 0026 / 0062 的同一套，不新造第三套）、剔 is_qa 自测、剔内部账户。
 *   TS 侧只用 quotaDayKey() 给缓存条目打日戳，与 SQL 的日界是同一个东八区口径。
 *
 *   ── 便宜的判定路径（每个 AI 请求都要过，不能每次去数一遍全表）──
 *   进程内单值缓存 + 两档 TTL + 单飞（并发只发一次查询）：
 *     · 远离阈值（< 50%）→ TTL 30s；逼近阈值（≥ 50%）→ TTL 5s。
 *       两档而非一档：平时几乎零查询开销，危险区才把窗口收紧到「超支上界可忽略」。
 *     · 单次查询实测 0.5ms（本机 20 万行 PG 实例，见交付说明），即使退化成每请求一查也不贵；
 *       缓存是为了不给 DB 平白加一倍 QPS，不是因为查询本身贵。
 *
 *   ── 缓存窗口内可能超支多少（上界估算）──
 *   峰值花费速率的主导项是豆包 ASR（占匿名成本 94~97%，¥0.003/音频秒），而它被 transcribe 的并发闸
 *   压在 2 并发；按实测「约 44 秒音频 / 约 3 秒往返」≈ 15 倍实时速率算，ASR 峰值 ≈ 2 × 15 × ¥0.003 ≈ ¥0.09/秒；
 *   千问各路无并发闸，按同数量级放宽一倍，取**峰值 ≈ ¥0.2/秒**作估算上界。于是：
 *     · 危险区（≥¥30）窗口 5s → 触线后最多再花 ≈ ¥1；
 *     · 远离区窗口 30s 最多推进 ≈ ¥6，从 <¥30 一步跨过 ¥60 需要 ¥0.52/秒（远高于上述峰值），故不可达；
 *     · 另加「已经过闸、正在飞的请求」，由各路由自身并发决定，量级同上。
 *   ⚠️ 这是**估算**不是实测：¥0.2/秒来自两个推算（ASR 实时倍率、千问放宽一倍），没有压测数据支撑。
 *   它成立与否只影响「超线后多花几块钱」，不影响闸本身是否生效。
 *
 *   ── 多实例 ──
 *   与 concurrency-gate 不同：**本闸的真源在 DB，不在进程内**，故扩到 N 实例后依然全局有效
 *   （各实例读的是同一个 sum）。唯一的退化是各实例各有一个 TTL 窗口，上面的超支上界要乘以 N。
 *   即：扩容会让它变钝，不会让它失效。（部署文档 §12 的「扩容前置清单」里已补记这一条。）
 *
 *   ── 读不到今日花费时的方向：失败开放（但先用同日旧读数）──
 *   顺序是：① 同日的历史读数还在 → 用它（**日内花费单调递增，同日旧读数必是当前真值的下界**，
 *   据它拦人不可能误伤）；② 连同日读数都没有（进程刚起 / 刚跨日 / 首次就失败）→ **放行**。
 *   为什么放行，三条理由，比 readLifetimeUsageServer 当初那条更强：
 *     · 后果不对称（同 72d1be0 的论证）：失败关闭的最坏后果是一次瞬时抖动就把「今天体验名额用完了」
 *       发给第一次打开产品的匿名用户 —— 掐掉唯一的转化主路径，且用户无从重试、不可证伪；
 *       失败开放的最坏后果只是退回改动前的水位，而那正是产品已经承受了几个月、实测零攻击的风险。
 *     · **DB 真挂了的时候根本花不出钱**：每条花钱路由在 AI 调用之前都要先过 bumpDailyUsageServer /
 *       bumpAnonRestructureTodayServer，它们读写同一个库、失败即抛 → 路由 500，AI 一次都不会被调用。
 *       所以「DB 不可用 + 本闸失败开放」不是一个烧钱场景，它已经被别的机制关死了。
 *     · 剩下的唯一场景是「库好着、偏偏这个 RPC 不可用」（迁移未应用 / 被误改 / 权限被收），
 *       那是**持续性**故障而非抖动：失败关闭会把匿名入口关上并且没人会立刻发现（用户只看到一句
 *       文案，不会报障）；失败开放则只是熔断静默缺席 = 改动前的世界，且服务端日志一直在报警。
 *   ⚠️ 代价必须说清：**本闸在「DB 可用但取数 RPC 不可用」时是静默失效的。** 唯一的发现手段是
 *   服务端日志里的 [budget-breaker] 告警，上线后请确认它不常驻。
 *   （告警本身带 5s 退避，见 FAIL_BACKOFF_MS：持续故障时每进程每 5 秒一行，够醒目又不刷屏。）
 *
 *   ── 熔断自己绝不能成为新的故障源 ──
 *   isGlobalBudgetExhausted 整体 try/catch，任何意外一律当「未触线」放行：多花几块钱可以接受，
 *   为了一道保险把全站主链路打挂不可以。
 *
 * @author   LingoBridge
 * @created  2026-08-12
 */
import 'server-only'

import { NextResponse } from 'next/server'
import { logErr } from './log'
import { quotaDayKey } from './quota-period'
import { readTodayAiCostCny } from './db/ai-cost-server'
import { GLOBAL_DAILY_BUDGET_BREAKER_CNY } from './constants'

/** 一次成功读数的快照。dayKey 用东八区日键，跨日即整条作废（新的一天花费从 0 重新算）。 */
interface CostSnapshot {
  dayKey:   string
  costCny:  number
  readAtMs: number
}

/** 远离阈值时的缓存有效期：平时几乎零查询开销。 */
const TTL_FAR_MS = 30_000
/** 逼近阈值时的缓存有效期：把「触线到停住」的窗口收紧到超支可忽略。 */
const TTL_NEAR_MS = 5_000
/** 「逼近」的定义：今日花费达到阈值的这个比例即切到短 TTL。 */
const NEAR_RATIO = 0.5
/**
 * 读失败后的退避间隔。取数一旦持续失败（如迁移未应用、权限被收），若不退避，
 * 每个 AI 请求都会重打一次必失败的 RPC + 打一行告警 —— **一道保险反而成了故障放大器**。
 * 5s 既够快地发现恢复，又把失败期的额外负载压到「每进程每 5 秒一次」。
 */
const FAIL_BACKOFF_MS = 5_000

/** 进程内单值缓存（多实例各存各的；真源在 DB，故不影响全局有效性，只影响窗口大小）。 */
let snapshot: CostSnapshot | null = null
/** 上次读失败的时刻（0 = 最近一次读是成功的）。仅用于退避，不参与任何拦/放判定。 */
let lastFailAtMs = 0
/** 单飞：并发请求共用同一次查询，避免缓存刚过期时对 DB 打出一波齐射。 */
let inFlight: Promise<CostSnapshot | null> | null = null

/**
 * 按当前读数选缓存有效期（越接近阈值窗口越短）。
 * @param  costCny  当前已知的今日花费
 * @returns         该读数可复用的毫秒数
 */
function ttlFor(costCny: number): number {
  return costCny >= GLOBAL_DAILY_BUDGET_BREAKER_CNY * NEAR_RATIO ? TTL_NEAR_MS : TTL_FAR_MS
}

/**
 * 真去查一次并更新缓存。
 * @param  now  当前时刻（可注入，便于测试日界）
 * @returns     新快照；读失败返回 null 且**不动**原有缓存（旧的同日读数还有用，见顶注失败方向）
 */
async function refresh(now: Date): Promise<CostSnapshot | null> {
  // 日键取「发起查询的时刻」：万一恰好跨界，最坏是给新一天的读数打了旧日戳，
  // 下一次请求发现日键对不上即整条作废、重新查一次，方向安全。
  const dayKey = quotaDayKey(now)
  const costCny = await readTodayAiCostCny()
  if (costCny === null) {
    lastFailAtMs = now.getTime()
    logErr('[budget-breaker] 今日花费读取失败：本次按「读不到」处理（详见模块顶注的失败方向）', new Error('READ_TODAY_AI_COST_FAILED'))
    return null
  }
  lastFailAtMs = 0
  snapshot = { dayKey, costCny, readAtMs: now.getTime() }
  return snapshot
}

/**
 * 单飞包装：同一时刻只允许一次在途查询，其余调用方共用它的结果。
 * @param  now  当前时刻
 * @returns     新快照或 null
 */
async function refreshOnce(now: Date): Promise<CostSnapshot | null> {
  if (inFlight) return inFlight
  inFlight = refresh(now)
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

/**
 * 今日（东八区）全站 AI 花费是否已达熔断线。
 *
 * 【只回答「今天全站花超了没有」，不涉及任何单个用户的额度】谁被拦由调用方（requireGlobalBudget）决定。
 *
 * @param  now  当前时刻，默认真实当前（可注入，日界与 TTL 都只看它，测试不依赖真实时钟）
 * @returns     已达熔断线 true；未达 / 读不到且无同日读数 / 内部异常 一律 false（失败开放）
 * @sideEffect  可能发起一次 RPC 查询并更新进程内缓存
 */
export async function isGlobalBudgetExhausted(now: Date = new Date()): Promise<boolean> {
  try {
    const dayKey = quotaDayKey(now)
    const sameDay = snapshot && snapshot.dayKey === dayKey ? snapshot : null
    // 缓存新鲜：直接判。注意 TTL 由**缓存里那个值**决定（越贵窗口越短），不是由阈值本身决定。
    if (sameDay && now.getTime() - sameDay.readAtMs < ttlFor(sameDay.costCny)) {
      return sameDay.costCny >= GLOBAL_DAILY_BUDGET_BREAKER_CNY
    }
    // 刚失败过就先别再打 DB（退避）：持续故障期不把每个请求都变成一次必失败的查询 + 一行告警。
    const backingOff = lastFailAtMs > 0 && now.getTime() - lastFailAtMs < FAIL_BACKOFF_MS
    const fresh = backingOff ? null : await refreshOnce(now)
    if (fresh) return fresh.costCny >= GLOBAL_DAILY_BUDGET_BREAKER_CNY
    // 读失败：退回同日旧读数。日内花费只增不减 ⇒ 旧读数是当前真值的下界 ⇒ 据它拦人不会误伤。
    // 跨日的旧读数绝不能用（新的一天从 0 起算，用了就是把昨天的账算到今天头上、误伤真实用户）。
    const stale = snapshot && snapshot.dayKey === dayKey ? snapshot : null
    if (stale) return stale.costCny >= GLOBAL_DAILY_BUDGET_BREAKER_CNY
    return false
  } catch (err) {
    // 熔断自己绝不能成为新的故障源：任何意外都当「未触线」，宁可多花几块钱也不打断主链路。
    logErr('[budget-breaker] 判定过程异常，按未触线放行', err)
    return false
  }
}

/**
 * 花钱路由的接线点：今日全站预算已耗尽且当前是匿名会话 → 返回拒绝响应；否则返回 null 表示放行。
 * 用法与 requireConsent 同形（`const denied = await requireGlobalBudget(isAnonymous); if (denied) return denied`）。
 *
 * ⚠️【放在哪】一律紧贴该路由**既有额度闸的正前方**（在 bump 计次之前）。两条理由：
 *   ① 既有额度闸的位置已经过深思（哪些失败算数、哪些不算、读档命中要不要计次），复用它的位置
 *      就不必在每条路由上把那套判断重做一遍 —— 也正因如此，matching 的熔断跟着它的 bump 一起
 *      进 `if (!cached)` 分支（读档命中零成本，不该被拦）。
 *   ② 必须在 bump **之前**：被熔断拦下的请求一次 AI 都没调、一分钱没花，若先计了次，
 *      等于让用户为一件没发生的事付出额度。
 *
 * 【响应形态：402 + QUOTA_EXCEEDED + reason:'global_budget'，刻意不新造 code】
 *   · 复用 402/QUOTA_EXCEEDED —— 全站页面已有的 402 分支（matching/analysis/restructure/practice…）
 *     会把它导向「试用额度用尽 → 引导注册」的配额层。这个引导对本闸**恰好是正确的**：
 *     注册用户不受熔断影响，注册确实能立刻继续用。新造 code 则会让所有既有页面落进
 *     「失败，请稍后再试」的通用错误分支 —— 一个死路，且旧客户端缓存页面永远修不好。
 *   · 新增 reason:'global_budget' —— 前端要区分「你的额度用完了」和「今天全站预算用完了」时，
 *     判据在这里，与 practice 已有的 reason:'trial'/'ielts' 是同一套机制，不引入第二套判别方式。
 *     客户端 readQuotaReason 只白名单 'trial'|'story'|'ielts'，未知值回 null → 各页默认 'trial' 变体，
 *     **今天零改动即可优雅降级**。
 *   ⚠️ 用户可见文案确实该与「你的额度用完了」不同（这是两件事），但那属于 UI 改动、要走 ux-reviewer，
 *     不在本次范围内。本次只把可判别的信号留在协议层，前端专属文案单独排期。
 *
 * @param  isAnonymous  当前会话是否匿名（来自 requireUserAllowAnon，服务端权威、不可伪造）
 * @param  now          当前时刻，默认真实当前（透传给判定，便于测试）
 * @returns             需要拒绝时返回 402 响应；放行返回 null
 * @sideEffect          可能发起一次 RPC 查询并更新进程内缓存
 */
export async function requireGlobalBudget(isAnonymous: boolean, now: Date = new Date()): Promise<NextResponse | null> {
  // 注册用户一律不拦：连查都不查（产品方拍板「触发时只拒匿名」），也省掉注册用户路径上的这次判定开销。
  if (!isAnonymous) return null
  if (!(await isGlobalBudgetExhausted(now))) return null
  return NextResponse.json(
    { error: '今天的免费体验名额已经用完了，注册后可继续使用', code: 'QUOTA_EXCEEDED', reason: 'global_budget' },
    { status: 402 },
  )
}
