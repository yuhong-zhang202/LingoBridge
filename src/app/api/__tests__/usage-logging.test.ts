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
// 服务端同意闸：transcribe / restructure 现会先查同意，默认放行（本套只验记账成功路径）
jest.mock('@/lib/consent-server', () => ({ hasRecordedConsent: jest.fn(() => Promise.resolve(true)) }))
jest.mock('@/lib/db/questions', () => ({ getQuestionById: jest.fn() }))
jest.mock('@/lib/db/corpus-server', () => ({
  getCorpusByIdServer: jest.fn(),
  bumpDailyUsageServer: jest.fn(),
  bumpAnonRestructureTodayServer: jest.fn(),
}))
jest.mock('@/lib/db/practice-sessions-server', () => ({ countReviewPracticeThisMonthServer: jest.fn() }))
jest.mock('@/lib/db/practice-sessions', () => ({ IELTS_MONTHLY_LIMIT: 100 }))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/audio/transcode', () => ({ transcodeToWav: jest.fn() }))

import { GET as analysisGet } from '@/app/api/analysis/route'
import { GET as phrasesGet } from '@/app/api/analysis/phrases/route'
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
  test('analysis GET → 记 qwen_plus 一条（带 user_id 归属 + phase=analysis）', async () => {
    const req = new Request('http://localhost/api/analysis?questionId=q1', { headers: { authorization: 'Bearer t' } })
    const res = await analysisGet(req)
    expect(res.status).toBe(200)
    expect(mockLogApiUsage).toHaveBeenCalledTimes(1)
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({
      service: 'qwen_plus', status: 'success', user_id: 'u1',
      metadata: expect.objectContaining({ phase: 'analysis' }),
    }))
  })

  test('analysis/phrases GET → 记 qwen_plus 一条', async () => {
    const req = new Request('http://localhost/api/analysis/phrases?questionId=q1', { headers: { authorization: 'Bearer t' } })
    const res = await phrasesGet(req)
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
      body: JSON.stringify({ rawText: '呃我周末就是去公园走了走' }),
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
