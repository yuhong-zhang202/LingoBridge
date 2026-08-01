/**
 * @module   api/usage-logging.test
 * @desc     成本记账回归守卫 —— 钉死「每个发 AI 调用的路由，成功路径都必须调用 logApiUsage」。
 *           这是 F1/F2/F3 类漏记事故（pronounce/polish 整条漏、practice 首轮漏 analysis 那次）的护栏：
 *           任何新路由/改动若在成功路径上漏掉记账，这里立即变红。全部依赖 mock，不碰真实 DB/模型/鉴权。
 *           （matching 的两次调用 + cache 零调用有独立的 matching/route.test.ts 专测，此处不重复。）
 * @author   LingoBridge
 * @created  2026-07-18
 */
jest.mock('server-only', () => ({}))

// —— 服务层全 mock：只验 route 是否记账，不跑真实模型 ——
jest.mock('@/services/analysis', () => ({
  generateAnalysis: jest.fn(),
  generatePhrases: jest.fn(),
}))
jest.mock('@/services/practice', () => ({
  buildScaffold: jest.fn(),
  coachReply: jest.fn(),
  polishSentence: jest.fn(),
}))
jest.mock('@/services/restructure', () => ({ restructureText: jest.fn() }))
jest.mock('@/services/transcription', () => ({ transcribeAudio: jest.fn() }))
jest.mock('@/services/pronounce', () => ({ generatePronunciationTip: jest.fn() }))

// —— 记账 / 鉴权 / DB / 上下文 全 mock ——
jest.mock('@/lib/api-logger', () => ({
  logApiUsage: jest.fn(),
  qwenPlusCostCny: jest.fn(() => 0.001),
  API_PRICING: { qwen_flash_per_1k_tokens: 0.0008, doubao_asr_per_second: 0.003, qwen_plus_input_per_1m: 0.8, qwen_plus_output_per_1m: 2.0 },
}))
jest.mock('@/lib/api-auth', () => ({
  requireUser: jest.fn(),
  requireUserAllowAnon: jest.fn(),
  assertCorpusOwner: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
// 服务端同意闸：analysis/phrases/practice/pronounce/polish 走 requireConsent（返回 null=放行），
// transcribe/restructure 走 hasRecordedConsent（返回 true=已签）。本套只验记账成功路径，故默认全放行。
jest.mock('@/lib/consent-server', () => ({
  requireConsent: jest.fn(() => Promise.resolve(null)),
  hasRecordedConsent: jest.fn(() => Promise.resolve(true)),
}))
jest.mock('@/lib/db/questions', () => ({ getQuestionById: jest.fn() }))
jest.mock('@/lib/db/corpus-server', () => ({
  getCorpusByIdServer: jest.fn(),
  bumpDailyUsageServer: jest.fn(),
  readDailyUsageServer: jest.fn(() => Promise.resolve(0)),
  bumpAnonRestructureTodayServer: jest.fn(),
}))
jest.mock('@/lib/db/practice-sessions-server', () => ({ countReviewPracticeThisMonthServer: jest.fn() }))
jest.mock('@/lib/db/practice-sessions', () => ({ IELTS_MONTHLY_LIMIT: 100 }))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/audio/transcode', () => ({ transcodeToWav: jest.fn() }))

import { POST as analysisPost } from '@/app/api/analysis/route'
import { POST as phrasesPost } from '@/app/api/analysis/phrases/route'
import { POST as practicePost } from '@/app/api/practice/route'
import { POST as restructurePost } from '@/app/api/restructure/route'
import { POST as transcribePost } from '@/app/api/transcribe/route'
import { POST as pronouncePost } from '@/app/api/pronounce/route'
import { POST as polishPost } from '@/app/api/practice/polish/route'

import { generateAnalysis, generatePhrases } from '@/services/analysis'
import { buildScaffold, coachReply, polishSentence } from '@/services/practice'
import { restructureText } from '@/services/restructure'
import { transcribeAudio } from '@/services/transcription'
import { generatePronunciationTip } from '@/services/pronounce'
import { logApiUsage } from '@/lib/api-logger'
import { requireUser, requireUserAllowAnon } from '@/lib/api-auth'
import { getQuestionById } from '@/lib/db/questions'
import { getCorpusByIdServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { transcodeToWav } from '@/lib/audio/transcode'

const mockLogApiUsage = logApiUsage as jest.MockedFunction<typeof logApiUsage>
const mockRequireUser = requireUser as jest.MockedFunction<typeof requireUser>
const mockRequireAnon = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockGetQuestion = getQuestionById as jest.MockedFunction<typeof getQuestionById>
const mockGetCorpus = getCorpusByIdServer as jest.MockedFunction<typeof getCorpusByIdServer>
const mockBumpDaily = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>
const mockTranscode = transcodeToWav as jest.MockedFunction<typeof transcodeToWav>

/** 造一份最小合法题目（含各 route 会读到的字段） */
function makeQuestion(part: 1 | 2 | 3 = 1) {
  return {
    id: 'q1', part, topic: 't', question_text: 'What do you do to relax?',
    question_text_zh: '你如何放松？', cue_card_title: null, cue_card_title_zh: null,
    is_new: false, topic_only: false, parent_card_id: null, created_at: '2026-01-01T00:00:00Z',
    observation_points: ['EMO_04'],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireUser.mockResolvedValue({ userId: 'u1' } as never)
  mockRequireAnon.mockResolvedValue({ userId: 'u1', isAnonymous: false } as never)
  mockLogApiUsage.mockResolvedValue(undefined)
  mockGetQuestion.mockResolvedValue(makeQuestion() as never)
  mockGetCorpus.mockResolvedValue(null)
  mockBumpDaily.mockResolvedValue(1)
  ;(generateAnalysis as jest.Mock).mockResolvedValue({ structureLabel: 's', focusPoints: [], phrases: [] })
  ;(generatePhrases as jest.Mock).mockResolvedValue([])
  ;(buildScaffold as jest.Mock).mockResolvedValue({
    part: 1, questionForAI: 'q', displayEn: 'q', displayZh: 'q', focusPoints: [], part3Questions: [], level: '6.0',
  })
  ;(coachReply as jest.Mock).mockResolvedValue('Hi there, shall we start?')
  ;(restructureText as jest.Mock).mockResolvedValue({ cleanedText: '整理后的文字', usable: true })
  ;(transcribeAudio as jest.Mock).mockResolvedValue('转写文字')
  ;(generatePronunciationTip as jest.Mock).mockResolvedValue({ ipaIntended: '/a/', ipaHeard: '/b/', tip: '提示' })
  ;(polishSentence as jest.Mock).mockResolvedValue({ needsWork: false, optimized: '', note: '' })
  mockTranscode.mockResolvedValue(Buffer.alloc(44 + 32000))
})

describe('成本记账回归守卫 · 每个发 AI 调用的路由成功路径都必须调用 logApiUsage', () => {
  test('analysis POST → 记 qwen_plus 一条（带 user_id 归属 + phase=analysis）', async () => {
    // 已由 GET 改 POST（扣额度 + 调 AI 的副作用接口，不能被预取无意触发），入参走 body。
    // ?stream=0 走 handleBuffered（阻塞式整批、用 generateAnalysis）——此路是降级/预取目标，记账口径守于此；
    // 流式默认路的成功/失败记账另由 api/analysis/__tests__/route.test.ts（S1/S3）覆盖。
    const req = new Request('http://localhost/api/analysis?stream=0', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'q1' }),
    })
    const res = await analysisPost(req)
    expect(res.status).toBe(200)
    expect(mockLogApiUsage).toHaveBeenCalledTimes(1)
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({
      service: 'qwen_plus', status: 'success', user_id: 'u1',
      metadata: expect.objectContaining({ phase: 'analysis' }),
    }))
  })

  test('analysis/phrases POST → 记 qwen_plus 一条', async () => {
    const req = new Request('http://localhost/api/analysis/phrases', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'q1' }),
    })
    const res = await phrasesPost(req)
    expect(res.status).toBe(200)
    expect(mockLogApiUsage).toHaveBeenCalledTimes(1)
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({ service: 'qwen_plus', status: 'success' }))
  })

  test('practice POST 首轮 → 记两条（analysis + coach，钉死首轮漏记 analysis）', async () => {
    const req = new Request('http://localhost/api/practice', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'q1' }),
    })
    const res = await practicePost(req)
    expect(res.status).toBe(200)
    expect(mockLogApiUsage).toHaveBeenCalledTimes(2)
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ phase: 'analysis' }) }))
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ phase: 'coach' }) }))
  })

  test('practice POST 续轮（带 scaffold）→ 只记 coach 一条（不重复构建脚手架）', async () => {
    const scaffold = { part: 1, questionForAI: 'q', displayEn: 'q', displayZh: 'q', focusPoints: [], part3Questions: [], level: '6.0' }
    const req = new Request('http://localhost/api/practice', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ scaffold, messages: [{ role: 'user', content: 'hi' }] }),
    })
    const res = await practicePost(req)
    expect(res.status).toBe(200)
    expect(mockLogApiUsage).toHaveBeenCalledTimes(1)
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ phase: 'coach' }) }))
  })

  test('restructure POST → 记 qwen_flash 一条（带 user_id + is_anonymous 归属）', async () => {
    const req = new Request('http://localhost/api/restructure', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      // 需满足 MIN_CORPUS_CHARS(40) 有效字符门槛，否则先被 400 拦下、到不了记账断言
      body: JSON.stringify({ rawText: '呃我周末就是一个人去公园散步，走了很久，看到很多人在放风筝，我坐在长椅上晒太阳，心里觉得特别放松' }),
    })
    const res = await restructurePost(req)
    expect(res.status).toBe(200)
    expect(mockLogApiUsage).toHaveBeenCalledTimes(1)
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({
      service: 'qwen_flash', status: 'success', user_id: 'u1', is_anonymous: false,
      metadata: expect.objectContaining({ phase: 'restructure' }),
    }))
  })

  test('practice POST 首轮带 storyId → 两条账均带 corpus_id 归属', async () => {
    const req = new Request('http://localhost/api/practice', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'q1', storyId: 's-42' }),
    })
    const res = await practicePost(req)
    expect(res.status).toBe(200)
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'u1', corpus_id: 's-42', is_anonymous: false,
      metadata: expect.objectContaining({ phase: 'analysis' }),
    }))
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'u1', corpus_id: 's-42', is_anonymous: false,
      metadata: expect.objectContaining({ phase: 'coach' }),
    }))
  })

  test('transcribe POST → 记 doubao_asr 一条', async () => {
    const fd = new FormData()
    fd.append('audio', new Blob([new Uint8Array(1000)], { type: 'audio/webm' }))
    const req = { formData: async () => fd } as unknown as Request
    const res = await transcribePost(req)
    expect(res.status).toBe(200)
    expect(mockLogApiUsage).toHaveBeenCalledTimes(1)
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({ service: 'doubao_asr', status: 'success' }))
  })

  test('pronounce POST → 记 qwen_plus 一条（此前整条路由漏记）', async () => {
    const req = new Request('http://localhost/api/pronounce', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ intended: 'work', heard: 'walk' }),
    })
    const res = await pronouncePost(req)
    expect(res.status).toBe(200)
    expect(mockLogApiUsage).toHaveBeenCalledTimes(1)
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({ service: 'qwen_plus', status: 'success' }))
  })

  test('practice/polish POST → 记 qwen_plus 一条（此前整条路由漏记）', async () => {
    const req = new Request('http://localhost/api/practice/polish', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ sentence: 'I very like coffee' }),
    })
    const res = await polishPost(req)
    expect(res.status).toBe(200)
    expect(mockLogApiUsage).toHaveBeenCalledTimes(1)
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({ service: 'qwen_plus', status: 'success' }))
  })
})

/**
 * 失败可诊断性守卫 —— 钉死「AI 调用抛错时，失败记账也带 metadata.phase」。
 * 背景：此前失败行 metadata 是空对象 {}，看板按 phase 分桶时全部掉进 other 桶，
 * 分不清是哪个接口/哪一步挂的（也是查 62.75% 错误率时所有失败落 other 的根因）。
 * 系统故障【不】补 error_kind（缺键即系统故障，这是既定语义），此处一并守住「别误标成 user_input」。
 */
describe('失败可诊断性守卫 · AI 调用抛错时失败记账带 phase、且不误标 error_kind', () => {
  /** 取本次唯一一条 error 记账入参 */
  function errorCall(): { status?: string; metadata?: { phase?: string; error_kind?: string } } {
    const calls = mockLogApiUsage.mock.calls.map((c) => c[0])
    const err = calls.find((c) => c.status === 'error')
    if (!err) throw new Error('未记到 status=error 的失败账')
    return err as never
  }

  test('analysis 失败 → 记 status=error 且 phase=analysis，不带 error_kind', async () => {
    // ?stream=0 走 handleBuffered：AI 抛错 → 500 + 失败记账。流式默认路的 error 帧 + 失败记账
    // 另由 api/analysis/__tests__/route.test.ts（S3）覆盖（流式返回 200+error 帧、非 500）。
    ;(generateAnalysis as jest.Mock).mockRejectedValueOnce(new Error('模型超时'))
    const req = new Request('http://localhost/api/analysis?stream=0', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'q1' }),
    })
    const res = await analysisPost(req)
    expect(res.status).toBe(500)
    const call = errorCall()
    expect(call.metadata?.phase).toBe('analysis')
    expect(call.metadata?.error_kind).toBeUndefined()
  })

  test('analysis/phrases 失败 → phase=phrases，不带 error_kind', async () => {
    ;(generatePhrases as jest.Mock).mockRejectedValueOnce(new Error('模型超时'))
    const req = new Request('http://localhost/api/analysis/phrases', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'q1' }),
    })
    const res = await phrasesPost(req)
    expect(res.status).toBe(500)
    const call = errorCall()
    expect(call.metadata?.phase).toBe('phrases')
    expect(call.metadata?.error_kind).toBeUndefined()
  })

  test('restructure 失败 → phase=restructure，不带 error_kind', async () => {
    ;(restructureText as jest.Mock).mockRejectedValueOnce(new Error('模型超时'))
    const req = new Request('http://localhost/api/restructure', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      // 需满足 MIN_CORPUS_CHARS(40) 有效字符门槛，否则先被 400 拦下、到不了记账断言
      body: JSON.stringify({ rawText: '呃我周末就是一个人去公园散步，走了很久，看到很多人在放风筝，我坐在长椅上晒太阳，心里觉得特别放松' }),
    })
    const res = await restructurePost(req)
    expect(res.status).toBe(500)
    const call = errorCall()
    expect(call.metadata?.phase).toBe('restructure')
    expect(call.metadata?.error_kind).toBeUndefined()
  })

  test('practice 续轮失败 → 兜底 phase=coach，不带 error_kind', async () => {
    ;(coachReply as jest.Mock).mockRejectedValueOnce(new Error('模型超时'))
    const scaffold = { part: 1, questionForAI: 'q', displayEn: 'q', displayZh: 'q', focusPoints: [], part3Questions: [], level: '6.0' }
    const req = new Request('http://localhost/api/practice', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ scaffold, messages: [{ role: 'user', content: 'hi' }] }),
    })
    const res = await practicePost(req)
    expect(res.status).toBe(500)
    const call = errorCall()
    expect(call.metadata?.phase).toBe('coach')
    expect(call.metadata?.error_kind).toBeUndefined()
  })

  test('practice 首轮建脚手架失败 → 同样兜底 phase=coach（catch 分不清哪步）', async () => {
    ;(buildScaffold as jest.Mock).mockRejectedValueOnce(new Error('模型超时'))
    const req = new Request('http://localhost/api/practice', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'q1' }),
    })
    const res = await practicePost(req)
    expect(res.status).toBe(500)
    const call = errorCall()
    expect(call.metadata?.phase).toBe('coach')
    expect(call.metadata?.error_kind).toBeUndefined()
  })

  test('practice/polish 失败 → phase=polish，不带 error_kind', async () => {
    ;(polishSentence as jest.Mock).mockRejectedValueOnce(new Error('模型超时'))
    const req = new Request('http://localhost/api/practice/polish', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ sentence: 'I very like coffee' }),
    })
    const res = await polishPost(req)
    expect(res.status).toBe(500)
    const call = errorCall()
    expect(call.metadata?.phase).toBe('polish')
    expect(call.metadata?.error_kind).toBeUndefined()
  })

  test('pronounce 失败 → phase=pronounce，不带 error_kind', async () => {
    ;(generatePronunciationTip as jest.Mock).mockRejectedValueOnce(new Error('模型超时'))
    const req = new Request('http://localhost/api/pronounce', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ intended: 'work', heard: 'walk' }),
    })
    const res = await pronouncePost(req)
    expect(res.status).toBe(500)
    const call = errorCall()
    expect(call.metadata?.phase).toBe('pronounce')
    expect(call.metadata?.error_kind).toBeUndefined()
  })
})
