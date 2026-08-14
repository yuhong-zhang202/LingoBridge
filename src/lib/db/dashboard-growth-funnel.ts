/**
 * @module   db/dashboard-growth-funnel
 * @desc     【仅服务端】产品增长指标·主题一「七步主线漏斗」的数据层：
 *             ① 七步漏斗人数（RPC get_growth_funnel，0064）+ 相邻转化率 / 掉幅最大一级（TS 纯函数）；
 *             ② 漏斗注脚·只浏览未动手的注册用户数（RPC get_funnel_browse_only，0064）；
 *             ③ 漏斗注脚·匹配质量 / 出题停留 / 反馈卡（flow_events 表级聚合，纯函数可单测）；
 *             ④ 额度墙转化与沉默（RPC get_quota_wall_stats，0064）。
 *
 *   【降级纪律】每个 fetcher 独立 try/catch、失败一律返 null，绝不 reject 拖垮整条 route；
 *   route 据此置 xxxPending 让前端标「降级中」。范式逐字对齐 dashboard-metrics 的
 *   newRegistrationsPending / activationPending —— **绝不静默显示一个错数**。
 *
 *   ⚠️ 窗口与剔除口径见 dashboard-growth-shared 顶注（与主看板差一天、与 0047 那批不同源）。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import 'server-only'
import type { getSupabaseServer } from '@/lib/supabase-server'
import { isInternalAccount } from '@/lib/internal-accounts'
import { fetchAllRows } from '@/lib/db/dashboard-shared'
import { GROWTH_EXCLUDE_IDS, growthWindowStart, ratePct, ratio2, toCount } from '@/lib/db/dashboard-growth-shared'

/** service_role 客户端类型（route 传入；flow_events 无 select 策略，只有 service_role 读得到） */
type SupabaseServer = ReturnType<typeof getSupabaseServer>

// ══════════════════════════════════════════════════════════════════════════════
// ① 七步主线漏斗
// ══════════════════════════════════════════════════════════════════════════════

/** get_growth_funnel（0064）返回行：step_key 见迁移里的七步目录 */
export type FunnelStepRow = { step_index: number | string; step_key: string; users: number | string }

/**
 * 七步的中文名（只在看板显示，故放展示层旁边而非 SQL 里 —— SQL 只给稳定的 step_key，
 * 改文案不该动迁移）。key 与 0064 的 steps 目录逐字对应，漏一个会显示成生 key（可发现）。
 */
const FUNNEL_STEP_LABEL: Record<string, string> = {
  signup:           '建号',
  story_told:       '讲故事',
  corpus_built:     '语料建成',
  matched:          '匹配到题',
  question_opened:  '打开题目',
  practice_started: '开始练习',
  feedback_card:    '拿到反馈卡',
}

/**
 * 每一步读的是【表】还是【埋点】—— 决定该步在跨越埋点起算日的窗口里可不可信。
 *
 * 【为什么必须由后端给，不许 UI 侧自己写一份】UI 若自抄一份 step→source 映射，
 * 它与 0064 的 SQL 会各自漂移，而漂移**不报任何错**：只会让「跨源不可比」标错格
 * —— 把可信的一级标成不可比、或把失真的一级标成可比，两种都比不标更坏。
 *
 * 【怎么对应】逐字对着 0064 的七个 CTE 数据源：
 *   signup           → consent_records  表
 *   story_told       → flow_events      埋点  ← 2026-08-02 起才有
 *   corpus_built     → corpus           表
 *   matched          → flow_events      埋点
 *   question_opened  → flow_events      埋点
 *   practice_started → practice_sessions表
 *   feedback_card    → flow_events      埋点
 * ⚠️ 改 0064 里任何一步的数据源时【必须同步改这里】，否则看板会照旧标注、且没人会发现。
 */
const FUNNEL_STEP_SOURCE: Record<string, 'table' | 'flow'> = {
  signup:           'table',
  story_told:       'flow',
  corpus_built:     'table',
  matched:          'flow',
  question_opened:  'flow',
  practice_started: 'table',
  feedback_card:    'flow',
}

/** 漏斗的一步 */
export type FunnelStep = {
  /** 1-based 步号，与 0064 的 step_index 一致 */
  index: number
  /** 稳定 key（'signup' | 'story_told' | ...） */
  key: string
  /** 中文名；key 不在清单里时回落成 key 本身（可发现，不静默） */
  label: string
  /** 该步窗口内去重 user_id 人数 */
  users: number
  /**
   * 该步的数据来源：'table' = 读数据库表（内测第一天就有数据）；
   * 'flow' = 读 flow_events 埋点（**2026-08-02 才上线**，早于此的窗口段为空）。
   * 窗口跨起算日时，相邻两步 source 不同 ⇒ 二者【不可相减】，转化率不可当结论。
   * key 不在清单里时回落 'flow'（保守：宁可多标一个「不可比」，不可漏标）。
   */
  source: 'table' | 'flow'
  /** 相对上一步的转化率（0-100，1 位小数）；第 1 步与上一步为 0 人时 null */
  convFromPrev: number | null
  /** 相对上一步流失的人数；第 1 步为 null。负数 = 本步人数反超上一步（见下方说明） */
  lostFromPrev: number | null
}

/** 七步漏斗整块结果 */
export type GrowthFunnel = {
  steps: FunnelStep[]
  /**
   * 掉幅最大那一级的【下标】= 流失发生后落到的那一步的 step_index（2~7）。
   * 例：值为 4 表示「第 3 步 → 第 4 步」这一级掉得最多。
   * 全部步为 0 人、或没有任何一级出现正向流失时为 null（绝不返回一个假的 2）。
   */
  biggestDropIndex: number | null
}

/**
 * 把 RPC 的七行原始人数派生成漏斗结构：补中文名、算相邻两步转化率、找掉幅最大的一级。
 *
 * 【为什么「掉幅」按人数而不按百分比】内测期每步都是个位数，百分比在小分母下是假精度
 * （本项目反复吃过这个亏：40-59 分档全堆在一个点上、cohort 表刻意只给分子分母不给百分比）。
 * 按【流失人数】排，得到的是「哪一级真的丢了最多人」，这才是能产生行动的那个数。
 * 并列时取【靠前】那一级：越靠前的漏损影响后面所有步，先修它。
 *
 * 【人数为什么可能反超上一步（lostFromPrev 为负）】七步来自五张不同的表/事件，各自的口径缺口
 * 不同（第 1/3/6 步剔不掉无痕自测、第 7 步只记主动结束），且窗口内可能有人在窗口之前就完成了
 * 前置步骤。⇒ 本漏斗【不是严格嵌套的集合链】，出现负流失属正常，不要在这里"修正"成 0
 * —— 那会把一个真实的口径信号抹掉。反超的那一级不参与「掉幅最大」的评选（它没在掉）。
 *
 * @param rows  get_growth_funnel 的返回行（缺行也能跑：缺的步按 0 人补齐并保持 1~7 的顺序）
 * @returns     七步 + 掉幅最大一级的下标
 */
export function deriveFunnel(rows: readonly FunnelStepRow[]): GrowthFunnel {
  // 按 step_index 归位：RPC 已 order by，但不依赖它（少一行就整条错位是最难查的一类 bug）
  const byIndex = new Map<number, FunnelStepRow>()
  for (const row of rows) byIndex.set(toCount(row.step_index), row)

  const ORDER = ['signup', 'story_told', 'corpus_built', 'matched', 'question_opened', 'practice_started', 'feedback_card']
  const steps: FunnelStep[] = []
  let prevUsers: number | null = null
  for (let i = 0; i < ORDER.length; i++) {
    const index = i + 1
    const row = byIndex.get(index)
    const key = row?.step_key ?? ORDER[i]
    const users = row ? toCount(row.users) : 0
    steps.push({
      index,
      key,
      label: FUNNEL_STEP_LABEL[key] ?? key,
      users,
      // 回落 'flow' 是【保守选择】：未知来源当成"可能是埋点"，宁可多标一个不可比
      source: FUNNEL_STEP_SOURCE[key] ?? 'flow',
      convFromPrev: prevUsers === null ? null : ratePct(users, prevUsers),
      lostFromPrev: prevUsers === null ? null : prevUsers - users,
    })
    prevUsers = users
  }

  let biggestDropIndex: number | null = null
  let biggestDrop = 0
  for (const step of steps) {
    // 只在【真的掉了人】的级里选（lost > 0），并列取靠前那一级（严格大于才替换）
    if (step.lostFromPrev !== null && step.lostFromPrev > biggestDrop) {
      biggestDrop = step.lostFromPrev
      biggestDropIndex = step.index
    }
  }
  return { steps, biggestDropIndex }
}

/**
 * 取七步主线漏斗（RPC get_growth_funnel，0064）。
 * 迁移未跑 / RPC 出错时【优雅降级】返回 null，route 据此置 funnelPending、前端标「降级中」。
 * @param supabase    service_role 客户端
 * @param windowDays  窗口天数（RPC 内为闭区间 [今日-N, 今日]，见 shared 顶注）
 * @returns           漏斗结构；不可用时 null
 */
export async function fetchGrowthFunnel(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<GrowthFunnel | null> {
  try {
    const { data, error } = await supabase.rpc('get_growth_funnel', {
      p_window_days: windowDays,
      p_exclude_user_ids: GROWTH_EXCLUDE_IDS,
    })
    if (error) return null
    const rows = (Array.isArray(data) ? data : []) as FunnelStepRow[]
    if (rows.length === 0) return null
    return deriveFunnel(rows)
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 漏斗注脚·只浏览未动手的注册用户
// ══════════════════════════════════════════════════════════════════════════════

/** get_funnel_browse_only（0064）返回单行 */
type BrowseOnlyRow = {
  page_view_users: number | string
  core_active_users: number | string
  browse_only_users: number | string
}

/**
 * 「只浏览未动手」注脚：三个数一起给，才解释得清这个差是怎么来的。
 * ⚠️ browseOnlyUsers 是【同一批注册用户】的真集合差（SQL 里用 except），不是两个人数相减。
 */
export type BrowseOnlyStats = {
  /** 窗口内有 page.view 的注册用户数 */
  pageViewUsers: number
  /** 窗口内核心活跃的注册用户数（本批口径，剔内部账户与 is_qa） */
  coreActiveUsers: number
  /** 前者减去后者的集合差 = 来看了、但一件事都没动手做的注册用户 */
  browseOnlyUsers: number
}

/**
 * 取「只浏览未动手的注册用户数」（RPC get_funnel_browse_only，0064）。
 * 迁移未跑 / RPC 出错时返回 null，route 置 pending、前端标「降级中」。
 * @param supabase    service_role 客户端
 * @param windowDays  窗口天数
 * @returns           三个人数；不可用时 null
 */
export async function fetchBrowseOnly(
  supabase: SupabaseServer,
  windowDays: number,
): Promise<BrowseOnlyStats | null> {
  try {
    const { data, error } = await supabase.rpc('get_funnel_browse_only', {
      p_window_days: windowDays,
      p_exclude_user_ids: GROWTH_EXCLUDE_IDS,
    })
    if (error) return null
    const row = Array.isArray(data) ? (data[0] as BrowseOnlyRow | undefined) : (data as BrowseOnlyRow | null)
    if (!row) return null
    return {
      pageViewUsers:   toCount(row.page_view_users),
      coreActiveUsers: toCount(row.core_active_users),
      browseOnlyUsers: toCount(row.browse_only_users),
    }
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ③ 漏斗注脚·匹配质量 / 出题停留 / 反馈卡（flow_events 表级聚合）
// ══════════════════════════════════════════════════════════════════════════════

/** 本块要读的三个事件（下推到 SQL 的 .in()，与聚合里的 switch 逐字对应） */
export const QUALITY_EVENTS = ['match.view_rendered', 'match.question_opened', 'flow.practice_ended'] as const

/** flow_events 的最小读取形状（只取聚合用得上的四列，绝不 select *） */
export type QualityEventRow = {
  event: string
  props: Record<string, unknown> | null
  is_qa: boolean | null
  user_id: string | null
}

/** 匹配质量注脚（挂漏斗第 4 步） */
export type MatchQuality = {
  /** 窗口内 match.view_rendered 总次数 */
  rendered: number
  /** 其中 noMatch=true 的次数（一次都没匹配上） */
  noMatch: number
  /** noMatch / rendered × 100；rendered=0 时 null */
  noMatchRate: number | null
}

/** 出题与停留注脚（挂漏斗第 5 步） */
export type QuestionQuality = {
  /** match.view_rendered 的 candidateCount 之和 = 一共给用户出了多少道题 */
  candidateTotal: number
  /** match.question_opened 次数 = 点开了多少道 */
  opened: number
  /**
   * 点开前在匹配页的停留时长【中位数】(ms)；无带 dwellMs 的样本时 null。
   * ⚠️ 刻意用中位数不用均值：一个挂着页面去吃饭的样本就能把均值拉到几十分钟。
   */
  dwellMedianMs: number | null
}

/** 反馈卡注脚（挂漏斗第 7 步） */
export type FeedbackQuality = {
  /** 窗口内有过 flow.practice_ended 的去重人数（= 人均的分母） */
  endedUsers: number
  /** 这些人一共攒下多少张反馈卡（polishedCount 之和） */
  cardTotal: number
  /** 人均反馈卡数（2 位小数）；endedUsers=0 时 null */
  cardsPerUser: number | null
  /** 其中一张卡都没攒下的人数（该人窗口内全部 practice_ended 的 polishedCount 合计为 0） */
  zeroCardUsers: number
}

/** 漏斗质量注脚整块 */
export type FunnelQuality = {
  match: MatchQuality
  question: QuestionQuality
  feedback: FeedbackQuality
  /** true = 分页触顶，本块【次数与人数均偏低】（被截掉的永远是最新那批）。UI 必须明说，绝不静默 */
  truncated: boolean
}

/** 取 props 里的有限数值；非数字 / 缺失一律 undefined（与服务端 sanitize 同款「不容错」立场） */
function pickNum(props: Record<string, unknown> | null, key: string): number | undefined {
  const v = props?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * 中位数（偶数个取中间两个的均值，四舍五入到整数）。
 * @param values  样本（可乱序，函数内部排序、不改入参）
 * @returns       中位数；空样本 null
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return Math.round(sorted[mid])
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * 聚合漏斗质量注脚（纯函数，可单测）。逐行剔 QA（is_qa=true）与内部账户
 * —— 与 RPC 侧的剔除口径同源，两边缺一边就会出现"漏斗人数剔了、注脚次数没剔"的错配。
 *
 * ⚠️【0 卡人数的口径】= 窗口内有过 practice_ended、且其【全部】场次的 polishedCount 合计为 0 的人。
 *    不是「有一场是 0 卡」——那种人下一场攒到了卡，不该被算成"什么都没攒下"。
 * ⚠️【本块所有分母都基于 flow.practice_ended，而它只记主动点结束的场次】
 *    （关标签页不上报，见 event-schema 该条目）。⇒ endedUsers 系统性偏低，
 *    人均卡数是「主动结束的人」的人均，不是全体练习者的人均。
 * ⚠️【candidateTotal 与 opened 不构成点击率】前者是"出了多少道题"（一次渲染出 N 道），
 *    后者是"点开了多少次"，一次渲染可以点开多道、也可以一道都不点。相除得到的数没有稳定含义。
 *
 * @param rows  窗口内三类事件的全部行（含 QA，函数内部剔）
 * @returns     三块注脚（不含 truncated —— 那是取数元信息，由 fetchFunnelQuality 组装）
 */
export function aggregateFunnelQuality(rows: readonly QualityEventRow[]): Omit<FunnelQuality, 'truncated'> {
  let rendered = 0
  let noMatch = 0
  let candidateTotal = 0
  let opened = 0
  const dwells: number[] = []
  // user_id → 该人窗口内 polishedCount 合计（practice_ended 无归属的行不计人、见下）
  const cardsByUser = new Map<string, number>()
  let cardTotal = 0

  for (const row of rows) {
    if (row.is_qa === true) continue
    if (row.user_id != null && isInternalAccount(row.user_id)) continue
    switch (row.event) {
      case 'match.view_rendered': {
        rendered += 1
        // props 里没带 noMatch 的行（多数成功匹配都不带）算作"匹配上了"，与 0064 SQL 的
        // `is distinct from 'true'` 逐字同义。
        if (row.props?.['noMatch'] === true) noMatch += 1
        candidateTotal += pickNum(row.props, 'candidateCount') ?? 0
        break
      }
      case 'match.question_opened': {
        opened += 1
        const dwell = pickNum(row.props, 'dwellMs')
        // dwellMs=0 是合法值（一眼即点，见 QuestionOpenedProps 注释），故用 !== undefined 判存在
        if (dwell !== undefined) dwells.push(dwell)
        break
      }
      case 'flow.practice_ended': {
        const cards = pickNum(row.props, 'polishedCount') ?? 0
        cardTotal += cards
        // 无归属的行仍计入 cardTotal（卡确实产生了），但归不到人 ⇒ 不进人均的分母。
        // 这会让人均略偏高；方向已知，且无归属行在有会话要求的埋点里本就极少。
        if (row.user_id != null) cardsByUser.set(row.user_id, (cardsByUser.get(row.user_id) ?? 0) + cards)
        break
      }
      default:
        break
    }
  }

  let zeroCardUsers = 0
  for (const total of cardsByUser.values()) if (total === 0) zeroCardUsers += 1
  const endedUsers = cardsByUser.size

  return {
    match: { rendered, noMatch, noMatchRate: ratePct(noMatch, rendered) },
    question: { candidateTotal, opened, dwellMedianMs: median(dwells) },
    feedback: { endedUsers, cardTotal, cardsPerUser: ratio2(cardTotal, endedUsers), zeroCardUsers },
  }
}

/**
 * 取漏斗质量注脚整块：窗口内三类 flow_events 行，内存聚合。
 * ⚠️ 刻意【不新增 RPC】——这三块是纯计数/中位数，没有跨表 join 也不需要 auth.users，
 *    少一个 DB 对象就少一个攻击面（0064 那批只在"非它不可"的地方才建函数）。
 * 取数走 fetchAllRows（本项目唯一分页范式）；触顶置 truncated 交给 UI 明说，绝不静默少报。
 * @param supabase    service_role 客户端
 * @param windowDays  窗口天数
 * @param now         当前时刻（可注入，便于测试日界）
 * @returns           三块注脚 + truncated；查询失败时 null
 */
export async function fetchFunnelQuality(
  supabase: SupabaseServer,
  windowDays: number,
  now: Date = new Date(),
): Promise<FunnelQuality | null> {
  try {
    const start = growthWindowStart(now, windowDays)
    const res = await fetchAllRows<QualityEventRow>(() => supabase
      .from('flow_events')
      .select('event, props, is_qa, user_id')
      .in('event', [...QUALITY_EVENTS])
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }))
    if (res.error) return null
    return { ...aggregateFunnelQuality(res.data), truncated: res.truncated }
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ④ 额度墙
// ══════════════════════════════════════════════════════════════════════════════

/** get_quota_wall_stats（0064）返回单行 */
export type QuotaWallRow = {
  wall_users: number | string
  converted_users: number | string
  silent_users: number | string
  mature_users: number | string
}

/** 额度墙转化与沉默（口径锁死，见 0064 函数 ③ 注释） */
export type QuotaWallStats = {
  /** 近 30 天撞上试用额度墙的去重人数（quota.reached 且 variant='trial'）。
   *  ⚠️ 撞墙窗口 30 天与观察期 7 天是两个独立口径，见 0064 的拍板段，别对齐。 */
  wallUsers: number
  /** 其中撞墙后 7×24 小时内注册了的人数 */
  convertedUsers: number
  /** 其中撞墙后 7×24 小时内没有任何 flow_events 的人数 */
  silentUsers: number
  /**
   * 其中【观察期已满 7×24 小时】的人数。
   * ⚠️ matureUsers ≪ wallUsers 时，下面两个率都还没定型（后面几天才会发生的注册/活动还没被算进来），
   *    别当结论用。前端必须把这个数显示出来。
   */
  matureUsers: number
  /** 转化率（0-100，1 位小数）；wallUsers=0 时 null */
  conversionRate: number | null
  /** 沉默率（0-100，1 位小数）；wallUsers=0 时 null */
  silentRate: number | null
}

/**
 * 由 RPC 单行派生额度墙比率（纯函数，可单测）。
 *
 * 🔴【quota.cta='close' 绝不可作为「被劝退」的证据 —— 本结构里刻意没有它】
 *   关闭是关掉弹层的唯一方式（点遮罩 / Esc 都记 close），是必然动作、不是意愿信号；
 *   拿它当劝退率会得到一个接近 100%、永远不变的数。判据只能是撞墙【之后】的真实行为，
 *   即这里的 converted（注册了）与 silent（什么都没做）。
 *
 * @param row  get_quota_wall_stats 的单行返回
 * @returns    四个人数 + 两个比率
 */
export function deriveQuotaWall(row: QuotaWallRow): QuotaWallStats {
  const wallUsers      = toCount(row.wall_users)
  const convertedUsers = toCount(row.converted_users)
  const silentUsers    = toCount(row.silent_users)
  const matureUsers    = toCount(row.mature_users)
  return {
    wallUsers,
    convertedUsers,
    silentUsers,
    matureUsers,
    conversionRate: ratePct(convertedUsers, wallUsers),
    silentRate:     ratePct(silentUsers, wallUsers),
  }
}

/**
 * 取额度墙统计（RPC get_quota_wall_stats，0064）。【不随看板 range 变】——两个窗口都由产品方
 * 锁死，跟随 range 就是改口径：
 *   · 撞墙窗口 **30 天**（产品方 2026-08-14 拍板由 7 改 30）
 *   · 观察期    **7 天**（撞墙后 7×24 小时内是否注册 / 是否沉默）
 * ⚠️ 这两个数【刻意不同】，别为了"看起来一致"把 30 改回 7 —— 两个窗口都取 7 天时
 *    平均只走完一半观察期，转化率被稀释到接近真值的一半。全文见 0064 的拍板段。
 * 迁移未跑 / RPC 出错时返回 null，route 置 pending、前端标「降级中」。
 * @param supabase  service_role 客户端
 * @returns         额度墙统计；不可用时 null
 */
export async function fetchQuotaWall(supabase: SupabaseServer): Promise<QuotaWallStats | null> {
  try {
    const { data, error } = await supabase.rpc('get_quota_wall_stats', {
      p_exclude_user_ids: GROWTH_EXCLUDE_IDS,
    })
    if (error) return null
    const row = Array.isArray(data) ? (data[0] as QuotaWallRow | undefined) : (data as QuotaWallRow | null)
    if (!row) return null
    return deriveQuotaWall(row)
  } catch {
    return null
  }
}
