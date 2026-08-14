/**
 * @module   db/dashboard-today
 * @desc     【仅服务端】经营看板的【今日经营口径】聚合 —— 今日活跃/匿名会话数、今日练习场次
 *           （新练 / 复练拆分）、今日系统故障按环节 + 空录音。2026-08-14 自
 *           `api/dashboard/route.ts` 原样抽出（逐字未改、只换位置）。
 *
 *   ⚠️ 「今日」一律指【东八区日历边界】（调用方按 hkDayStartUtc 折算后传入），不随区间选择器变。
 *      函数体里的注释是各计数的口径定义（尤其「匿名会话数绝不与注册活跃相加」那段），一字未动。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import 'server-only'
import { ERROR_KIND_USER_INPUT } from '@/lib/constants'
import { PracticeRow, TodayRow, isSystemError, todayPhaseName } from '@/lib/db/dashboard-shared'

/** 今日按 is_anonymous 标记去重后的两个人数（口径差异见函数体注释） */
export type TodayIdentity = { registeredActiveFallback: number; anonSessionsToday: number }

/**
 * 今日活跃（注册）与匿名试用会话数：按 user_id 去重后分成匿名 / 注册两侧各自计数。
 * @param tdRows  今日日志行
 * @returns       registeredActiveFallback（注册活跃的【降级兜底】值）+ anonSessionsToday
 */
export function computeTodayIdentity(tdRows: TodayRow[]): TodayIdentity {
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
  return { registeredActiveFallback, anonSessionsToday }
}

/** 今日练习场次（新练 / 复练拆分 + 合计） */
export type TodayPractice = { practiceNew: number; practiceReview: number; practiceTotal: number }

/**
 * 今日练习场次拆分（新练 / 复练）。
 * @param practiceRows  区间内 practice_sessions 行（本函数只取其今日子集）
 * @param todayStart    今日 0 点对应的 UTC 时刻（东八区日界）
 * @returns             新练 / 复练 / 合计
 */
export function computeTodayPractice(practiceRows: PracticeRow[], todayStart: Date): TodayPractice {
  // ── 今日练习场次（新练 / 复练拆分）：practice_sessions 今日子集，按 is_review 分。 ──
  const todayTsForPractice = todayStart.getTime()
  const practiceTdRows   = practiceRows.filter(r => new Date(r.created_at).getTime() >= todayTsForPractice)
  const practiceReview   = practiceTdRows.filter(r => r.is_review).length
  const practiceNew      = practiceTdRows.length - practiceReview
  const practiceTotal    = practiceTdRows.length
  return { practiceNew, practiceReview, practiceTotal }
}

/** 今日故障按环节 + 今日空录音次数（后者不算故障） */
export type TodayFailures = {
  todayFailuresByPhase: Array<{ phase: string; count: number }>
  todayFailuresTotal: number
  emptyRecordingToday: number
}

/**
 * 今日系统故障按环节分组（降序）+ 今日空录音次数。
 * @param tdRows  今日日志行
 * @returns       按环节分组的故障数 + 故障合计 + 空录音次数
 */
export function computeTodayFailures(tdRows: TodayRow[]): TodayFailures {
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
  return { todayFailuresByPhase, todayFailuresTotal, emptyRecordingToday }
}
