/**
 * @module   api/transcribe/route.test
 * @desc     转写接口「计次时机」回归守卫 —— 钉死不变式：计次点必须夹在「转码之后、豆包 ASR 之前」。
 *           ① ASR 前失败（转码报错）→ 一次都没计（等价于回滚，且无需递减、无并发风险）；
 *           ② ASR 已被调用后失败（含 EMPTY_TRANSCRIPT）→ 照常计次，不退（费用已产生，且防构造必失败请求刷额度）；
 *           ③ 已超额 → 402/429 且既不转码也不调 ASR。全部依赖 mock，不碰真实 DB / ffmpeg / 豆包。
 * @author   LingoBridge
 * @created  2026-07-20
 */
jest.mock('server-only', () => ({}))

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

/** 造一个带音频文件的 multipart 请求 */
function audioReq(): Request {
  const form = new FormData()
  form.append('audio', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }), 'a.webm')
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
  test('豆包返回 EMPTY_TRANSCRIPT：返回 500 且带 code，但计次已落（费用已产生，不回滚）', async () => {
    mockTranscribe.mockRejectedValue({ code: 'EMPTY_TRANSCRIPT', message: '没识别到内容' })

    const res = await POST(audioReq())

    expect(res.status).toBe(500)
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
