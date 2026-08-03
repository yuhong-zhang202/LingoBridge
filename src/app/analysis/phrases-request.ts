/**
 * @module   phrases-request
 * @desc     「换档词组」客户端请求封装 —— 给 POST /api/analysis/phrases 附加 20 秒客户端超时，
 *           并把传输层失败二分为 timeout（客户端超时主动中断）/ network（连接断等真网络 reject），
 *           供分析页埋点分桶（AI_RESULT 既有的 timeout / network 两桶）与行内失败态使用。
 *           独立成模块的原因：超时判定是纯逻辑，抽出来才能在 node 环境单测（本仓 jest 无 jsdom，页面组件不可渲染测）。
 * @author   LingoBridge
 * @created  2026-08-04
 */

/**
 * 客户端超时阈值。依据（2026-08-04 生产实测，phrases 环节近 30 天 77 次成功）：
 * 服务端 p50=9.0s / p90=12.4s / p95=13.7s / 最慢 16.2s → 20s = 历史最慢 + 传输余量。
 * 为什么不是最初提议的 12s：12s 低于 p90=12.4s，会把一成以上的正常生成误杀成超时。
 * 这个超时兜的是「服务端已生成但响应在网络上丢了」（生产实证：服务端 8.6s 已成功，
 * 客户端却干等 20.5s 才记 network 失败、且无重试入口），不是催服务端更快。
 */
export const PHRASES_TIMEOUT_MS = 20_000

/** 传输层失败种类：timeout=20s 客户端超时主动 abort；network=连接失败/请求没发出去等真网络层 reject */
export type PhrasesFailureKind = 'timeout' | 'network'

/**
 * 换档词组请求的传输层失败（带埋点分桶用的 kind）。
 * 非 2xx 响应【不属于】此类——那是正常 resolve，状态码分流归调用方。
 */
export class PhrasesRequestError extends Error {
  /** 失败种类，调用方据此把埋点分别落进 timeout / network 桶（混了就没法归因：一个指向调阈值，一个指向查链路） */
  readonly kind: PhrasesFailureKind

  constructor(kind: PhrasesFailureKind) {
    super(kind === 'timeout' ? '换词请求超时' : '换词网络失败')
    this.name = 'PhrasesRequestError'
    this.kind = kind
  }
}

/**
 * 发起换档词组请求，附 PHRASES_TIMEOUT_MS 客户端超时（AbortController 主动中断）。
 * @param  doFetch  实际发请求的函数（生产传 apiFetch 闭包并把 signal 挂到请求上；测试注入 fake）
 * @returns         原始 Response（含非 2xx；ok 判定与状态码分流归调用方）
 * @throws          PhrasesRequestError —— 超时（kind='timeout'）或网络层失败（kind='network'）
 * @sideEffect      挂一个 20s 定时器，settle 后必清（不留悬挂 abort 误伤后续）
 */
export async function fetchPhrasesWithTimeout(
  doFetch: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), PHRASES_TIMEOUT_MS)
  try {
    return await doFetch(ac.signal)
  } catch {
    // 只有两种走到这：定时器已 abort（=超时）或 fetch 自身 reject（=网络层失败）
    throw new PhrasesRequestError(ac.signal.aborted ? 'timeout' : 'network')
  } finally {
    clearTimeout(timer)
  }
}
