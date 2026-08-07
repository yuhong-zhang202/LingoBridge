/**
 * @module   client-events-outbox.test
 * @desc     埋点补发队列（outbox）的红线守卫。队列的价值是补回「没有会话时被丢弃的事件」，
 *           而它的风险全在【归属】与【无限增长】上，故本文件钉死的不是「能补发」，而是这五条：
 *             1) 无 token → 事件进队列【不丢】（改动前是直接 return 丢弃，正是 session_failed 系统性偏低的成因）；
 *             2) 下次有 token → 被补发，且带上 queueDelaySec（落库时间≠发生时间，没它按天统计会歪）；
 *             3) 🔴 登出 / 换账号（clearAuthCache）→ 队列【整个清空】。共用设备上不清 = 把 A 的行为
 *                记到 B 头上，事后无法分离也无法发现 —— 这是全文件最关键的一条；
 *             4) 超过上限 → 丢【最旧】的，队列长度封顶（无上限的本地队列会被异常态撑大）；
 *             5) 存储不可用（隐私模式 / 配额满）→ 不崩、退回「丢弃」的既有行为。
 *           另钉两条投递纪律：补发失败【不回队】（每条最多投两次，绝不重复计数、绝不无限重试打爆接口）、
 *           4xx（除 401）不入队（事件本身不合契约，重发多少次都一样）。
 *           【不 mock api-client】：track → apiFetch → fetch 全走真实实现、只打桩最外层 fetch，
 *           验的是真实请求形态而不是几个 mock 的自洽（沿用 qa-flag-client-events.test.ts 的做法）。
 *           jest 默认 node 环境无 window/localStorage，沿用同一套垫片写法。
 * @author   LingoBridge
 * @created  2026-08-07
 */
jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn(), ensureSession: jest.fn() }))

import { track, clearAuthCache } from '@/lib/client-events'
import { getSupabase } from '@/lib/supabase'

/** 与 client-events.ts 的 OUTBOX_KEY 逐字一致；改那边必须同步改这里（否则本文件会全绿地失效） */
const OUTBOX_KEY = 'lingobridge:event_outbox'
/** 与 client-events.ts 的 OUTBOX_MAX 一致 */
const OUTBOX_MAX = 20

/** 最小 storage 垫片（node 环境无 window/localStorage）；可注入「读/写抛错」模拟存储不可用 */
function makeStorage(opts: { failWrite?: boolean; failRead?: boolean } = {}): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => {
      if (opts.failRead) throw new Error('storage disabled')
      return map.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (opts.failWrite) throw new Error('QuotaExceededError')
      map.set(k, v)
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size },
  } as Storage
}

let fetchMock: jest.Mock
/** 当前 session 的 access_token；null = 没有会话。用可变量以便同一个测试里前后切换。 */
let currentToken: string | null = null

/** 装好 window / storage / fetch 垫片 */
function setup(token: string | null, storageOpts: { failWrite?: boolean; failRead?: boolean } = {}): Storage {
  const ls = makeStorage(storageOpts)
  const ss = makeStorage()
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { location: { search: '' }, localStorage: ls, sessionStorage: ss }
  g.localStorage = ls
  g.sessionStorage = ss
  currentToken = token
  fetchMock = jest.fn(() => Promise.resolve(new Response('{"ok":true}', { status: 200 })))
  g.fetch = fetchMock
  ;(getSupabase as jest.Mock).mockReturnValue({
    auth: {
      getSession: () => Promise.resolve({
        data: { session: currentToken ? { access_token: currentToken } : null },
      }),
    },
  })
  return ls
}

/** track 是 fire-and-forget（同步返回 void），要把挂起的微任务放完才能断言 */
function flush(): Promise<void> {
  return new Promise((r) => setImmediate(r))
}

/** 读当前队列（原始形态：[{ body, at }]）；无队列返回空数组 */
function readQueue(): Array<{ body: { event: string; props: Record<string, unknown> }; at: number }> {
  const raw = localStorage.getItem(OUTBOX_KEY)
  return raw ? JSON.parse(raw) : []
}

/** 本次所有 fetch 的请求体（已解析） */
function sentBodies(): Array<{ event: string; storyId: string | null; props: Record<string, unknown> }> {
  return fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body))
}

afterEach(() => {
  // clearAuthCache 顺带清掉模块级 Authorization 缓存，免得上一条用例的 token 漏进下一条
  clearAuthCache()
  const g = globalThis as unknown as Record<string, unknown>
  delete g.window
  delete g.localStorage
  delete g.sessionStorage
  delete g.fetch
  jest.restoreAllMocks()
  jest.clearAllMocks()
})

describe('1) 无 token —— 事件进队列，一条都不丢', () => {
  test('拿不到会话时不发请求，但事件被暂存（改动前这里是直接丢弃）', async () => {
    setup(null)
    track('flow.phrase_collect_failed', { reason: 'session_failed', view: 'mobile' })
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    const q = readQueue()
    expect(q).toHaveLength(1)
    expect(q[0].body.event).toBe('flow.phrase_collect_failed')
    expect(q[0].body.props).toEqual({ reason: 'session_failed', view: 'mobile' })
    expect(typeof q[0].at).toBe('number')
  })

  test('多条无会话事件按顺序累积', async () => {
    setup(null)
    track('flow.feedback_rendered', { cardCount: 0, view: 'mobile' })
    track('flow.practice_ended', { turns: 3, polishedCount: 2 })
    await flush()
    expect(readQueue().map((i) => i.body.event)).toEqual(['flow.feedback_rendered', 'flow.practice_ended'])
  })
})

describe('2) 下次有 token —— 补发且带上延迟秒数', () => {
  test('补发的事件带 queueDelaySec（整数秒），当次事件不带', async () => {
    const nowSpy = jest.spyOn(Date, 'now')
    setup(null)
    nowSpy.mockReturnValue(1_000_000_000_000)
    track('flow.phrase_collect_failed', { reason: 'session_failed', view: 'mobile' })
    await flush()
    expect(readQueue()).toHaveLength(1)

    // 90 秒后拿到了会话，再发一条新事件 → 顺手把旧的补发出去
    currentToken = 'tok-abc'
    nowSpy.mockReturnValue(1_000_000_090_400)
    track('flow.feedback_rendered', { cardCount: 2, view: 'desktop' })
    await flush()

    const bodies = sentBodies()
    expect(bodies).toHaveLength(2)
    const resent = bodies.find((b) => b.event === 'flow.phrase_collect_failed')
    const fresh  = bodies.find((b) => b.event === 'flow.feedback_rendered')
    // 补发那条：原 props 一字不改，只多一个 queueDelaySec（90.4s → 取整 90）
    expect(resent?.props).toEqual({ reason: 'session_failed', view: 'mobile', queueDelaySec: 90 })
    // 当场发的那条：绝不许带这个字段（带了就等于把「补发」和「当场发」混成一格）
    expect(fresh?.props).toEqual({ cardCount: 2, view: 'desktop' })
    // 补发后队列必须清空
    expect(readQueue()).toEqual([])
  })

  test('补发失败【不回队】—— 每条最多投两次，绝不无限重试打爆接口', async () => {
    setup(null)
    track('flow.practice_ended', { turns: 1, polishedCount: 1 })
    await flush()
    expect(readQueue()).toHaveLength(1)

    currentToken = 'tok-abc'
    // 第 1 次 fetch = 当次事件（成功，这才会触发补发）；第 2 次 = 补发请求（网络断）
    fetchMock
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
      .mockRejectedValueOnce(new Error('network down'))
    track('page.view', { route: 'feedback' })
    await flush()
    expect(readQueue()).toEqual([])
  })

  test('当次事件自己都没送到（401 / 网络断）时【不补发】—— 别挑最不该丢的时候烧掉队列', async () => {
    setup(null)
    track('flow.practice_ended', { turns: 1, polishedCount: 1 })
    await flush()

    currentToken = 'tok-过期了'
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    track('page.view', { route: 'feedback' })
    await flush()

    // 只发了当次那一条（收 401），队列不但没被烧掉，还多了收 401 的这条
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readQueue().map((i) => i.body.event)).toEqual(['flow.practice_ended', 'page.view'])
  })

  test('超龄（>24h）的队列条目在补发前被丢掉，不发出去', async () => {
    const nowSpy = jest.spyOn(Date, 'now')
    setup(null)
    nowSpy.mockReturnValue(1_000_000_000_000)
    track('flow.practice_ended', { turns: 1, polishedCount: 1 })
    await flush()

    currentToken = 'tok-abc'
    nowSpy.mockReturnValue(1_000_000_000_000 + 24 * 3600 * 1000 + 1000) // 24h + 1s
    track('page.view', { route: 'feedback' })
    await flush()

    expect(sentBodies().map((b) => b.event)).toEqual(['page.view'])
    expect(readQueue()).toEqual([])
  })
})

describe('3) 🔴 登出 / 换账号 —— 队列必须被清空（防归属串人）', () => {
  test('clearAuthCache 后队列为空，且后续有会话时一条都不补发', async () => {
    setup(null)
    track('flow.phrase_collected', { nth: 1, view: 'mobile' })
    track('flow.practice_ended', { turns: 5, polishedCount: 4 })
    await flush()
    expect(readQueue()).toHaveLength(2)

    // A 登出 / B 登录：埋点身份态整个丢掉
    clearAuthCache()
    expect(localStorage.getItem(OUTBOX_KEY)).toBeNull()

    // B 上来发一条自己的事件：只应该有这一条，A 的两条绝不许跟着落到 B 头上
    currentToken = 'tok-B'
    track('page.view', { route: 'profile' })
    await flush()
    expect(sentBodies()).toEqual([
      { event: 'page.view', storyId: null, props: { route: 'profile' } },
    ])
  })

  test('存储不可用时 clearAuthCache 也不抛错', () => {
    setup(null, { failRead: true })
    expect(() => clearAuthCache()).not.toThrow()
  })
})

describe('4) 队列封顶 —— 满了丢最旧的', () => {
  test(`超过 ${OUTBOX_MAX} 条时保留最新 ${OUTBOX_MAX} 条，最旧的被丢弃`, async () => {
    setup(null)
    for (let i = 0; i < OUTBOX_MAX + 5; i++) {
      track('flow.practice_ended', { turns: i, polishedCount: 0 })
      // 逐条 await：入队是「读整个队列 → 追加 → 写回」，并发发起时后写的会覆盖先写的，
      // 断言顺序就没意义了。真实链路上埋点也是零散发生的，不是同一 tick 里连发 25 条。
      await flush()
    }
    const q = readQueue()
    expect(q).toHaveLength(OUTBOX_MAX)
    // 最旧的 5 条（turns 0..4）被丢，留下的是 5..24
    expect(q[0].body.props.turns).toBe(5)
    expect(q[q.length - 1].body.props.turns).toBe(OUTBOX_MAX + 4)
  })
})

describe('5) 存储不可用 —— 不崩、退回「丢弃」的既有行为', () => {
  // ⚠️【变异验证记录·2026-08-07】本 describe 里三条的抓错能力【不一样】，别以为都一样硬：
  //   · 「内容被改坏」这条【真的会红】（把 readOutbox 的形态校验拆掉即失败）——脏队列会被当真队列用。
  //   · 「读取抛错」「写入抛错」两条【把对应的 try/catch 拆掉也不会红】，而这【不是测试空转】，
  //     是危害已被结构性消掉，有两层：① track 的整个异步体外面还有一层 fire-and-forget 的 .catch；
  //     ② 补发被刻意排在「当次事件已确认发成功」【之后】，所以队列这边怎么坏都碰不到实时上报。
  //     ⇒ 这两条测的是【端到端不崩 + 实时上报不受连累】这个结果本身，而不是某一层的实现。
  //     ⚠️ 若日后有人把 flushOutbox 挪回当次事件【之前】，这两条就会重新变成承重防线 ——
  //     那时请连同本段注释一起复核（M8 变异已钉住那个顺序，挪了会红）。
  test('写入抛错（隐私模式 / 配额满）→ track 不抛、不发请求、不留队列', async () => {
    setup(null, { failWrite: true })
    expect(() => track('flow.feedback_rendered', { cardCount: 1, view: 'mobile' })).not.toThrow()
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(OUTBOX_KEY)).toBeNull()
  })

  test('读取抛错 → 当作空队列，正常事件照发（一段坏存储不许堵死后续所有上报）', async () => {
    setup('tok-abc', { failRead: true })
    track('page.view', { route: 'feedback' })
    await flush()
    expect(sentBodies().map((b) => b.event)).toEqual(['page.view'])
  })

  test('队列内容被外部改坏（非数组 / 缺字段）→ 当作空队列，不崩', async () => {
    const ls = setup('tok-abc')
    ls.setItem(OUTBOX_KEY, '{"not":"an array"}')
    track('page.view', { route: 'feedback' })
    await flush()
    expect(sentBodies().map((b) => b.event)).toEqual(['page.view'])
    expect(localStorage.getItem(OUTBOX_KEY)).toBeNull()
  })
})

describe('6) 请求失败的入队纪律 —— 只留「下次可能就好了」的那几档', () => {
  test.each([[401], [500], [503]])('HTTP %s → 入队等下次补发（服务端明确没记这一笔）', async (status) => {
    setup('tok-abc')
    fetchMock.mockResolvedValueOnce(new Response('{}', { status }))
    track('flow.practice_ended', { turns: 2, polishedCount: 1 })
    await flush()
    expect(readQueue().map((i) => i.body.event)).toEqual(['flow.practice_ended'])
  })

  test.each([[400], [403], [404]])('HTTP %s → 不入队（事件本身不合契约，重发多少次都一样）', async (status) => {
    setup('tok-abc')
    fetchMock.mockResolvedValueOnce(new Response('{}', { status }))
    track('flow.practice_ended', { turns: 2, polishedCount: 1 })
    await flush()
    expect(readQueue()).toEqual([])
  })

  test('fetch 抛错（网络层失败）→ 入队，且错误不外溢到调用方', async () => {
    setup('tok-abc')
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    expect(() => track('auth.goal_editor_opened', { source: 'card', isFirstTime: true, hasDate: false })).not.toThrow()
    await flush()
    expect(readQueue().map((i) => i.body.event)).toEqual(['auth.goal_editor_opened'])
  })

  test('HTTP 200 → 不入队', async () => {
    setup('tok-abc')
    track('flow.practice_ended', { turns: 2, polishedCount: 1 })
    await flush()
    expect(readQueue()).toEqual([])
  })
})
