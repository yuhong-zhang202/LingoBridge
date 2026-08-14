/**
 * @module   db/dashboard-trends
 * @desc     【仅服务端】经营看板的【每日序列】聚合 —— 共用日期轴、每日费用趋势、每日失败次数、
 *           每日参与度趋势（活跃 + 场次 + 新增注册）、今日小时分布。2026-08-14 自
 *           `api/dashboard/route.ts` 原样抽出（逐字未改、只换位置）。
 *
 *   ⚠️ 三张图【必须】共用 buildDayBuckets 生成的同一套日期轴（理由见该函数体内注释）：
 *      各自单独生成的话，某天无数据时横轴会错位对不上。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import 'server-only'
import { HK_OFFSET_MS, PracticeRow, RangeRow, hkDayKey, isSystemError, r2 } from '@/lib/db/dashboard-shared'

/** 日期轴的一格：key 为分桶键（年-月(0基)-日），date 为展示标签（月/日） */
export type DayBucket = { key: string; date: string }

/**
 * 生成区间内每一天的「分桶键 + 展示标签」骨架（费用趋势 / 每日失败 / 耗时趋势 / 参与度共用）。
 * @param rangeStartDate  区间首日 0 点对应的 UTC 时刻
 * @param rangeDays       区间天数（7/14/30）
 * @returns               升序的日期轴
 */
export function buildDayBuckets(rangeStartDate: Date, rangeDays: number): DayBucket[] {
  // 区间内每一天的「分桶键 + 展示标签」骨架：费用趋势、每日失败、耗时趋势三处共用同一套日期轴，
  // 各自单独生成的话，某天无数据时三张图的横轴会错位对不上。
  const dayBuckets = Array.from({ length: rangeDays }, (_, i) => {
    const hk = new Date(rangeStartDate.getTime() + i * 24 * 60 * 60 * 1000 + HK_OFFSET_MS)
    return {
      key:   `${hk.getUTCFullYear()}-${hk.getUTCMonth()}-${hk.getUTCDate()}`,
      date:  `${hk.getUTCMonth() + 1}/${hk.getUTCDate()}`,
    }
  })
  return dayBuckets
}

/** 每日费用趋势的一格（按服务拆分 + 合计） */
export type DailyCostPoint = { date: string; doubao_asr: number; qwen_flash: number; qwen_plus: number; total: number }

/**
 * 每日费用趋势（按东八区分桶，与日期轴对齐）。
 * @param rngRows     区间内全部日志行
 * @param dayBuckets  共用日期轴
 * @returns           每日各服务成本 + 合计
 */
export function computeDailyData(rngRows: RangeRow[], dayBuckets: DayBucket[]): DailyCostPoint[] {
  // ── 每日趋势（rangeDays 天，升序，按东八区分桶） ──
  // ── 每日趋势（rangeDays 天，升序，按东八区分桶） ──
  const dailyMap = new Map<string, Record<string, number>>()
  for (const row of rngRows) {
    const key = hkDayKey(row.created_at)
    if (!dailyMap.has(key)) dailyMap.set(key, {})
    const entry = dailyMap.get(key)!
    entry[row.service] = (entry[row.service] ?? 0) + row.estimated_cost_cny
    entry['total']     = (entry['total']     ?? 0) + row.estimated_cost_cny
  }

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
  return dailyData
}

/**
 * 每日失败次数（口径只数系统故障，与日期轴对齐）。
 * @param rngRows     区间内全部日志行
 * @param dayBuckets  共用日期轴
 * @returns           每日故障次数序列
 */
export function computeDailyFailures(rngRows: RangeRow[], dayBuckets: DayBucket[]): Array<{ date: string; failures: number }> {
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
  return dailyFailures
}

/** 每日参与度趋势的一格；newReg 整条为 null 即降级态（前端不渲染这条线） */
export type EngagementPoint = { date: string; activeUsers: number; practiceSessions: number; newReg: number | null }

/** 参与度聚合结果：趋势序列 + 窗口内 AI-only 去重活跃集合（漏斗③的第 3 级降级源） */
export type EngagementResult = { engagementTrend: EngagementPoint[]; windowActiveSet: Set<string> }

/**
 * 每日参与度趋势（活跃人数 + 练习场次 + 新增注册），并顺带算出窗口内 AI-only 去重活跃集合。
 * @param input.rngRows       区间内全部日志行
 * @param input.practiceRows  区间内 practice_sessions 行
 * @param input.dayBuckets    共用日期轴
 * @param input.activeMap     每日活跃权威映射（核心活跃 0047 → 活跃注册 0045）；null 走标记去重降级
 * @param input.dailyReg      每日真注册映射（0044）；null 时 newReg 整条置 null
 * @returns                   趋势序列 + windowActiveSet（调用方据此做漏斗③的回退值）
 */
export function computeEngagement(input: {
  rngRows: RangeRow[]; practiceRows: PracticeRow[]; dayBuckets: DayBucket[]
  activeMap: Map<string, number> | null; dailyReg: Map<string, number> | null
}): EngagementResult {
  const { rngRows, practiceRows, dayBuckets, activeMap, dailyReg } = input
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

  const practiceByDay = new Map<string, number>()
  for (const row of practiceRows) {
    const key = hkDayKey(row.created_at)
    practiceByDay.set(key, (practiceByDay.get(key) ?? 0) + 1)
  }

  const engagementTrend = dayBuckets.map(({ key, date }) => ({
    date,
    // 活跃人数：三级降级——activeMap（核心活跃 0047 → 活跃注册 0045）可用时取当天格；
    // null（两级 RPC 皆缺失/出错）回退旧标记去重 activeUsersByDay。
    activeUsers:      activeMap ? (activeMap.get(key) ?? 0) : (activeUsersByDay.get(key)?.size ?? 0),
    practiceSessions: practiceByDay.get(key) ?? 0,
    newReg:           dailyReg ? (dailyReg.get(key) ?? 0) : null,
  }))
  return { engagementTrend, windowActiveSet }
}

/**
 * 今日小时分布（从区间行里筛今日，按东八区取小时桶）。
 * @param rngRows     区间内全部日志行
 * @param todayStart  今日 0 点对应的 UTC 时刻（东八区日界）
 * @returns           24 格的小时调用次数
 */
export function computeHourlyData(rngRows: RangeRow[], todayStart: Date): Array<{ hour: string; calls: number }> {
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
  return hourlyData
}
