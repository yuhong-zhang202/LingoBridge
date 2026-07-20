/**
 * @module   concurrency-gate
 * @desc     通用进程内并发闸 —— 把「同时在飞的任务数」压在上限内，超出的排队等待。
 *           三个硬边界：并发上限、队列长度上限（拒绝无界排队）、单请求最长等待（拒绝无限等）。
 *           用于给有并发配额的上游（如豆包 ASR 极速版并发限额 5）做客户端侧限流。
 *
 *           ⚠️ 局限：状态只存在于**当前进程内存**。当前 Zeabur 部署为单实例（1/1），故全局有效。
 *              将来若横向扩容到多实例，每个实例都会各自持有一份 maxConcurrent 配额，
 *              总并发 = 实例数 × maxConcurrent，仍会撞上游上限。届时须换成 Redis 等
 *              跨进程共享信号量（或改由网关层限流），本模块的接口可保持不变。
 * @author   LingoBridge
 * @created  2026-07-20
 */

/** 拒绝原因：队列已满 / 等待超时。调用方据此给不同文案 */
export type GateRejectReason = 'queue_full' | 'timeout'

/**
 * acquire 的结果。刻意用「返回值」而非抛异常表达拒绝：
 * 拒绝是可预期的背压，不是故障，不该和调用方 catch 里的真错误混在一起。
 */
export type AcquireResult =
  | { readonly ok: true;  readonly release: () => void }
  | { readonly ok: false; readonly reason: GateRejectReason }

export interface ConcurrencyGateOptions {
  /** 同时在飞的最大任务数 */
  readonly maxConcurrent: number
  /** 最多允许多少个任务在队列里等（不含在飞的）。超出立即拒绝，绝不无界排队 */
  readonly maxQueue: number
  /** 单个任务在队列里最长等多久（毫秒），超时即拒绝 */
  readonly maxWaitMs: number
}

export interface ConcurrencyGate {
  /**
   * 申请一个执行名额
   * @returns  ok=true 时带 release（必须在 finally 里调用，否则名额永久泄漏）；
   *           ok=false 时带拒绝原因，此时**无需**也**不可**调用 release
   */
  acquire(): Promise<AcquireResult>
  /** 当前在飞数量（仅供测试与观测） */
  readonly activeCount: number
  /** 当前排队数量（仅供测试与观测） */
  readonly queuedCount: number
}

/** 队列中的等待者。settle 保证只被兑现一次（授予与超时存在竞态） */
interface Waiter {
  settle(result: AcquireResult): void
  timer: ReturnType<typeof setTimeout>
}

/**
 * 创建一个并发闸
 * @param options  并发上限 / 队列上限 / 最长等待
 * @returns        闸门实例（状态私有，进程内共享）
 */
export function createConcurrencyGate(options: ConcurrencyGateOptions): ConcurrencyGate {
  const { maxConcurrent, maxQueue, maxWaitMs } = options
  let active = 0
  const waiters: Waiter[] = []

  /**
   * 生成一次性的名额归还函数
   * @returns  release 回调；重复调用无效（防止 double-release 把名额凭空变多）
   */
  function makeRelease(): () => void {
    let used = false
    return (): void => {
      if (used) return
      used = true
      // 名额直接「过户」给队首等待者：此时 active 不变，避免先减后加的窗口里挤进新请求
      const next = waiters.shift()
      if (!next) {
        active -= 1
        return
      }
      clearTimeout(next.timer)
      next.settle({ ok: true, release: makeRelease() })
    }
  }

  return {
    get activeCount(): number { return active },
    get queuedCount(): number { return waiters.length },

    async acquire(): Promise<AcquireResult> {
      // 快路径：没排队时零额外开销 —— 不建定时器、不进队列，正常流量下与没有闸门无异
      if (active < maxConcurrent) {
        active += 1
        return { ok: true, release: makeRelease() }
      }
      if (waiters.length >= maxQueue) {
        return { ok: false, reason: 'queue_full' }
      }
      return new Promise<AcquireResult>((resolve) => {
        let settled = false
        const waiter: Waiter = {
          settle(result: AcquireResult): void {
            if (settled) return
            settled = true
            resolve(result)
          },
          timer: setTimeout(() => {
            const i = waiters.indexOf(waiter)
            if (i >= 0) waiters.splice(i, 1)
            waiter.settle({ ok: false, reason: 'timeout' })
          }, maxWaitMs),
        }
        waiters.push(waiter)
      })
    },
  }
}
