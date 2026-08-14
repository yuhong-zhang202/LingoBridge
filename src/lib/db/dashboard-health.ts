/**
 * @module   db/dashboard-health
 * @desc     【仅服务端】经营看板的【服务健康信号】聚合 —— 假空率（空录音真伪）、各环节耗时
 *           （分布 + 趋势）、今日状况条。2026-08-14 自 `api/dashboard/route.ts` 原样抽出
 *           （逐字未改、只换位置）。
 *
 *   ⚠️ 耗时两视图【只取延迟口径断点之后的行】（LATENCY_CUTOFF_TS，见 dashboard-shared 顶注）：
 *      跨断点混算会看到"性能突然变好一半"，那是口径修正不是真变快。断点前的日子给 null 而非 0。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import 'server-only'
import { ERROR_KIND_USER_INPUT } from '@/lib/constants'
import {
  FAKE_EMPTY_PEAK_THRESHOLD,
  LATENCY_CUTOFF_TS,
  PHASE_META,
  RangeRow,
  TREND_PHASE_N,
  hkDayKey,
  isSystemError,
  percentile,
  r2,
} from '@/lib/db/dashboard-shared'
import type { DayBucket } from '@/lib/db/dashboard-trends'

/** 假空率结果：pending=true 表示区间内无带 audio 信号的空录音（前端显「待接入」，不显误导的 0%） */
export type FakeEmptyResult = {
  fakeEmpty: { rate: number; n: number; fakeCount: number } | null
  fakeEmptyPending: boolean
}

/**
 * 假空率（区间内空录音里「采到了声音却转写空」的占比）。
 * @param rngRows  区间内全部日志行
 * @returns        假空率结构（无带信号样本时 null）+ pending 标记
 */
export function computeFakeEmpty(rngRows: RangeRow[]): FakeEmptyResult {
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
  return { fakeEmpty, fakeEmptyPending }
}

/** 单个环节的耗时分布（按 P90 降序排列，刻意不给均值列） */
export type PhaseLatency = { phase: string; name: string; p50: number; p90: number; max: number; calls: number }
/** 单个环节的耗时趋势（断点之前的日子给 null 而非 0，让折线断开） */
export type TrendPhase = {
  phase: string; name: string
  days: Array<{ date: string; p50: number | null; p90: number | null; calls: number }>
}
/** 耗时两视图（分布 + 趋势） */
export type LatencyResult = { phaseLatency: PhaseLatency[]; latencyTrend: TrendPhase[] }

/**
 * 各环节耗时的分布与趋势（只取成功调用、且只取口径断点之后的行）。
 * @param rngRows     区间内全部日志行
 * @param dayBuckets  共用日期轴（趋势与其余两张图对齐）
 * @returns           按 P90 降序的分布 + 最慢前 N 个环节的趋势
 */
export function computeLatency(rngRows: RangeRow[], dayBuckets: DayBucket[]): LatencyResult {
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
  return { phaseLatency, latencyTrend }
}

/** 今日状况条（顶部「一眼看出今天有没有出事」） */
export type TodayStatus = {
  todayFailures: number; avgDailyFailures7: number; avgDailyCost7: number
  slowestPhase: { name: string; p90: number } | null
}

/**
 * 今日状况条：今日故障数 + 近 7 日基线（故障/费用日均）+ 最慢环节。
 * @param input.rngRows       区间内全部日志行
 * @param input.todayStart    今日 0 点对应的 UTC 时刻（东八区日界）
 * @param input.phaseLatency  已按 P90 降序的环节耗时分布（取首项作最慢环节）
 * @returns                   今日状况条各项
 */
export function computeTodayStatus(input: {
  rngRows: RangeRow[]; todayStart: Date; phaseLatency: PhaseLatency[]
}): TodayStatus {
  const { rngRows, todayStart, phaseLatency } = input
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
  return todayStatus
}
