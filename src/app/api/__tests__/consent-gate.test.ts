/**
 * @module   api/consent-gate.test
 * @desc     服务端同意闸「路由层」单测 —— 证明 /api/transcribe 与 /api/restructure 在把用户数据
 *           发给第三方 AI 之前，确实按 hasRecordedConsent 硬校验：
 *           1) 无同意 → 403（code=CONSENT_REQUIRED），且【不触碰】转码 / ASR / 整理服务；
 *           2) 有同意 → 不再是 403（放行进入后续流程）。
 *           守卫「深链绕过首页同意弹窗仍无法外发数据」这一不变式。全依赖 mock，不碰真实 DB/模型/鉴权。
 * @author   LingoBridge
 * @created  2026-07-18
 */
jest.mock('server-only', () => ({}))
jest.mock('@/services/restructure', () => ({ restructureText: jest.fn() }))
jest.mock('@/services/transcription', () => ({ transcribeAudio: jest.fn() }))
jest.mock('@/lib/api-logger', () => ({
  logApiUsage: jest.fn(),
  API_PRICING: { qwen_flash_per_1k_tokens: 0.0008, doubao_asr_per_second: 0.003 },
}))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({ hasRecordedConsent: jest.fn() }))
jest.mock('@/lib/db/corpus-server', () => ({
  bumpDailyUsageServer: jest.fn(() => Promise.resolve(1)),
  bumpAnonRestructureTodayServer: jest.fn(() => Promise.resolve(1)),
}))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/audio/transcode', () => ({ transcodeToWav: jest.fn() }))

import { POST as transcribePost } from '@/app/api/transcribe/route'
import { POST as restructurePost } from '@/app/api/restructure/route'
import { requireUserAllowAnon } from '@/lib/api-auth'
import { hasRecordedConsent } from '@/lib/consent-server'
import { transcribeAudio } from '@/services/transcription'
import { restructureText } from '@/services/restructure'
import { transcodeToWav } from '@/lib/audio/transcode'

const mockRequireAnon = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockHasConsent = hasRecordedConsent as jest.MockedFunction<typeof hasRecordedConsent>

/** 造 transcribe 的 multipart 请求（带一段假音频） */
function makeTranscribeReq(): Request {
  const form = new FormData()
  form.append('audio', new Blob([new Uint8Array(1000)], { type: 'audio/webm' }), 'r.webm')
  return new Request('http://localhost/api/transcribe', {
    method: 'POST',
    headers: { authorization: 'Bearer t' },
    body: form,
  })
}

/** 造 restructure 的 json 请求 */
function makeRestructureReq(): Request {
  return new Request('http://localhost/api/restructure', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ rawText: '今天我去了公园散步。' }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireAnon.mockResolvedValue({ userId: 'u1', isAnonymous: false })
  ;(transcribeAudio as jest.Mock).mockResolvedValue('转写文字')
  ;(restructureText as jest.Mock).mockResolvedValue({ cleanedText: '整理后', usable: true })
  ;(transcodeToWav as jest.Mock).mockResolvedValue(Buffer.alloc(44 + 32000))
})

describe('服务端同意闸 · /api/transcribe', () => {
  test('无同意 → 403 CONSENT_REQUIRED，且不触碰转码/ASR', async () => {
    mockHasConsent.mockResolvedValue(false)

    const res = await transcribePost(makeTranscribeReq())
    const body = (await res.json()) as { error?: string; code?: string }

    expect(res.status).toBe(403)
    expect(body.code).toBe('CONSENT_REQUIRED')
    expect(typeof body.error).toBe('string')
    expect(transcodeToWav).not.toHaveBeenCalled()
    expect(transcribeAudio).not.toHaveBeenCalled()
  })

  test('有同意 → 不再是 403（放行进入后续流程）', async () => {
    mockHasConsent.mockResolvedValue(true)

    const res = await transcribePost(makeTranscribeReq())

    expect(res.status).not.toBe(403)
    expect(transcribeAudio).toHaveBeenCalledTimes(1)
  })
})

describe('服务端同意闸 · /api/restructure', () => {
  test('无同意 → 403 CONSENT_REQUIRED，且不触碰整理服务', async () => {
    mockHasConsent.mockResolvedValue(false)

    const res = await restructurePost(makeRestructureReq())
    const body = (await res.json()) as { error?: string; code?: string }

    expect(res.status).toBe(403)
    expect(body.code).toBe('CONSENT_REQUIRED')
    expect(typeof body.error).toBe('string')
    expect(restructureText).not.toHaveBeenCalled()
  })

  test('有同意 → 不再是 403（放行进入整理）', async () => {
    mockHasConsent.mockResolvedValue(true)

    const res = await restructurePost(makeRestructureReq())

    expect(res.status).not.toBe(403)
    expect(restructureText).toHaveBeenCalledTimes(1)
  })
})
