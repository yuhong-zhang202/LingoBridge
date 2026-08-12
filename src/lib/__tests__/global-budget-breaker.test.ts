/**
 * @module   lib/global-budget-breaker.test
 * @desc     全局预算熔断的判定层守卫。逐条标注守的是【行为】还是【结构】：
 *           ①【行为】未触线 → 匿名放行；触线 → 匿名 402 且带可判别的 reason。
 *           ②【行为】触线时注册用户照常放行，且**连查都不查**（防误伤，这条最重要）。
 *           ③【行为】读不到今日花费 + 无同日读数 → 放行（失败开放），且不抛。
 *           ④【行为】读不到但有同日旧读数 → 沿用旧读数继续拦（日内花费单调递增，旧读数是下界）。
 *           ⑤【行为】跨了东八区日界的旧读数【绝不可】用来拦人（新的一天从 0 起算）。
 *           ⑥【行为】日界是东八区：跨过香港 00:00 就是新的一天，缓存哪怕只有 3 秒（短于任何一档 TTL）
 *              也必须重查 —— 昨天的花费一分都不许算进今天。
 *           ⑦【行为】两档 TTL：远离阈值 30s 内复用读数；逼近阈值（≥50%）5s 就重查。
 *           ⑧【行为】单飞：并发只发一次查询。
 *           ⑨【行为】判定过程抛异常 → 放行（熔断自己绝不能变成新的故障源）。
 *           ⑩【行为】取数持续失败时按 5s 退避，不把每个请求都变成一次必失败的查询（别当故障放大器）。
 *
 *   所有用例都注入 now，不依赖真实时钟；只 mock「问 DB 拿数」这一层，判定/缓存/日界全部跑真实实现。
 * @author   LingoBridge
 * @created  2026-08-12
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/db/ai-cost-server', () => ({ readTodayAiCostCny: jest.fn() }))

import { GLOBAL_DAILY_BUDGET_BREAKER_CNY } from '@/lib/constants'
import { quotaDayKey } from '@/lib/quota-period'

/** 熔断模块持有进程内缓存，故每个用例都要一份全新的模块实例（连同它的 mock）。 */
async function loadFresh(): Promise<{
  breaker: typeof import('@/lib/global-budget-breaker')
  read: jest.Mock<Promise<number | null>, []>
}> {
  jest.resetModules()
  const costMod = await import('@/lib/db/ai-cost-server')
  const read = costMod.readTodayAiCostCny as unknown as jest.Mock<Promise<number | null>, []>
  read.mockReset()
  const breaker = await import('@/lib/global-budget-breaker')
  return { breaker, read }
}

/** UTC 字面量 → Date。用例注释里同时标出它对应的**香港墙上时钟**（UTC+8）。 */
function hkMoment(utcIso: string): Date {
  return new Date(utcIso)
}

const OVER  = GLOBAL_DAILY_BUDGET_BREAKER_CNY          // 恰好触线（判定用 >=，等于就该断）
const UNDER = GLOBAL_DAILY_BUDGET_BREAKER_CNY - 0.01   // 差一分钱

describe('全局预算熔断 · 触线判定', () => {
  it('① 未触线：匿名放行（返回 null）', async () => {
    const { breaker, read } = await loadFresh()
    read.mockResolvedValue(UNDER)
    expect(await breaker.requireGlobalBudget(true)).toBeNull()
  })

  it('① 恰好触线：匿名被拦，402 + QUOTA_EXCEEDED + reason=global_budget', async () => {
    const { breaker, read } = await loadFresh()
    read.mockResolvedValue(OVER)
    const res = await breaker.requireGlobalBudget(true)
    expect(res).not.toBeNull()
    expect(res?.status).toBe(402)
    const body = (await res?.json()) as { code?: string; reason?: string; error?: string }
    expect(body.code).toBe('QUOTA_EXCEEDED')
    // reason 是「这是全站预算耗尽、不是你的额度用完了」的唯一判别位，前端要区分文案就靠它
    expect(body.reason).toBe('global_budget')
    // 文案与「试用次数已用完」不同（两件事）；客户端 readQuotaReason 不认识 global_budget，
    // 会回退 trial 变体 —— 引导注册对本闸恰好正确（注册用户不受熔断影响）。
    expect(body.error).not.toBe('试用次数已用完，请注册后继续')
  })

  it('② 触线时注册用户照常放行，且一次都不查（防误伤 + 省开销）', async () => {
    const { breaker, read } = await loadFresh()
    read.mockResolvedValue(OVER * 100)
    expect(await breaker.requireGlobalBudget(false)).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
})

describe('全局预算熔断 · 读不到今日花费时的方向', () => {
  it('③ 读失败且无同日读数 → 放行（失败开放），不抛', async () => {
    const { breaker, read } = await loadFresh()
    read.mockResolvedValue(null)
    await expect(breaker.requireGlobalBudget(true)).resolves.toBeNull()
  })

  it('④ 读失败但有同日旧读数（已触线）→ 继续拦（旧读数是当前真值的下界）', async () => {
    const { breaker, read } = await loadFresh()
    const t0 = hkMoment('2026-08-12T10:00:00Z')                 // 香港 18:00
    read.mockResolvedValue(OVER)
    expect(await breaker.requireGlobalBudget(true, t0)).not.toBeNull()
    // TTL 过期后再来，这次读失败
    read.mockResolvedValue(null)
    const t1 = new Date(t0.getTime() + 60_000)
    expect(await breaker.requireGlobalBudget(true, t1)).not.toBeNull()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('⑤ 跨日的旧读数不得用于拦人：香港新一天读失败 → 放行', async () => {
    const { breaker, read } = await loadFresh()
    read.mockResolvedValue(OVER)
    const lastDay = hkMoment('2026-08-12T15:59:50Z')            // 香港 08-12 23:59:50
    expect(await breaker.requireGlobalBudget(true, lastDay)).not.toBeNull()
    read.mockResolvedValue(null)
    const newDay = hkMoment('2026-08-12T16:00:05Z')             // 香港 08-13 00:00:05
    expect(await breaker.requireGlobalBudget(true, newDay)).toBeNull()
  })
})

describe('全局预算熔断 · 日界与缓存', () => {
  it('⑥ 日界按东八区：跨过香港 00:00 即换一天，缓存仍在 TTL 内也必须重查、昨日花费一分不计', async () => {
    // 先把「东八区」这件事本身钉死：香港 00:30 已经是新的一天（UTC 还停在前一天 16:30）
    expect(quotaDayKey(hkMoment('2026-08-12T16:30:00Z'))).toBe('2026-08-13')
    expect(quotaDayKey(hkMoment('2026-08-12T15:30:00Z'))).toBe('2026-08-12')

    const { breaker, read } = await loadFresh()
    read.mockResolvedValue(OVER)                          // 昨天烧超了 → 昨天该拦
    const lastDay = hkMoment('2026-08-12T15:59:59Z')            // 香港 08-12 23:59:59
    expect(await breaker.requireGlobalBudget(true, lastDay)).not.toBeNull()
    expect(read).toHaveBeenCalledTimes(1)

    read.mockResolvedValue(5)                             // 新的一天只花了 5 块
    // 香港 08-13 00:00:02 —— 距上次读数仅 3 秒，**短于任何一档 TTL**（近阈值档也有 5s）。
    // 故这里唯一可能让它重查的原因就是「换天了」：若日键判定被去掉/改成 UTC，缓存必然被判新鲜、
    // 昨天的超支会被算到今天头上，第一个打开产品的人当场吃闭门羹。
    const newDay = hkMoment('2026-08-12T16:00:02Z')
    expect(await breaker.requireGlobalBudget(true, newDay)).toBeNull()
    expect(read).toHaveBeenCalledTimes(2)                 // 没有复用昨天的读数
  })

  it('⑦ 远离阈值：30s 内复用读数，超过才重查', async () => {
    const { breaker, read } = await loadFresh()
    read.mockResolvedValue(1)                             // 远低于 50%
    const t0 = hkMoment('2026-08-12T10:00:00Z')
    await breaker.isGlobalBudgetExhausted(t0)
    await breaker.isGlobalBudgetExhausted(new Date(t0.getTime() + 29_000))
    expect(read).toHaveBeenCalledTimes(1)
    await breaker.isGlobalBudgetExhausted(new Date(t0.getTime() + 31_000))
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('⑦ 逼近阈值（≥50%）：窗口收紧到 5s', async () => {
    const { breaker, read } = await loadFresh()
    read.mockResolvedValue(GLOBAL_DAILY_BUDGET_BREAKER_CNY * 0.5)
    const t0 = hkMoment('2026-08-12T10:00:00Z')
    await breaker.isGlobalBudgetExhausted(t0)
    await breaker.isGlobalBudgetExhausted(new Date(t0.getTime() + 4_000))
    expect(read).toHaveBeenCalledTimes(1)
    await breaker.isGlobalBudgetExhausted(new Date(t0.getTime() + 6_000))
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('⑧ 单飞：并发 5 个请求只查一次', async () => {
    const { breaker, read } = await loadFresh()
    let resolveRead: (v: number) => void = () => {}
    read.mockReturnValue(new Promise<number>((r) => { resolveRead = r }))
    const t0 = hkMoment('2026-08-12T10:00:00Z')
    const all = Promise.all([1, 2, 3, 4, 5].map(() => breaker.isGlobalBudgetExhausted(t0)))
    resolveRead(OVER)
    expect(await all).toEqual([true, true, true, true, true])
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('全局预算熔断 · 绝不成为新的故障源', () => {
  it('⑨ 取数层抛异常 → 按未触线放行，不把主链路带崩', async () => {
    const { breaker, read } = await loadFresh()
    read.mockRejectedValue(new Error('boom'))
    await expect(breaker.isGlobalBudgetExhausted()).resolves.toBe(false)
    await expect(breaker.requireGlobalBudget(true)).resolves.toBeNull()
  })

  it('⑩ 取数持续失败：5s 内的后续请求不再重复打 DB（退避），5s 后才重试', async () => {
    const { breaker, read } = await loadFresh()
    read.mockResolvedValue(null)
    const t0 = hkMoment('2026-08-12T10:00:00Z')
    await breaker.isGlobalBudgetExhausted(t0)
    expect(read).toHaveBeenCalledTimes(1)
    // 退避窗口内连打 4 次，一次 DB 查询都不该多发
    for (const dt of [100, 1_000, 3_000, 4_900]) {
      await breaker.isGlobalBudgetExhausted(new Date(t0.getTime() + dt))
    }
    expect(read).toHaveBeenCalledTimes(1)
    await breaker.isGlobalBudgetExhausted(new Date(t0.getTime() + 5_100))
    expect(read).toHaveBeenCalledTimes(2)
  })
})
