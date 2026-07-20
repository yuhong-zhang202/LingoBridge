/**
 * @module   concurrency-gate.test
 * @desc     并发闸行为守卫 —— 钉死三条硬边界：并发上限生效、队列满立即拒绝、等待超时拒绝。
 *           另钉「名额过户不丢不多」与「快路径零排队」。用小参数（并发 2 / 队列 3 / 超时 50ms）跑真实时序，不用假定时器。
 * @author   LingoBridge
 * @created  2026-07-20
 */
import { createConcurrencyGate, type AcquireResult } from '@/lib/concurrency-gate'

/** 造一个可由测试手动兑现的 Promise，用来精确控制任务何时结束 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

/** 断言 acquire 成功并取出 release（收窄联合类型） */
function expectOk(r: AcquireResult): () => void {
  expect(r.ok).toBe(true)
  if (!r.ok) throw new Error('unreachable')
  return r.release
}

describe('并发闸 · 并发上限', () => {
  test('前 maxConcurrent 个立即拿到名额，第 N+1 个必须等待', async () => {
    const gate = createConcurrencyGate({ maxConcurrent: 2, maxQueue: 3, maxWaitMs: 1000 })

    const r1 = expectOk(await gate.acquire())
    expectOk(await gate.acquire())
    expect(gate.activeCount).toBe(2)

    let thirdSettled = false
    const third = gate.acquire().then((r) => { thirdSettled = true; return r })

    // 让出若干微任务：第三个仍不该被放行
    await Promise.resolve()
    await Promise.resolve()
    expect(thirdSettled).toBe(false)
    expect(gate.queuedCount).toBe(1)

    r1()                                     // 归还一个名额 → 第三个才被放行
    expectOk(await third)
    expect(gate.activeCount).toBe(2)         // 名额是「过户」，总量不变
    expect(gate.queuedCount).toBe(0)
  })

  test('同时在飞数量任何时刻都不超过上限', async () => {
    const gate = createConcurrencyGate({ maxConcurrent: 4, maxQueue: 50, maxWaitMs: 5000 })
    let inFlight = 0
    let peak = 0

    await Promise.all(
      Array.from({ length: 20 }, async () => {
        const release = expectOk(await gate.acquire())
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight -= 1
        release()
      }),
    )

    expect(peak).toBe(4)
    expect(gate.activeCount).toBe(0)         // 全部归还，无泄漏
    expect(gate.queuedCount).toBe(0)
  })
})

describe('并发闸 · 队列满立即拒绝（不无界排队）', () => {
  test('在飞占满 + 队列占满后，再来的请求立刻拿到 queue_full，不进入等待', async () => {
    const gate = createConcurrencyGate({ maxConcurrent: 2, maxQueue: 3, maxWaitMs: 1000 })
    const releases = [expectOk(await gate.acquire()), expectOk(await gate.acquire())]

    const queued = [gate.acquire(), gate.acquire(), gate.acquire()]   // 占满队列 3
    await Promise.resolve()
    expect(gate.queuedCount).toBe(3)

    const overflow = await gate.acquire()                             // 第 6 个
    expect(overflow).toEqual({ ok: false, reason: 'queue_full' })
    expect(gate.queuedCount).toBe(3)                                  // 被拒者没有占用队列

    releases.forEach((r) => r())
    const granted = await Promise.all(queued.slice(0, 2))
    granted.forEach((g) => expectOk(g)())
    const last = expectOk(await queued[2])
    last()
  })
})

describe('并发闸 · 等待超时拒绝', () => {
  test('排队超过 maxWaitMs 仍未轮到 → timeout，且从队列中移除', async () => {
    const gate = createConcurrencyGate({ maxConcurrent: 1, maxQueue: 5, maxWaitMs: 50 })
    const release = expectOk(await gate.acquire())

    const waiting = gate.acquire()
    await Promise.resolve()
    expect(gate.queuedCount).toBe(1)

    expect(await waiting).toEqual({ ok: false, reason: 'timeout' })
    expect(gate.queuedCount).toBe(0)         // 超时者必须出队，否则名额会被过户给已放弃的等待者

    // 超时之后归还名额：不应把名额过户给已超时者，active 正常回落
    release()
    expect(gate.activeCount).toBe(0)
  })

  test('在超时之前被放行的等待者拿到名额，不会再被超时改判', async () => {
    const gate = createConcurrencyGate({ maxConcurrent: 1, maxQueue: 5, maxWaitMs: 60 })
    const release = expectOk(await gate.acquire())

    const waiting = gate.acquire()
    await new Promise((r) => setTimeout(r, 10))
    release()

    const granted = expectOk(await waiting)
    await new Promise((r) => setTimeout(r, 80))   // 越过原超时点
    expect(gate.activeCount).toBe(1)              // 仍持有，未被超时逻辑误伤
    granted()
    expect(gate.activeCount).toBe(0)
  })
})

describe('并发闸 · 快路径与健壮性', () => {
  test('无排队时 acquire 不产生等待（同一轮事件循环内即完成）', async () => {
    const gate = createConcurrencyGate({ maxConcurrent: 4, maxQueue: 20, maxWaitMs: 15_000 })
    const d = deferred()
    setTimeout(() => d.resolve(), 0)          // 宏任务：若 acquire 走了定时器路径就会晚于它

    let acquiredFirst = false
    await Promise.race([
      gate.acquire().then(() => { acquiredFirst = true }),
      d.promise,
    ])

    expect(acquiredFirst).toBe(true)
  })

  test('release 重复调用无效，不会凭空多出名额', async () => {
    const gate = createConcurrencyGate({ maxConcurrent: 1, maxQueue: 2, maxWaitMs: 100 })
    const release = expectOk(await gate.acquire())

    release()
    release()
    release()

    expect(gate.activeCount).toBe(0)          // 不会变成负数
    const again = expectOk(await gate.acquire())
    expect(gate.activeCount).toBe(1)
    again()
  })
})
