/**
 * @module   api/transcribe/concurrency-gates.test
 * @desc     转写链路两道并发闸的【真实限流能力】守卫 —— 本文件【不替身化】concurrency-gate，
 *           用真闸门 + 真并发请求，钉死四条行为：
 *             ① 转码闸真的把 ffmpeg 压在 2 个（第 3 个并发进不去 ffmpeg，只能等）；
 *             ② ASR 闸真的放到 4 个（不是被 CPU 上限连坐压成 2）；
 *             ③ 两道闸互相独立：转码闸排满时，已过转码的请求照常进 ASR，转码队列也照常轮转；
 *             ④ 被转码闸拦下时【计次/花钱那步没发生】（沿用「排队必须在计次之前」的纪律）。
 *
 *           为什么单开一个文件：route.test.ts 把闸门整个替身化了（为了精确制造两种拒绝），
 *           那种写法能验「接线对不对」，验不了「到底限住了几个」——
 *           2026-08-06 审计 P1-2 那个 bug（闸的理由与位置错配）恰恰是替身测试看不见的一类。
 *
 *           ⚠️ 两道闸是【模块级单例】，本文件所有用例共用同一对闸门：每个用例结束前必须把
 *              阻塞住的请求全部放行并 await 完，否则名额会漏给下一个用例，造成假红/假绿。
 *              这件事**不能只靠用例末尾的 openAll()** —— 断言一旦失败就直接抛，末尾那几行根本执行不到，
 *              于是一个真失败会把后面的用例全带红、掩盖真正的病灶（做变异验证时实测到过）。
 *              故统一由 afterEach 兜底放行 + 排空，用例里的 openAll 只是让断言能在同一个用例里往下走。
 * @author   LingoBridge
 * @created  2026-08-12
 */
jest.mock('server-only', () => ({}))

// 刻意【不】mock @/lib/concurrency-gate —— 本文件要验的就是真闸门。
jest.mock('@/lib/audio/transcode', () => ({ transcodeToWav: jest.fn() }))
jest.mock('@/services/transcription', () => ({ transcribeAudio: jest.fn() }))
jest.mock('@/lib/api-logger', () => ({
  logApiUsage: jest.fn(),
  API_PRICING: { doubao_asr_per_second: 0.0001 },
}))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(),
  authErrorResponse:    jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({ hasRecordedConsent: jest.fn(() => Promise.resolve(true)) }))
jest.mock('@/lib/db/corpus-server', () => ({
  bumpDailyUsageServer:    jest.fn(),
  readDailyUsageServer:    jest.fn(),
  readLifetimeUsageServer: jest.fn(),
}))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

import { POST } from '@/app/api/transcribe/route'
import { transcodeToWav } from '@/lib/audio/transcode'
import { transcribeAudio } from '@/services/transcription'
import { requireUserAllowAnon } from '@/lib/api-auth'
import { bumpDailyUsageServer, readDailyUsageServer } from '@/lib/db/corpus-server'
import { logApiUsage } from '@/lib/api-logger'

const mockTranscode  = transcodeToWav as jest.MockedFunction<typeof transcodeToWav>
const mockTranscribe = transcribeAudio as jest.MockedFunction<typeof transcribeAudio>
const mockBump       = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>
const mockRead       = readDailyUsageServer as jest.MockedFunction<typeof readDailyUsageServer>

/** 生产实例 vCPU 数 = 转码闸上限（docs/部署交接-香港PaaS.md §2：腾讯云香港 2vCPU/2GB） */
const TRANSCODE_LIMIT = 2
/** 豆包极速版并发限额 5，留 1 余量 = ASR 闸上限 */
const ASR_LIMIT = 4
/** 转码闸队列上限（超出立即 queue_full） */
const TRANSCODE_QUEUE = 20

/** 用例收尾兜底：所有替身的「放行开关」与所有在飞请求，afterEach 统一处理（见顶注） */
const openers: Array<() => void> = []
const pending: Array<Promise<unknown>> = []

/** 造一个带音频文件的 multipart 请求（注册用户身份，绕开匿名侧的额度/熔断查询） */
function audioReq(): Request {
  const form = new FormData()
  form.append('audio', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }), 'a.webm')
  return new Request('http://localhost/api/transcribe', {
    method:  'POST',
    headers: { authorization: 'Bearer t' },
    body:    form,
  })
}

/** 让事件循环跑若干轮，等所有在飞请求都推进到各自会卡住的那道闸 */
function settle(ms = 40): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 可控阻塞替身：记录「同时有几个在里面」，并能逐个 / 全部放行。
 * 用它冒充 ffmpeg 或豆包，把「同时在飞几个」变成可断言的数字。
 * @param value  放行后返回给调用方的值
 * @returns      带 inFlight/peak 计数与 releaseOne/openAll 控制的替身
 */
function makeBlocker<T>(value: T): {
  readonly impl: () => Promise<T>
  readonly inFlight: number
  readonly peak: number
  readonly entered: number
  releaseOne(): void
  openAll(): void
} {
  let inFlight = 0
  let peak     = 0
  let entered  = 0
  let opened   = false
  const waiters: Array<() => void> = []
  // 登记到收尾清单：用例中途断言失败也能被 afterEach 放行，不把名额漏给下一个用例
  openers.push(() => { opened = true; waiters.splice(0).forEach((r) => { r() }) })
  return {
    impl: async (): Promise<T> => {
      inFlight += 1
      entered  += 1
      peak = Math.max(peak, inFlight)
      if (!opened) await new Promise<void>((r) => { waiters.push(r) })
      inFlight -= 1
      return value
    },
    get inFlight(): number { return inFlight },
    get peak():     number { return peak },
    get entered():  number { return entered },
    /** 只放行队首一个（用来观察「一个名额腾出来后，等着的那个是否顶上」） */
    releaseOne(): void { waiters.shift()?.() },
    /** 打开闸口：已在等的全放，之后进来的一律直通（用例收尾必调，否则名额漏给下个用例） */
    openAll(): void { opened = true; waiters.splice(0).forEach((r) => { r() }) },
  }
}

/** 约 1 秒的 16kHz 单声道 WAV（44 字节头 + 32000 字节 PCM） */
const WAV = Buffer.alloc(44 + 32000)

/**
 * 同时发起 n 个转写请求，并登记进收尾清单
 * @param n  并发请求数
 * @returns  n 个在飞的响应 Promise
 */
function fire(n: number): Array<Promise<Response>> {
  const requests = Array.from({ length: n }, () => POST(audioReq()) as unknown as Promise<Response>)
  pending.push(...requests)
  return requests
}

beforeEach(() => {
  jest.clearAllMocks()
  // 一律用注册用户：匿名会多走终身闸与全局预算熔断（后者未替身化、会碰 DB），与本文件要验的东西无关
  ;(requireUserAllowAnon as jest.Mock).mockResolvedValue({ userId: 'u1', isAnonymous: false })
  mockRead.mockResolvedValue(0)
  mockBump.mockResolvedValue(1)
  mockTranscode.mockResolvedValue(WAV)
  mockTranscribe.mockResolvedValue('hello')
  ;(logApiUsage as jest.Mock).mockResolvedValue(undefined)
})

afterEach(async () => {
  // 无条件放行 + 排空：断言失败时用例末尾的 openAll 执行不到，只有这里能保证闸门交还给下一个用例
  openers.splice(0).forEach((open) => { open() })
  await Promise.allSettled(pending.splice(0))
})

describe('闸① 转码闸 · ffmpeg 并发被真的压在核数（2）', () => {
  test(`同时来 5 个请求：只有 ${TRANSCODE_LIMIT} 个进得了 ffmpeg，其余必须等（不能直接开跑）`, async () => {
    const ffmpeg = makeBlocker(WAV)
    mockTranscode.mockImplementation(ffmpeg.impl)

    const inFlightRequests = fire(5)
    await settle()

    // 这条是本次修复的正题：没有闸时这里会是 5（2 核被 2.5 倍超卖）
    expect(ffmpeg.inFlight).toBe(TRANSCODE_LIMIT)
    expect(mockTranscode).toHaveBeenCalledTimes(TRANSCODE_LIMIT)

    // 腾出一个名额 → 等着的第 3 个立刻顶上，但总数依然是 2
    ffmpeg.releaseOne()
    await settle()
    expect(ffmpeg.inFlight).toBe(TRANSCODE_LIMIT)
    expect(mockTranscode).toHaveBeenCalledTimes(TRANSCODE_LIMIT + 1)

    ffmpeg.openAll()
    const all = await Promise.all(inFlightRequests)
    expect(all.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    // 全程峰值从未越界（不是「最后凑巧对上」，是任何时刻都没超）
    expect(ffmpeg.peak).toBe(TRANSCODE_LIMIT)
  })
})

describe('闸② ASR 闸 · 豆包并发真的放到 4（没被 CPU 上限连坐）', () => {
  test(`同时来 6 个请求：豆包同时在飞 ${ASR_LIMIT} 个，多的排队`, async () => {
    const doubao = makeBlocker('hello')
    mockTranscribe.mockImplementation(doubao.impl)
    // 转码瞬时完成：让请求尽快堆到 ASR 那道闸上

    const inFlightRequests = fire(6)
    await settle()

    // ⚠️ 双重守卫：
    //   · 若 ASR 闸被误压回 2（P1-2 的原状），这里会是 2；
    //   · 若 CPU 名额被攥着去排 ASR 的队（两闸串成一道），这里同样会被卡在 2。
    expect(doubao.inFlight).toBe(ASR_LIMIT)

    doubao.openAll()
    const all = await Promise.all(inFlightRequests)
    expect(all.every((r) => r.status === 200)).toBe(true)
    expect(doubao.peak).toBe(ASR_LIMIT)
    expect(doubao.entered).toBe(6)
  })
})

describe('两闸互相独立 · 转码闸排满不挡「已经转完码的人」进豆包', () => {
  test('转码闸满员时：刚转完码的请求照常进 ASR，且转码队列同时补位（谁也没卡住谁）', async () => {
    const ffmpeg = makeBlocker(WAV)
    const doubao = makeBlocker('hello')
    mockTranscode.mockImplementation(ffmpeg.impl)
    mockTranscribe.mockImplementation(doubao.impl)

    const inFlightRequests = fire(3)
    await settle()
    expect(ffmpeg.inFlight).toBe(TRANSCODE_LIMIT)   // 2 个在转码，第 3 个在转码闸排队
    expect(doubao.inFlight).toBe(0)                 // 还没人到得了豆包

    // 放行一个转码 → 它应当①归还 CPU 名额让排队的第 3 个顶上，②自己继续走进 ASR
    ffmpeg.releaseOne()
    await settle()

    expect(doubao.inFlight).toBe(1)                 // 已过转码的那个进了 ASR
    expect(ffmpeg.inFlight).toBe(TRANSCODE_LIMIT)   // 排队的顶上来了，CPU 名额没被它攥着走
    expect(ffmpeg.entered).toBe(3)

    ffmpeg.openAll()
    doubao.openAll()
    const all = await Promise.all(inFlightRequests)
    expect(all.every((r) => r.status === 200)).toBe(true)
  })
})

describe('转码闸拒绝 · 被拦时一分钱没花、一次没扣', () => {
  test(`并发压到 ${TRANSCODE_LIMIT + TRANSCODE_QUEUE + 1} 个：溢出的那个立刻 503 ASR_BUSY，且没进 ffmpeg、没计次、没调豆包`, async () => {
    const ffmpeg = makeBlocker(WAV)
    mockTranscode.mockImplementation(ffmpeg.impl)

    // 2 个在飞 + 20 个排队 = 闸门吃满，第 23 个只能被 queue_full 立即拒绝（绝不无界排队）
    const settled: number[] = []
    const inFlightRequests = fire(TRANSCODE_LIMIT + TRANSCODE_QUEUE + 1)
      .map((p) => p.then((res) => { settled.push(res.status); return res }))
    await settle()

    // 只有溢出的那一个结束了，其余 22 个都还老实排着
    expect(settled).toEqual([503])
    // 核心不变式：花钱/计次的那两步一次都没发生（此刻 22 个还卡在转码，被拒的那个更是连 ffmpeg 都没进）
    expect(mockBump).not.toHaveBeenCalled()
    expect(mockTranscribe).not.toHaveBeenCalled()
    expect(ffmpeg.entered).toBe(TRANSCODE_LIMIT)

    ffmpeg.openAll()
    const all = await Promise.all(inFlightRequests)
    // 被拒的那个回的是「人多稍等」而不是「转写失败」：前端据 code 走自动重试，不吓用户
    const busy = all.find((r) => r.status === 503)
    expect(busy).toBeDefined()
    expect(await busy!.json()).toEqual(expect.objectContaining({ code: 'ASR_BUSY' }))
    expect(busy!.headers.get('Retry-After')).toBe('5')
    // 排上队的 22 个最终都正常完成（背压只砍溢出的那一个，不误伤队列里的人）
    expect(all.filter((r) => r.status === 200)).toHaveLength(TRANSCODE_LIMIT + TRANSCODE_QUEUE)
  })
})
