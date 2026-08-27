/**
 * @module   api/story-missing-event.test
 * @desc     flow.story_missing 四个触发点的守卫 —— 「该有语料却取不到」的静默降级必须留下痕迹。
 *
 *           被测的是【真实 handler】而非 helper：四条路各自 import 一次判定、各自传一个 stage，
 *           任一处漏接 / 传错 stage / 把条件写反，tsc 与 build 都不会响，只会表现为
 *           「事件在库里查不到」或「事件被正常流量淹没」——两者上线后都很难发现。
 *           故断言一律落到 logEvent 实际收到的整条内容（= 真正写库的东西）。
 *
 *           【三条红线，逐条有用例】
 *             ① storyId 为空【不许发】—— 那是合法的通用分析（用户没绑语料）。写反 = 事件被
 *                正常流量淹没、等于没埋，是本改动最容易搞砸的一条，故每个 stage 都配对照组；
 *             ② 四个 stage 各发各的，不许串味（analysis / analysis_stream 是同一路由的两条实现路）；
 *             ③ props 只有 stage 一个字段：故事正文、摘要一个字都不许进 props；
 *                语料 id 只走 storyId（= flow_events 的 story_id 列），不进 props。
 *
 *           practice 那一路特意跑【真实的 buildScaffold】（只替掉 coachReply / generateAnalysis 两次
 *           AI 调用）：service → 回调 → route 发事件这条接线本身就是被测对象，把 service 整个 mock 掉
 *           就等于把要验的东西验没了。
 * @author   LingoBridge
 * @created  2026-08-27
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/events', () => ({ logEvent: jest.fn(() => Promise.resolve()) }))
jest.mock('@/lib/env-server', () => ({
  env: { qaTrafficToken: '', dashscopeApiKey: 'test-key', dashscopeBaseUrl: 'http://localhost/dashscope' },
}))
jest.mock('@/lib/db/questions', () => ({ getQuestionById: jest.fn(), getQuestionsByParent: jest.fn(() => Promise.resolve([])) }))
jest.mock('@/lib/db/question-analyses', () => ({
  getPersonalAnalysis: jest.fn(() => Promise.resolve(null)),
  upsertPersonalAnalysis: jest.fn(() => Promise.resolve(undefined)),
}))
jest.mock('@/lib/db/corpus-server', () => ({
  getCorpusByIdServer: jest.fn(),
  getCorpusPrimaryPointCodeServer: jest.fn(() => Promise.resolve(null)),
  bumpDailyUsageServer: jest.fn(() => Promise.resolve(1)),
}))
jest.mock('@/lib/db/practice-sessions-server', () => ({ countReviewPracticeThisMonthServer: jest.fn(() => Promise.resolve(0)) }))
jest.mock('@/services/analysis', () => ({
  generateAnalysis: jest.fn(),
  generateAnalysisStreaming: jest.fn(),
  generatePhrases: jest.fn(),
}))
// 只替掉 coachReply（一次真实千问调用），buildScaffold 用真实实现 —— 它正是 practice 那一路的被测对象
jest.mock('@/services/practice', () => {
  const actual = jest.requireActual('@/services/practice') as typeof import('@/services/practice')
  return { ...actual, coachReply: jest.fn(() => Promise.resolve('Hi, shall we start?')) }
})
jest.mock('@/lib/api-logger', () => ({ logApiUsage: jest.fn(() => Promise.resolve()), qwenPlusCostCny: jest.fn(() => 0.001) }))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(() => Promise.resolve({ userId: 'u1', isAnonymous: false })),
  assertCorpusOwner: jest.fn(() => Promise.resolve(undefined)),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({ requireConsent: jest.fn(() => Promise.resolve(null)) }))
jest.mock('@/lib/global-budget-breaker', () => ({ requireGlobalBudget: jest.fn(() => Promise.resolve(null)) }))
jest.mock('@/lib/concurrency-gate', () => ({
  createConcurrencyGate: () => ({ acquire: jest.fn(() => Promise.resolve({ ok: true, release: jest.fn() })) }),
}))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))

import { POST as analysisPOST } from '@/app/api/analysis/route'
import { POST as phrasesPOST } from '@/app/api/analysis/phrases/route'
import { POST as practicePOST } from '@/app/api/practice/route'
import { logEvent } from '@/lib/events'
import { getQuestionById } from '@/lib/db/questions'
import { getCorpusByIdServer } from '@/lib/db/corpus-server'
import { generateAnalysis, generateAnalysisStreaming, generatePhrases } from '@/services/analysis'
import { env } from '@/lib/env-server'
import { requireUserAllowAnon } from '@/lib/api-auth'
import { INTERNAL_ACCOUNT_IDS } from '@/lib/internal-accounts'
import { STORY_MISSING_STAGE } from '@/lib/event-schema'
import type { QuestionAnalysis } from '@/lib/types'

const mockLogEvent  = logEvent as jest.MockedFunction<typeof logEvent>
const mockGetQ      = getQuestionById as jest.MockedFunction<typeof getQuestionById>
const mockGetCorpus = getCorpusByIdServer as jest.MockedFunction<typeof getCorpusByIdServer>
const mockGenerate  = generateAnalysis as jest.MockedFunction<typeof generateAnalysis>
const mockGenStream = generateAnalysisStreaming as jest.MockedFunction<typeof generateAnalysisStreaming>
const mockGenPhrase = generatePhrases as jest.MockedFunction<typeof generatePhrases>
const mockRequireUser = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>

/** 语料 id 用真 UUID：flow_events.story_id 是 uuid 列，非 UUID 会被 logEvent 收敛成 null（见 events.ts） */
const STORY_ID = '123e4567-e89b-12d3-a456-426614174000'
const STORY = '上周末我陪奶奶去了趟老城区，她一路都在讲从前的事。'
const ANALYSIS: QuestionAnalysis = {
  structureLabel: '交代背景 · 讲清重点',
  focusPoints: [{ title: '交代背景', desc: '一句话带过时间地点。' }],
  phrases: [{ group: '感受', items: [{ text: 'felt calm', meaning: '平静', scene: '散步时' }] }],
}

function makeQuestion() {
  return {
    id: 'q1', part: 1 as const, question_text: 'Describe a walk you enjoyed.', question_text_zh: '描述一次散步。',
    cue_card_title: null, cue_card_title_zh: null, observation_points: ['SPA_03'], season: '2026-05', is_new: false,
  }
}

/** 四条被测路径共用的请求构造（默认带 flow id，供断言 flowId 透传） */
function makeReq(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json', 'x-flow-id': 'flow-abc', ...headers },
    body: JSON.stringify(body),
  })
}

/** 本次收到的 flow.story_missing 事件（0 条或多条都如实返回，供计数断言） */
function storyMissingCalls(): Parameters<typeof logEvent>[0][] {
  return mockLogEvent.mock.calls.map(([e]) => e).filter((e) => e.event === 'flow.story_missing')
}

/** 四条路径统一的触发器：body 直接透传，返回读干后的响应 */
async function callStage(stage: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
  const res =
    stage === 'analysis'        ? await analysisPOST(makeReq('/api/analysis?stream=0', body, headers))
    : stage === 'analysis_stream' ? await analysisPOST(makeReq('/api/analysis', body, headers))
    : stage === 'phrases'       ? await phrasesPOST(makeReq('/api/analysis/phrases', body, headers))
    :                             await practicePOST(makeReq('/api/practice', body, headers))
  await res.text()   // SSE 路要读干，否则流不跑完
  return res
}

beforeEach(() => {
  jest.clearAllMocks()
  env.qaTrafficToken = ''
  mockRequireUser.mockResolvedValue({ userId: 'u1', isAnonymous: false })
  mockGetQ.mockResolvedValue(makeQuestion() as never)
  mockGenerate.mockResolvedValue(ANALYSIS)
  mockGenPhrase.mockResolvedValue(ANALYSIS.phrases)
  mockGenStream.mockImplementation(async (_input, onSection, onUsage) => {
    onSection?.({ kind: 'structureLabel', value: ANALYSIS.structureLabel })
    onUsage?.({ promptTokens: 100, completionTokens: 40 })
    return ANALYSIS
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// ① 四个触发点各发一条，stage 不串味
// ───────────────────────────────────────────────────────────────────────────────
describe('四个触发点 · 语料读不到 → 各发一条 flow.story_missing', () => {
  test.each([
    ['analysis'],          // /api/analysis?stream=0（降级路，handleBuffered）
    ['analysis_stream'],   // /api/analysis（真实用户默认路，handleStreaming）
    ['phrases'],           // /api/analysis/phrases
    ['practice'],          // /api/practice 首轮（真实 buildScaffold 回调 → route 发事件）
  ])('stage=%s：storyId 非空 + 正文 null → 恰好一条，整条内容锁死', async (stage) => {
    mockGetCorpus.mockResolvedValue(null)

    await callStage(stage, { questionId: 'q1', storyId: STORY_ID })

    const calls = storyMissingCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      event: 'flow.story_missing',
      flowId: 'flow-abc',
      storyId: STORY_ID,      // 走 story_id 【列】，不进 props
      userId: 'u1',
      props: { stage },       // 🔴 只有 stage 一个字段
      isQa: false,
    })
  })

  test('四个 stage 全部被真实 handler 覆盖过（漏一个 = 那条路的降级永远查不到）', async () => {
    mockGetCorpus.mockResolvedValue(null)
    const seen: string[] = []
    for (const stage of STORY_MISSING_STAGE) {
      jest.clearAllMocks()
      mockGetQ.mockResolvedValue(makeQuestion() as never)
      mockGenerate.mockResolvedValue(ANALYSIS)
      mockGenPhrase.mockResolvedValue(ANALYSIS.phrases)
      await callStage(stage, { questionId: 'q1', storyId: STORY_ID })
      const props = storyMissingCalls()[0]?.props as { stage?: string } | undefined
      if (props?.stage) seen.push(props.stage)
    }
    expect(seen).toEqual([...STORY_MISSING_STAGE])
  })

  test.each([['analysis'], ['analysis_stream'], ['phrases'], ['practice']])(
    'stage=%s：正文是空串 / 全空白（含全角空格与换行）同样算取不到',
    async (stage) => {
      for (const text of ['', '   ', '\n\t ', '　　']) {
        jest.clearAllMocks()
        mockGetQ.mockResolvedValue(makeQuestion() as never)
        mockGenerate.mockResolvedValue(ANALYSIS)
        mockGenPhrase.mockResolvedValue(ANALYSIS.phrases)
        mockGetCorpus.mockResolvedValue(text)
        await callStage(stage, { questionId: 'q1', storyId: STORY_ID })
        expect(storyMissingCalls()).toHaveLength(1)
      }
    },
  )

  test('analysis 两条实现路的 stage 必须不同（同一路由两份代码，最易只改一处）', async () => {
    mockGetCorpus.mockResolvedValue(null)
    await callStage('analysis', { questionId: 'q1', storyId: STORY_ID })
    const buffered = (storyMissingCalls()[0]?.props as { stage: string }).stage
    jest.clearAllMocks()
    mockGetQ.mockResolvedValue(makeQuestion() as never)
    await callStage('analysis_stream', { questionId: 'q1', storyId: STORY_ID })
    const streamed = (storyMissingCalls()[0]?.props as { stage: string }).stage
    expect([buffered, streamed]).toEqual(['analysis', 'analysis_stream'])
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// ② 🔴 对照组：storyId 为空【绝不发】—— 这条写反，事件就被正常的通用分析流量淹没
// ───────────────────────────────────────────────────────────────────────────────
describe('对照组 · 不该发的一律不发', () => {
  test.each([['analysis'], ['analysis_stream'], ['phrases'], ['practice']])(
    'stage=%s：不带 storyId（合法的通用分析 / 无语料练习）→ 零条事件',
    async (stage) => {
      mockGetCorpus.mockResolvedValue(null)
      await callStage(stage, { questionId: 'q1' })
      expect(storyMissingCalls()).toHaveLength(0)
      // 连语料都没去读（storyId 为空时压根不查库），从源头证明这不是「读到了空所以没发」
      expect(mockGetCorpus).not.toHaveBeenCalled()
    },
  )

  test.each([['analysis'], ['analysis_stream'], ['phrases'], ['practice']])(
    'stage=%s：storyId 传空串 → 零条事件（空串与缺省同义）',
    async (stage) => {
      mockGetCorpus.mockResolvedValue(null)
      await callStage(stage, { questionId: 'q1', storyId: '' })
      expect(storyMissingCalls()).toHaveLength(0)
    },
  )

  test.each([['analysis'], ['analysis_stream'], ['phrases'], ['practice']])(
    'stage=%s：语料正文读到了 → 零条事件（正常路径不许有噪声）',
    async (stage) => {
      mockGetCorpus.mockResolvedValue(STORY)
      await callStage(stage, { questionId: 'q1', storyId: STORY_ID })
      expect(storyMissingCalls()).toHaveLength(0)
    },
  )

  test('practice 后续轮（客户端带 scaffold，不读语料）→ 零条事件', async () => {
    mockGetCorpus.mockResolvedValue(null)
    await callStage('practice', {
      questionId: 'q1', storyId: STORY_ID,
      scaffold: { part: 1, questionForAI: 'Q', displayEn: 'Q', displayZh: '题', focusPoints: [], part3Questions: [], level: '6.0' },
      messages: [],
    })
    expect(storyMissingCalls()).toHaveLength(0)
    expect(mockGetCorpus).not.toHaveBeenCalled()
  })

  test('缺 questionId → 400 早退，零条事件（不在没走到语料的路上凭空造数）', async () => {
    mockGetCorpus.mockResolvedValue(null)
    const res = await analysisPOST(makeReq('/api/analysis', { storyId: STORY_ID }))
    await res.text()
    expect(res.status).toBe(400)
    expect(storyMissingCalls()).toHaveLength(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// ③ 🔴 隐私：故事正文一个字都不许进事件
// ───────────────────────────────────────────────────────────────────────────────
describe('隐私红线 · 事件里不含任何用户内容', () => {
  test.each([['analysis'], ['analysis_stream'], ['phrases'], ['practice']])(
    'stage=%s：整条事件序列化后不含正文片段，props 只有 stage',
    async (stage) => {
      // 走「读库抛错」这一路：story 兜底为 undefined，同样算取不到（一处判定覆盖两种走法）
      mockGetCorpus.mockRejectedValue(new Error('读库炸了'))
      // practice 的 service 不吞读库异常（会走 500），故那一路仍用返回 null 的走法
      if (stage === 'practice') mockGetCorpus.mockResolvedValue(null)

      await callStage(stage, { questionId: 'q1', storyId: STORY_ID, story: '' })

      const calls = storyMissingCalls()
      expect(calls).toHaveLength(1)
      expect(Object.keys(calls[0].props ?? {})).toEqual(['stage'])
      const dumped = JSON.stringify(calls[0])
      for (const secret of ['奶奶', '老城区', 'Describe a walk', '题目', '散步']) {
        expect(dumped).not.toContain(secret)
      }
    },
  )

  test('客户端塞进 body.story 的自由文本不会进事件（且它本身就是兜底正文，不该被当成语料）', async () => {
    mockGetCorpus.mockResolvedValue(null)
    // body.story 有值 → 兜底成功 → 按「取到了正文」处理，不发事件（生产里这个字段恒为 undefined）
    await callStage('analysis_stream', { questionId: 'q1', storyId: STORY_ID, story: '我偷偷塞进来的一段原文' })
    expect(storyMissingCalls()).toHaveLength(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// ④ QA 流量标记：漏了它，产品方自测触发的降级会混进真实数据（本事件量本就稀少）
// ───────────────────────────────────────────────────────────────────────────────
describe('QA 流量标记', () => {
  test('带对 QA 头 → isQa=true', async () => {
    env.qaTrafficToken = 's3cret-token'
    mockGetCorpus.mockResolvedValue(null)
    await callStage('analysis_stream', { questionId: 'q1', storyId: STORY_ID }, { 'x-qa-traffic': 's3cret-token' })
    expect(storyMissingCalls()[0].isQa).toBe(true)
  })

  test('服务端未配 token → 头再对也 false（fail-closed）', async () => {
    env.qaTrafficToken = ''
    mockGetCorpus.mockResolvedValue(null)
    await callStage('analysis_stream', { questionId: 'q1', storyId: STORY_ID }, { 'x-qa-traffic': 's3cret-token' })
    expect(storyMissingCalls()[0].isQa).toBe(false)
  })

  test('内部账户不带头 → true（服务端权威来源）', async () => {
    mockRequireUser.mockResolvedValue({ userId: Array.from(INTERNAL_ACCOUNT_IDS)[0], isAnonymous: false })
    mockGetCorpus.mockResolvedValue(null)
    await callStage('practice', { questionId: 'q1', storyId: STORY_ID })
    expect(storyMissingCalls()[0].isQa).toBe(true)
  })
})
