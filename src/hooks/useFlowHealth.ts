/**
 * @module   useFlowHealth
 * @desc     经营看板「客户端链路观测」的数据源 hook —— 按 range 拉独立子路由
 *           /api/dashboard/flow-health，与主看板 /api/dashboard 解耦（这边挂了不影响主看板）。
 *
 *   【为什么是一个 hook 而不是各块自己 fetch】同一份数据要喂两个分居不同区块的消费者
 *   （「出事了吗」里的 AI 结局分布 + 「看板自己还准吗」里的埋点自检）。React 的 <details>
 *   始终渲染 children，收起区块里的组件同样会 mount —— 各自 fetch 等于必然的双份请求，
 *   且两块的加载/错误态还得各说各话。父层拉一次、把同一个 state 传给两块最简单。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

// ── 与 lib/db/dashboard-flow-events 的返回结构对齐（客户端不 import server-only 模块）──
/** 一次 AI 调用结局的归属分类（决定「该找谁」） */
export type AiResultBucket = 'ok' | 'user' | 'ours' | 'network' | 'aborted' | 'other' | 'missing'

/** 某 stage 下某 result 的计数 */
export type AiResultStat = { result: string; label: string; bucket: AiResultBucket; count: number; qaCount: number }

/** 单个 AI 阶段的结局分布与成功率 */
export type AiStageStat = {
  stage: string; name: string; attempts: number
  ok: number; userSide: number; ourSide: number; networkSide: number; otherSide: number
  aborted: number; missingResult: number; successRate: number | null; qaRows: number
  results: AiResultStat[]
}

/** 单个埋点事件名的计数（everSeen=false ⇒ 全库从未出现过该事件，「待首次触发」而非「坏了」） */
export type EventCountStat = { event: string; label: string; count: number; qaCount: number; known: boolean; everSeen: boolean }

/** 单个枚举取值的计数 */
export type EnumValueStat = { value: string; count: number; qaCount: number; expected: boolean }

/** 单个枚举字段的取值覆盖 */
export type EnumFieldCoverage = {
  key: string; label: string; event: string; field: string
  eventRows: number; eventRowsQa: number; missing: number; missingQa: number
  values: EnumValueStat[]
}

/** 「该我们修」桶最近一条失败明细（S4 下钻；窗口内无该桶失败时 null） */
export type LatestOursFailure = { stageName: string; result: string; createdAt: string }

/** 「客户端链路观测」整块的返回结构 */
export type FlowHealth = {
  windowDays: number; windowStart: string; baselineStart: string
  preBaselineRows: number; totalRows: number; qaRows: number; truncated: boolean
  aiCall: AiStageStat[]; eventCounts: EventCountStat[]; enumCoverage: EnumFieldCoverage[]
  latestOurs: LatestOursFailure | null
}

/** hook 返回的三态 + 重试入口（两个消费区块共用同一份，保证口径与状态一致） */
export type FlowHealthState = {
  data: FlowHealth | null
  loading: boolean
  error: boolean
  reload: () => void
}

/**
 * 按 range 拉「客户端链路观测」数据。
 * @param range  时间范围参数（'7d' | '14d' | '30d'，跟随看板的区间选择器）
 * @returns      { data, loading, error, reload }
 * @sideEffect   range / reload 变化时发起 fetch；卸载或 range 变化时 abort 上一次请求
 */
export function useFlowHealth(range: string): FlowHealthState {
  const [data, setData] = useState<FlowHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(false)
    ;(async () => {
      try {
        const res = await apiFetch(`/api/dashboard/flow-health?range=${range}`, { signal: ac.signal })
        if (ac.signal.aborted) return
        if (!res.ok) { setError(true); setLoading(false); return }
        const d = (await res.json()) as FlowHealth
        if (ac.signal.aborted) return
        setData(d); setLoading(false)
      } catch {
        if (ac.signal.aborted) return          // 中断不算错误，忽略
        setError(true); setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [range, reloadKey])

  return { data, loading, error, reload: () => setReloadKey(k => k + 1) }
}
