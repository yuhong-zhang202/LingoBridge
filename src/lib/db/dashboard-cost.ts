/**
 * @module   db/dashboard-cost
 * @desc     【仅服务端】经营看板的【金额与调用量】聚合 —— 三张费用卡、区间迷你统计、
 *           按服务分组、按环节成本与失败率。2026-08-14 自 `api/dashboard/route.ts` 原样抽出
 *           （逐字未改、只换位置）：那个文件当时 739 行、逼近 ENGINEERING 的 1000 行红线，
 *           而这些都是无副作用的纯计算，与「取数并组装响应」这件事本身无关。
 *
 *   ⚠️ 每个函数体里的注释都是【口径定义】（为什么算这些行、为什么两个口径刻意不同），
 *      搬运时一字未动。改动前先确认看板上依赖它的那一栏该不该跟着变。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import 'server-only'
import {
  AttribRow,
  CostRow,
  PHASE_META,
  RangeRow,
  SERVICE_META,
  TodayRow,
  isSystemError,
  percentile,
  r2,
  resolvePhase,
} from '@/lib/db/dashboard-shared'

/** 三张费用卡（全时段 / 本月含环比 / 今日）的聚合结果 */
export type CostCards = {
  allTimeCost: number; allTimeCalls: number
  monthCost: number; monthCalls: number; monthLabel: string; monthChange: number | null
  todayCost: number; todayCalls: number
}

/**
 * 聚合三张费用卡（全时段累计 / 本月 + 上月环比 / 今日）。
 * @param input.allRows  全时段归因行（累计卡 + 按用户成本共用同一次查询）
 * @param input.mRows    本月行（东八区月界）
 * @param input.lmRows   上月行（环比分母）
 * @param input.tdRows   今日行（东八区日界）
 * @param input.nowHk    「UTC 字段 = 香港墙上时钟」的时刻，用于取本月标签
 * @returns              三张费用卡所需的全部数字
 */
export function computeCostCards(input: {
  allRows: AttribRow[]; mRows: CostRow[]; lmRows: CostRow[]; tdRows: TodayRow[]; nowHk: Date
}): CostCards {
  const { allRows, mRows, lmRows, tdRows, nowHk } = input
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
  return { allTimeCost, allTimeCalls, monthCost, monthCalls, monthLabel, monthChange, todayCost, todayCalls }
}

/** 区间窗口的迷你统计（调用量 / 延迟分位 / 错误率 / 日均费用 / 白烧 / 估算占比） */
export type RangeStats = {
  avgDailyCalls: number; p50Latency: number; p95Latency: number; errorRate: number
  avgDailyCost: number; failedCost: number; estimateRatio: number
}

/**
 * 聚合区间窗口的迷你统计。
 * @param rngRows    区间内全部日志行
 * @param rangeDays  区间天数（7/14/30），日均口径的分母
 * @returns          迷你统计各项
 */
export function computeRangeStats(rngRows: RangeRow[], rangeDays: number): RangeStats {
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
  return { avgDailyCalls, p50Latency, p95Latency, errorRate, avgDailyCost, failedCost, estimateRatio }
}

/** 按服务分组的成本与调用数（图例色随口径常量走） */
export type ServiceTotal = { service: string; name: string; color: string; cost: number; calls: number }

/**
 * 按 service 分组聚合区间成本与调用次数（服务清单以 SERVICE_META 为准，无数据的服务给 0 而非缺项）。
 * @param rngRows  区间内全部日志行
 * @returns        与 SERVICE_META 键序一致的分组数组
 */
export function computeServiceTotals(rngRows: RangeRow[]): ServiceTotal[] {
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
  return serviceTotals
}

/** 按环节聚合的成本 / 调用 / 失败次数 / 失败率 / 白烧成本 */
export type PhaseTotal = {
  phase: string; name: string; cost: number; calls: number
  errors: number; errorCost: number; errorRate: number
}

/**
 * 按 metadata.phase 聚合区间成本与失败（降序按成本）。
 * @param rngRows  区间内全部日志行
 * @returns        按成本降序的环节聚合数组
 */
export function computePhaseTotals(rngRows: RangeRow[]): PhaseTotal[] {
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
  return phaseTotals
}
