/**
 * @module   api/quota-reason.test
 * @desc     配额 402 的 reason 透传契约红线 —— 前端据此确定性选 QuotaReached 变体（取代异步 isAnon 竞态，
 *           竞态曾让匿名用户误显示注册的「本月额度已用完 10/10」谎报）。锁死：
 *             · corpus 匿名超总条数闸 → 402 reason:'trial'
 *             · corpus 注册超月额度闸 → 402 reason:'story'
 *             · practice 匿名超轮次闸 → 402 reason:'trial'
 *             · practice 注册超复练月额度闸 → 402 reason:'ielts'
 *           reason 值即 variant，1:1；谁删掉/改错 reason，此处立刻变红。全 mock，不碰真实 DB/模型/鉴权。
 * @author   LingoBridge
 * @created  2026-07-25
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/events', () => ({ logEvent: jest.fn() }))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))
jest.mock('@/lib/api-logger', () => ({
  logApiUsage: jest.fn(),
  qwenPlusCostCny: jest.fn(() => 0),
  API_PRICING: {},
}))
jest.mock('@/lib/db/practice-sessions', () => ({ IELTS_MONTHLY_LIMIT: 10 }))
jest.mock('@/lib/db/corpus', () => ({ STORY_MONTHLY_LIMIT: 10 }))
jest.mock('@/lib/db/practice-sessions-server', () => ({ countReviewPracticeThisMonthServer: jest.fn() }))
jest.mock('@/lib/db/corpus-server', () => ({
  countCorpusForUserServer: jest.fn(),
  countCorpusThisMonthServer: jest.fn(),
  createCorpusServer: jest.fn(),
  bumpDailyUsageServer: jest.fn(),
}))
jest.mock('@/services/practice', () => ({ buildScaffold: jest.fn(), coachReply: jest.fn() }))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(),
  assertCorpusOwner: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
// 同意闸放行（返回 falsy），让流程推进到额度闸。
jest.mock('@/lib/consent-server', () => ({ requireConsent: jest.fn(() => Promise.resolve(null)) }))

import { POST as corpusPost } from '@/app/api/corpus/route'
import { POST as practicePost } from '@/app/api/practice/route'
import { requireUserAllowAnon } from '@/lib/api-auth'
import { countCorpusForUserServer, countCorpusThisMonthServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { countReviewPracticeThisMonthServer } from '@/lib/db/practice-sessions-server'

const mockRequireAnon = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockCountForUser = countCorpusForUserServer as jest.MockedFunction<typeof countCorpusForUserServer>
const mockCountMonth = countCorpusThisMonthServer as jest.MockedFunction<typeof countCorpusThisMonthServer>
const mockBumpDaily = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>
const mockCountReview = countReviewPracticeThisMonthServer as jest.MockedFunction<typeof countReviewPracticeThisMonthServer>

beforeEach(() => jest.clearAllMocks())

/** 造带 JSON body 的鉴权请求（额度闸在 body 解析后触发，故必须给合法 body）。 */
function makeReq(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// 50+ 有效字符，逃过 isTooShortForCorpus（MIN_CORPUS_CHARS=40），让流程推进到额度闸。
const LONG_TEXT = '这是一段足够长的测试语料内容用来越过最小字数门槛确保能推进到额度闸校验分支这里再补充一些字'

describe('corpus 402 reason 契约', () => {
  test('匿名超总条数闸 → 402 reason=trial', async () => {
    mockRequireAnon.mockResolvedValue({ userId: 'u1', isAnonymous: true })
    mockCountForUser.mockResolvedValue(1)   // >= ANON_CORPUS_LIMIT(1)
    const res = await corpusPost(makeReq('/api/corpus', { source: 'text', rawText: LONG_TEXT }))
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'QUOTA_EXCEEDED', reason: 'trial' }))
  })

  test('注册超月额度闸 → 402 reason=story', async () => {
    mockRequireAnon.mockResolvedValue({ userId: 'u1', isAnonymous: false })
    mockCountMonth.mockResolvedValue(10)    // >= STORY_MONTHLY_LIMIT(10)
    const res = await corpusPost(makeReq('/api/corpus', { source: 'text', rawText: LONG_TEXT }))
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'QUOTA_EXCEEDED', reason: 'story' }))
  })
})

describe('practice 402 reason 契约', () => {
  test('匿名超轮次闸 → 402 reason=trial', async () => {
    mockRequireAnon.mockResolvedValue({ userId: 'u1', isAnonymous: true })
    mockBumpDaily.mockResolvedValue(17)     // > ANON_PRACTICE_TURN_LIMIT(16)
    const res = await practicePost(makeReq('/api/practice', { messages: [] }))
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'QUOTA_EXCEEDED', reason: 'trial' }))
  })

  test('注册超复练月额度闸 → 402 reason=ielts', async () => {
    mockRequireAnon.mockResolvedValue({ userId: 'u1', isAnonymous: false })
    mockBumpDaily.mockResolvedValue(1)      // 轮次闸内，放行到复练月闸
    mockCountReview.mockResolvedValue(10)   // >= IELTS_MONTHLY_LIMIT(10)
    const res = await practicePost(makeReq('/api/practice', { questionId: 'q1', isReview: true, messages: [] }))
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'QUOTA_EXCEEDED', reason: 'ielts' }))
  })
})
