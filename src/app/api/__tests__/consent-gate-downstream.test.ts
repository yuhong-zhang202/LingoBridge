/**
 * @module   api/consent-gate-downstream.test
 * @desc     服务端同意闸「下游 7 出口」红线单测 —— 证明所有把用户数据（原文/故事/句子）发往
 *           第三方 AI（或建故事落库）的下游路由，在触达任何外发/记账前都硬过 requireConsent：
 *           令 requireConsent 返回 403（未捕获当前版本同意）→ 断言路由【早退 403】且【AI 服务/建档/记账均未触达】。
 *           consent-gate.test.ts 已守 transcribe/restructure（走 hasRecordedConsent 直查）；本套补齐
 *           走 requireConsent 的 7 条：matching / analysis / analysis·phrases / pronounce / corpus /
 *           practice / practice·polish。谁误删某路由的 requireConsent 调用，这里立刻变红（红线有网可兜）。
 *           全依赖 mock，不碰真实 DB / 模型 / 鉴权。
 * @author   LingoBridge
 * @created  2026-07-18
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/env-server', () => ({ env: { matchSnapshotEnabled: true, matchingAlgoRaw: 'mapping' } }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/events', () => ({ logEvent: jest.fn() }))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/db/questions', () => ({ getQuestionById: jest.fn() }))
jest.mock('@/lib/db/match-snapshots', () => ({
  getMatchSnapshotServer: jest.fn(),
  upsertMatchSnapshotServer: jest.fn(),
}))
jest.mock('@/lib/db/practice-sessions-server', () => ({ countReviewPracticeThisMonthServer: jest.fn() }))
jest.mock('@/lib/db/practice-sessions', () => ({ IELTS_MONTHLY_LIMIT: 10 }))
jest.mock('@/lib/db/corpus', () => ({ STORY_MONTHLY_LIMIT: 10 }))
jest.mock('@/lib/db/corpus-server', () => ({
  getCorpusByIdServer: jest.fn(),
  bumpDailyUsageServer: jest.fn(),
  countCorpusThisMonthServer: jest.fn(),
  countCorpusForUserServer: jest.fn(),
  createCorpusServer: jest.fn(),
}))
jest.mock('@/services/matching', () => ({ matchByStory: jest.fn() }))
jest.mock('@/services/analysis', () => ({ generateAnalysis: jest.fn(), generatePhrases: jest.fn() }))
jest.mock('@/services/pronounce', () => ({ generatePronunciationTip: jest.fn() }))
jest.mock('@/services/practice', () => ({ buildScaffold: jest.fn(), coachReply: jest.fn(), polishSentence: jest.fn() }))
jest.mock('@/lib/api-logger', () => ({
  logApiUsage: jest.fn(),
  qwenPlusCostCny: jest.fn(() => 0),
  API_PRICING: { qwen_plus_input_per_1m: 0.8, qwen_plus_output_per_1m: 2.0 },
}))
jest.mock('@/lib/api-auth', () => ({
  requireUser: jest.fn(),
  requireUserAllowAnon: jest.fn(),
  assertCorpusOwner: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
// 同意闸：本套令 requireConsent 恒返回 403（未捕获同意）——正是要证「拒绝时下游一律不触达」。
// 用全局 Response 造 403（路由只是 `return consentDenied`，状态码 403 即达意），免在 mock 工厂里 require。
jest.mock('@/lib/consent-server', () => ({
  requireConsent: jest.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: '请先在首页阅读并同意隐私说明', code: 'CONSENT_REQUIRED' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  ),
}))

import { POST as matchingPost } from '@/app/api/matching/route'
import { POST as analysisPost } from '@/app/api/analysis/route'
import { POST as phrasesPost } from '@/app/api/analysis/phrases/route'
import { POST as pronouncePost } from '@/app/api/pronounce/route'
import { POST as corpusPost } from '@/app/api/corpus/route'
import { POST as practicePost } from '@/app/api/practice/route'
import { POST as polishPost } from '@/app/api/practice/polish/route'

import { requireUser, requireUserAllowAnon } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { logApiUsage } from '@/lib/api-logger'
import { matchByStory } from '@/services/matching'
import { generateAnalysis, generatePhrases } from '@/services/analysis'
import { generatePronunciationTip } from '@/services/pronounce'
import { createCorpusServer } from '@/lib/db/corpus-server'
import { buildScaffold, coachReply, polishSentence } from '@/services/practice'

const mockRequireUser = requireUser as jest.MockedFunction<typeof requireUser>
const mockRequireAnon = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockRequireConsent = requireConsent as jest.MockedFunction<typeof requireConsent>
const mockLogApiUsage = logApiUsage as jest.MockedFunction<typeof logApiUsage>

beforeEach(() => {
  jest.clearAllMocks()
  // 鉴权前置放行（模拟已登录），让流程能推进到同意闸这一步。
  mockRequireUser.mockResolvedValue({ userId: 'u1' })
  mockRequireAnon.mockResolvedValue({ userId: 'u1', isAnonymous: false })
})

/** 造一个带鉴权头的请求（同意闸在 body 解析前就早退，故 body 可省）。 */
function makeReq(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
  })
}

/**
 * 7 条下游同意闸出口 —— 每条含：路由名、代表出口类别、调用方式、以及「拒绝时绝不触达」的探针集。
 * probes 覆盖各路由把数据外发/落库的关键副作用函数，全部断言未被调用。
 */
const cases: Array<{ name: string; klass: string; run: () => Promise<Response>; probes: jest.Mock[] }> = [
  { name: 'matching', klass: '重排出口', run: () => matchingPost(makeReq('/api/matching')), probes: [matchByStory as jest.Mock] },
  { name: 'analysis', klass: '分析出口', run: () => analysisPost(makeReq('/api/analysis')), probes: [generateAnalysis as jest.Mock] },
  { name: 'analysis/phrases', klass: '分析出口', run: () => phrasesPost(makeReq('/api/analysis/phrases')), probes: [generatePhrases as jest.Mock] },
  { name: 'pronounce', klass: '发音出口', run: () => pronouncePost(makeReq('/api/pronounce')), probes: [generatePronunciationTip as jest.Mock] },
  { name: 'corpus', klass: '建故事出口', run: () => corpusPost(makeReq('/api/corpus')), probes: [createCorpusServer as jest.Mock] },
  { name: 'practice', klass: '对话出口', run: () => practicePost(makeReq('/api/practice')), probes: [buildScaffold as jest.Mock, coachReply as jest.Mock] },
  { name: 'practice/polish', klass: '润色出口', run: () => polishPost(makeReq('/api/practice/polish')), probes: [polishSentence as jest.Mock] },
]

describe('服务端同意闸 · 下游 7 出口「未同意 → 403 → 不外发/不记账」', () => {
  test.each(cases)('$name（$klass）：requireConsent 拒绝 → 早退 403，且下游未触达', async ({ run, probes }) => {
    const res = await run()

    expect(res.status).toBe(403)
    expect(mockRequireConsent).toHaveBeenCalledTimes(1)      // 确实过了同意闸（谁删这句，此测立刻变红）
    for (const probe of probes) expect(probe).not.toHaveBeenCalled()   // AI 调用/建档：一律未触达
    expect(mockLogApiUsage).not.toHaveBeenCalled()           // 也没有记一笔账
  })
})
