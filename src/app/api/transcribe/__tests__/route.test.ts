/**
 * @module   api/transcribe/route.test
 * @desc     转写接口「计次时机」回归守卫 —— 钉死不变式：计次点必须夹在「转码之后、豆包 ASR 之前」。
 *           ① ASR 前失败（转码报错）→ 一次都没计（等价于回滚，且无需递减、无并发风险）；
 *           ② ASR 已被调用后失败（含 EMPTY_TRANSCRIPT）→ 照常计次，不退（费用已产生，且防构造必失败请求刷额度）；
 *           ③ 已超额 → 402/429 且既不转码也不调 ASR。全部依赖 mock，不碰真实 DB / ffmpeg / 豆包。
 *           另守卫 ASR 并发闸接线：闸门参数、排队被拒 → 503 ASR_BUSY，以及
 *           ④【排队超时绝不扣次数】—— 等待发生在计次之前，超时用户一次都不该被扣。
 *           另守卫失败记账口径：⑤ EMPTY_TRANSCRIPT 打 metadata.error_kind='user_input' 且按真实时长记费
 *           （看板据此从错误率摘出、但保留在失败成本里）；其余失败记 0。
 *           ⑥ 无论成功/失败，metadata 始终带 phase（2026-07-25 补埋点，让转写故障按环节归位）；
 *             2026-07-26 起按 FormData 的 scene 细分：'story'→transcribe_story（语料转写）、
 *             'practice'→transcribe_practice（练习转写），缺省/非法回退 'transcribe'（兼容旧客户端）。
 *           ⑦ 失败记账补 error_code/error_message 三键（供应商响应、无 PII）；并发超限 45000292 打
 *             error_kind='capacity'（人多稍等、非系统故障，看板据此再从错误率摘出）。
 * @author   LingoBridge
 * @created  2026-07-20
 */
jest.mock('server-only', () => ({}))

// 闸门本体行为由 lib/__tests__/concurrency-gate.test.ts 覆盖；这里只替身化，用来精确制造
// 「队列满 / 等待超时」两种拒绝，避免在路由层堆 25 个并发请求。
// 替身内联在工厂里：路由模块在 import 阶段就会构造闸门，此刻外层 const 尚在 TDZ，引用不到。
jest.mock('@/lib/concurrency-gate', () => {
  const acquire  = jest.fn()
  const release  = jest.fn()
  const createdWith: unknown[] = []
  return {
    createConcurrencyGate: (options: unknown) => {
      createdWith.push(options)
      return { acquire, activeCount: 0, queuedCount: 0 }
    },
    __acquire:     acquire,
    __release:     release,
    __createdWith: createdWith,
  }
})

jest.mock('@/lib/audio/transcode', () => ({ transcodeToWav: jest.fn() }))
jest.mock('@/services/transcription', () => ({ transcribeAudio: jest.fn() }))
jest.mock('@/lib/api-logger', () => ({
  logApiUsage: jest.fn(),
  API_PRICING: { doubao_asr_per_second: 0.0001 },
}))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({ hasRecordedConsent: jest.fn(() => Promise.resolve(true)) }))
jest.mock('@/lib/db/corpus-server', () => ({
  bumpDailyUsageServer: jest.fn(),
  readDailyUsageServer: jest.fn(),
}))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

import { POST } from '@/app/api/transcribe/route'
import { transcodeToWav } from '@/lib/audio/transcode'
import { transcribeAudio } from '@/services/transcription'
import { requireUserAllowAnon } from '@/lib/api-auth'
import { bumpDailyUsageServer, readDailyUsageServer } from '@/lib/db/corpus-server'
import { logApiUsage } from '@/lib/api-logger'
import { ANON_TRANSCRIBE_LIMIT, REG_TRANSCRIBE_DAILY_LIMIT } from '@/lib/constants'

const mockRequireUser = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockTranscode   = transcodeToWav as jest.MockedFunction<typeof transcodeToWav>
const mockTranscribe  = transcribeAudio as jest.MockedFunction<typeof transcribeAudio>
const mockBump        = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>
const mockRead        = readDailyUsageServer as jest.MockedFunction<typeof readDailyUsageServer>

const gateMock = jest.requireMock('@/lib/concurrency-gate') as {
  __acquire:     jest.Mock
  __release:     jest.Mock
  __createdWith: unknown[]
}

/**
 * 造一个带音频文件的 multipart 请求
 * @param scene  可选场景标（'story'/'practice'/非法值）；缺省不带 = 旧客户端行为
 */
function audioReq(scene?: string): Request {
  const form = new FormData()
  form.append('audio', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }), 'a.webm')
  if (scene !== undefined) form.append('scene', scene)
  return new Request('http://localhost/api/transcribe', {
    method: 'POST',
    headers: { authorization: 'Bearer t' },
    body: form,
  })
}

/** 设定当前用户身份（匿名 / 注册） */
function asUser(isAnonymous: boolean): void {
  mockRequireUser.mockResolvedValue({ userId: 'u1', isAnonymous })
}

beforeEach(() => {
  jest.clearAllMocks()
  asUser(false)
  mockRead.mockResolvedValue(0)
  mockBump.mockResolvedValue(1)
  mockTranscode.mockResolvedValue(Buffer.alloc(44 + 32000)) // 约 1 秒的 16kHz WAV
  mockTranscribe.mockResolvedValue('hello world')
  ;(logApiUsage as jest.Mock).mockResolvedValue(undefined)
  // 默认：闸门不拥堵，立刻放行
  gateMock.__acquire.mockResolvedValue({ ok: true, release: gateMock.__release })
})

describe('转写计次时机 · ASR 之前失败 → 不计次（等价回滚）', () => {
  test('转码报错：返回 500，且 bumpDailyUsageServer 一次都没被调用', async () => {
    mockTranscode.mockRejectedValue(new Error('ffmpeg 挂了'))

    const res = await POST(audioReq())

    expect(res.status).toBe(500)
    // 核心不变式：钱没花、用户没拿到字 → 一次都不该扣
    expect(mockBump).not.toHaveBeenCalled()
    expect(mockTranscribe).not.toHaveBeenCalled()
  })
})

describe('转写计次时机 · ASR 已调用后失败 → 照常计次，不退', () => {
  test('豆包返回 EMPTY_TRANSCRIPT：返回 422 且带 code（用户输入问题非服务端故障），但计次已落（费用已产生，不回滚）', async () => {
    mockTranscribe.mockRejectedValue({ code: 'EMPTY_TRANSCRIPT', message: '没识别到内容' })

    const res = await POST(audioReq())

    // 422 而非 500：录到音但没有可用人声属「请求合法、内容无法处理」。
    // 前端 recording/page.tsx 走 !res.ok + code 判分支，4xx 同样命中友好提示。
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'EMPTY_TRANSCRIPT' }))
    // 核心不变式：豆包已被调用 → 计次必须保留，否则可构造必失败请求无限刷 ASR
    expect(mockTranscribe).toHaveBeenCalled()
    expect(mockBump).toHaveBeenCalledWith('u1', 'transcribe')
  })

  test('豆包普通报错：同样计次不退', async () => {
    mockTranscribe.mockRejectedValue(new Error('上游超时'))

    const res = await POST(audioReq())

    expect(res.status).toBe(500)
    expect(mockBump).toHaveBeenCalledTimes(1)
  })
})

describe('转写失败记账 · 区分「用户输入问题」与「系统故障」', () => {
  test('EMPTY_TRANSCRIPT：打 error_kind=user_input，且按真实时长记费（钱确实花了）', async () => {
    mockTranscribe.mockRejectedValue({ code: 'EMPTY_TRANSCRIPT', message: '没识别到内容' })

    await POST(audioReq())

    // 1 秒音频 × ¥0.0001/s（mock 单价）。记 0 会让成本看板的"失败成本"永远看不到这笔白烧。
    // metadata 始终带 phase（本用例不带 scene → 兜底 'transcribe'）+ error_code/error_message 三键（供应商响应、无 PII）；
    // 空录音再叠 error_kind='user_input'（不计系统故障）。cause 无 logId 故不带该键。
    expect(logApiUsage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      usage_amount: 1,
      estimated_cost_cny: 0.0001,
      metadata: { phase: 'transcribe', error_code: 'EMPTY_TRANSCRIPT', error_message: '没识别到内容', error_kind: 'user_input' },
      user_id: 'u1',              // 失败行同样要归到人，否则「按用户成本」漏账
      is_anonymous: false,
    }))
  })

  test('系统故障（上游超时）：不打 user_input 标记，且不拿音频时长虚增成本', async () => {
    mockTranscribe.mockRejectedValue(new Error('上游超时'))

    await POST(audioReq())

    const arg = (logApiUsage as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(arg.status).toBe('error')
    // 无 error_kind → 看板按系统故障计入错误率，但已按环节归位到「语音转写」；三键中裸 Error 无 code→'unknown'，
    // error_message 取 Error.message，无 cause.logId 故不带 logId
    expect(arg.metadata).toEqual({ phase: 'transcribe', error_code: 'unknown', error_message: '上游超时' })
    expect(arg.estimated_cost_cny).toBe(0) // 豆包没跑完整趟，不认这笔钱
  })

  test('ASR 之前失败（转码报错）：豆包没被调用 → 记 0 且无 user_input 标记', async () => {
    mockTranscode.mockRejectedValue(new Error('ffmpeg 挂了'))

    await POST(audioReq())

    const arg = (logApiUsage as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(arg.estimated_cost_cny).toBe(0)
    // 即便 ASR 前失败，失败记账仍带 phase（不带 scene → 兜底 'transcribe'）+ 三键（无 error_kind → 系统故障口径不变）
    expect(arg.metadata).toEqual({ phase: 'transcribe', error_code: 'unknown', error_message: 'ffmpeg 挂了' })
  })
})

describe('phase 埋点 · 按 FormData 的 scene 区分语料转写 / 练习转写', () => {
  test.each([
    ['story → transcribe_story（语料转写）', 'story', 'transcribe_story'],
    ['practice → transcribe_practice（练习转写）', 'practice', 'transcribe_practice'],
  ])('成功记账：%s', async (_label, scene, expectedPhase) => {
    const res = await POST(audioReq(scene))

    expect(res.status).toBe(200)
    expect(logApiUsage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      metadata: { phase: expectedPhase },
    }))
  })

  test('失败记账同样按 scene 打 phase：练习轮次上游超时 → phase=transcribe_practice', async () => {
    mockTranscribe.mockRejectedValue(new Error('上游超时'))

    await POST(audioReq('practice'))

    const arg = (logApiUsage as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(arg.metadata).toEqual({ phase: 'transcribe_practice', error_code: 'unknown', error_message: '上游超时' })
  })

  test.each([
    ['缺省（旧客户端缓存页面不带 scene）', undefined],
    ['非法值（不认识的场景标不瞎归类）', 'bogus'],
  ])('回退语义：%s → phase=transcribe', async (_label, scene) => {
    const res = await POST(audioReq(scene))

    expect(res.status).toBe(200)
    expect(logApiUsage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      metadata: { phase: 'transcribe' },
    }))
  })
})

describe('转写计次时机 · 计次点夹在转码与 ASR 之间', () => {
  test('成功链路：转码 → 计次 → ASR，顺序不可颠倒', async () => {
    const order: string[] = []
    mockTranscode.mockImplementation(async () => { order.push('transcode'); return Buffer.alloc(44) })
    mockBump.mockImplementation(async () => { order.push('bump'); return 1 })
    mockTranscribe.mockImplementation(async () => { order.push('asr'); return 'ok' })

    const res = await POST(audioReq())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'ok' })
    expect(order).toEqual(['transcode', 'bump', 'asr'])
  })
})

describe('转写额度熔断 · 已超额零成本挡掉', () => {
  test('匿名已达 ANON_TRANSCRIBE_LIMIT：402 QUOTA_EXCEEDED，且不转码、不调 ASR、不再计次', async () => {
    asUser(true)
    mockRead.mockResolvedValue(ANON_TRANSCRIBE_LIMIT)

    const res = await POST(audioReq())

    expect(res.status).toBe(402)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }))
    expect(mockTranscode).not.toHaveBeenCalled()
    expect(mockTranscribe).not.toHaveBeenCalled()
    expect(mockBump).not.toHaveBeenCalled()
  })

  test('注册已达 REG_TRANSCRIBE_DAILY_LIMIT：429（不带 code），不转码不调 ASR', async () => {
    mockRead.mockResolvedValue(REG_TRANSCRIBE_DAILY_LIMIT)

    const res = await POST(audioReq())

    expect(res.status).toBe(429)
    expect(await res.json()).toEqual(expect.not.objectContaining({ code: 'QUOTA_EXCEEDED' }))
    expect(mockTranscode).not.toHaveBeenCalled()
    expect(mockTranscribe).not.toHaveBeenCalled()
  })

  test('只读值漏判（返回 0）时，原子递增复核仍能挡住超额：402 且 ASR 零调用', async () => {
    asUser(true)
    mockRead.mockResolvedValue(0)                                   // 并发下读到偏小值
    mockBump.mockResolvedValue(ANON_TRANSCRIBE_LIMIT + 1)           // 递增后复核发现已超

    const res = await POST(audioReq())

    expect(res.status).toBe(402)
    expect(mockTranscribe).not.toHaveBeenCalled()
  })
})

describe('ASR 并发闸 · 排队被拒绝', () => {
  test('闸门参数钉死：并发 4（豆包上限 5 留 1 余量）/ 队列 20 / 等待 15s', () => {
    // createdWith 在模块加载时写入，clearAllMocks 不会清空（它是普通数组，不是 jest.fn）
    expect(gateMock.__createdWith).toEqual([
      { maxConcurrent: 4, maxQueue: 20, maxWaitMs: 15_000 },
    ])
  })

  test.each([
    ['队列已满', 'queue_full'],
    ['等待超时', 'timeout'],
  ])('%s：503 + code=ASR_BUSY，且【一次都不计次】、不调 ASR', async (_label, reason) => {
    gateMock.__acquire.mockResolvedValue({ ok: false, reason })

    const res = await POST(audioReq())

    // 与「转写失败」(500) / 「你的额度用尽」(402/429) 三者互不重叠，前端才能给出「人多」的专属文案
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'ASR_BUSY' }))
    expect(res.headers.get('Retry-After')).toBe('5')
    // 核心不变式：排队与超时都发生在计次之前 —— 等了半天还超时、还被扣一次，绝不可接受
    expect(mockBump).not.toHaveBeenCalled()
    expect(mockTranscribe).not.toHaveBeenCalled()
    // 被拒时没有拿到名额，自然也不该归还
    expect(gateMock.__release).not.toHaveBeenCalled()
  })

  test('拿到名额后无论成功还是抛错，release 都必须被调用（否则名额永久泄漏）', async () => {
    await POST(audioReq())
    expect(gateMock.__release).toHaveBeenCalledTimes(1)

    gateMock.__release.mockClear()
    mockTranscribe.mockRejectedValue(new Error('上游超时'))
    await POST(audioReq())
    expect(gateMock.__release).toHaveBeenCalledTimes(1)
  })

  test('闸门只包住 ASR，不包转码：acquire 发生在转码之后', async () => {
    const order: string[] = []
    mockTranscode.mockImplementation(async () => { order.push('transcode'); return Buffer.alloc(44) })
    gateMock.__acquire.mockImplementation(async () => { order.push('acquire'); return { ok: true, release: gateMock.__release } })
    mockBump.mockImplementation(async () => { order.push('bump'); return 1 })
    mockTranscribe.mockImplementation(async () => { order.push('asr'); return 'ok' })

    const res = await POST(audioReq())

    expect(res.status).toBe(200)
    // 转码是本机 CPU、不占豆包并发；排队必须在计次之前，计次仍紧贴 ASR
    expect(order).toEqual(['transcode', 'acquire', 'bump', 'asr'])
  })

  test('豆包仍返回 45000292（并发超限）：归到 503 ASR_BUSY，而非误报「转写失败」', async () => {
    mockTranscribe.mockRejectedValue({ code: '45000292', message: 'concurrency limit exceeded' })

    const res = await POST(audioReq())

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'ASR_BUSY' }))
    // 记账打 error_kind='capacity'（人多、非系统故障，看板据此从错误率摘出）+ error_code 供辨识
    expect(logApiUsage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      metadata: { phase: 'transcribe', error_code: '45000292', error_message: 'concurrency limit exceeded', error_kind: 'capacity' },
    }))
  })
})
