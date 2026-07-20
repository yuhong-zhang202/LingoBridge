/**
 * @module   api/daily-quota.test
 * @desc     每日次数熔断回归守卫 —— 钉死 matching / analysis / analysis-phrases / restructure 四个付费 AI 接口的核心不变式：
 *           超额时【返回 402(QUOTA_EXCEEDED) 且绝不触达 AI 服务】（计次必须在 AI 调用之前，超额零成本）。
 *           这几条此前只有 corpus 月额度间接约束、无每日熔断，单账号可反复调 qwen-plus / qwen-flash 烧钱。
 *           另覆盖注册档 429 与「matching 读档命中不计次」。全部依赖 mock，不碰真实 DB/模型/鉴权。
 *           2026-07-20 起追加一组 analysis / phrases 的入参契约用例：两接口由 GET 改 POST、
 *           参数从 query string 迁到 body，钉死「参数确实从 body 读到」与「非法 body → 400 不记账」。
 * @author   LingoBridge
 * @created  2026-07-19
 */
import { createHash } from 'crypto'

jest.mock('server-only', () => ({}))

// —— 服务层全 mock：断言「超额时这些函数一次都没被调到」= 未触达 AI ——
jest.mock('@/services/analysis', () => ({
  generateAnalysis: jest.fn(),
  generatePhrases: jest.fn(),
}))
jest.mock('@/services/matching', () => ({ matchByStory: jest.fn() }))
jest.mock('@/services/restructure', () => ({ restructureText: jest.fn() }))

jest.mock('@/lib/env-server', () => ({ env: { matchSnapshotEnabled: true } }))
jest.mock('@/lib/api-logger', () => ({
  logApiUsage: jest.fn(),
  qwenPlusCostCny: jest.fn(() => 0.001),
  API_PRICING: { qwen_plus_input_per_1m: 0.8, qwen_plus_output_per_1m: 2.0, qwen_flash_per_1k_tokens: 0.0003 },
}))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(),
  assertCorpusOwner: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({
  requireConsent: jest.fn(() => Promise.resolve(null)),
  hasRecordedConsent: jest.fn(() => Promise.resolve(true)),
}))
jest.mock('@/lib/db/questions', () => ({ getQuestionById: jest.fn() }))
jest.mock('@/lib/db/corpus-server', () => ({
  getCorpusByIdServer: jest.fn(),
  bumpDailyUsageServer: jest.fn(),
  bumpAnonRestructureTodayServer: jest.fn(),
}))
jest.mock('@/lib/db/match-snapshots', () => ({
  getMatchSnapshotServer: jest.fn(),
  upsertMatchSnapshotServer: jest.fn(),
}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/events', () => ({ logEvent: jest.fn() }))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

import { POST as matchingPost } from '@/app/api/matching/route'
import { POST as analysisPost } from '@/app/api/analysis/route'
import { POST as phrasesPost } from '@/app/api/analysis/phrases/route'
import { POST as restructurePost } from '@/app/api/restructure/route'

import { generateAnalysis, generatePhrases } from '@/services/analysis'
import { restructureText } from '@/services/restructure'
import { matchByStory, type FunnelMatchResult } from '@/services/matching'
import { requireUserAllowAnon, assertCorpusOwner } from '@/lib/api-auth'
import { getQuestionById } from '@/lib/db/questions'
import { getCorpusByIdServer, bumpDailyUsageServer, bumpAnonRestructureTodayServer } from '@/lib/db/corpus-server'
import { getMatchSnapshotServer, upsertMatchSnapshotServer } from '@/lib/db/match-snapshots'
import { logApiUsage } from '@/lib/api-logger'
import { getSupabaseServer } from '@/lib/supabase-server'
import {
  ANON_MATCHING_LIMIT, REG_MATCHING_DAILY_LIMIT,
  ANON_ANALYSIS_LIMIT, REG_ANALYSIS_DAILY_LIMIT,
  ANON_PHRASES_LIMIT, REG_PHRASES_DAILY_LIMIT,
  ANON_RESTRUCTURE_LIMIT, REG_RESTRUCTURE_DAILY_LIMIT,
  RANKING_ALGO_VERSION,
} from '@/lib/constants'

const mockRequireUser = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockBumpDaily   = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>
const mockGetQuestion = getQuestionById as jest.MockedFunction<typeof getQuestionById>
const mockGetCorpus   = getCorpusByIdServer as jest.MockedFunction<typeof getCorpusByIdServer>
const mockGetSnapshot = getMatchSnapshotServer as jest.MockedFunction<typeof getMatchSnapshotServer>
const mockMatchByStory = matchByStory as jest.MockedFunction<typeof matchByStory>
const mockLogApiUsage = logApiUsage as jest.MockedFunction<typeof logApiUsage>
const mockGetSupabase = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>
const mockRestructure = restructureText as jest.MockedFunction<typeof restructureText>
const mockBumpAnonRestructure = bumpAnonRestructureTodayServer as jest.MockedFunction<typeof bumpAnonRestructureTodayServer>

const CLEANED = '上周末我去公园散步，待了很久就放松下来了。'
const HASH = createHash('sha256').update(CLEANED, 'utf8').digest('hex')

/** 造一份最小合法 FunnelMatchResult */
function makeResult(): FunnelMatchResult {
  return {
    primary: { pointCode: 'SPA_03', pointName: '自然的地方', dimension: '空间感知', reason: 'r' },
    secondary: null,
    questions: [{
      id: 'q1', part: 1, question_text: 't', question_text_zh: null,
      cue_card_title: null, cue_card_title_zh: null, is_new: false, topic_only: false,
      matched_point: 'SPA_03', pointName: '自然的地方', dimension: '空间感知',
      isPrimaryMatch: true, relevanceScore: 90,
    }],
    count: 1, matchedViaSecondary: false, matchedViaNeighbor: false, neighborPointsUsed: [], noMatch: false,
  }
}

/** 造一份最小合法题目 */
function makeQuestion() {
  return {
    id: 'q1', part: 1 as const, topic: 't', question_text: 'What do you do to relax?',
    question_text_zh: '你如何放松？', cue_card_title: null, cue_card_title_zh: null,
    is_new: false, topic_only: false, parent_card_id: null, created_at: '2026-01-01T00:00:00Z',
    observation_points: ['EMO_04'],
  }
}

function matchingReq(): Request {
  return new Request('http://localhost/api/matching', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ corpusId: 'c1' }),
  })
}
// analysis / phrases 已由 GET 改 POST（有副作用：扣额度 + 调 AI，不能被预取无意触发），入参走 body
function analysisReq(): Request {
  return new Request('http://localhost/api/analysis', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ questionId: 'q1' }),
  })
}
function phrasesReq(): Request {
  return new Request('http://localhost/api/analysis/phrases', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ questionId: 'q1' }),
  })
}

function restructureReq(): Request {
  return new Request('http://localhost/api/restructure', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ rawText: '上周末 去公园 走走 挺放松的' }),
  })
}

/** 设定当前用户身份（匿名 / 注册） */
function asUser(isAnonymous: boolean): void {
  mockRequireUser.mockResolvedValue({ userId: 'u1', isAnonymous })
}

beforeEach(() => {
  jest.clearAllMocks()
  asUser(false)
  ;(assertCorpusOwner as jest.Mock).mockResolvedValue(undefined)
  mockGetCorpus.mockResolvedValue(CLEANED)
  mockGetSnapshot.mockResolvedValue(null)
  ;(upsertMatchSnapshotServer as jest.Mock).mockResolvedValue(undefined)
  mockGetQuestion.mockResolvedValue(makeQuestion() as never)
  mockLogApiUsage.mockResolvedValue(undefined)
  mockMatchByStory.mockResolvedValue(makeResult())
  ;(generateAnalysis as jest.Mock).mockResolvedValue({ structureLabel: 's', focusPoints: [], phrases: [] })
  ;(generatePhrases as jest.Mock).mockResolvedValue([])
  mockRestructure.mockResolvedValue({ cleanedText: CLEANED, usable: true })
  mockBumpAnonRestructure.mockResolvedValue(1)
  mockBumpDaily.mockResolvedValue(1)

  // matching 的 persistMatches 走真实代码，给最小可链式 stub
  const corpusMaybeSingle = jest.fn().mockResolvedValue({ data: { user_id: 'u1' }, error: null })
  mockGetSupabase.mockReturnValue({
    from: (table: string) =>
      table === 'corpus_question_matches'
        ? { upsert: jest.fn().mockResolvedValue({ error: null }) }
        : { select: () => ({ eq: () => ({ maybeSingle: corpusMaybeSingle }) }) },
  } as never)
})

describe('每日次数熔断 · 匿名超额 → 402 且未触达 AI', () => {
  test('matching POST：匿名超 ANON_MATCHING_LIMIT → 402 QUOTA_EXCEEDED，matchByStory 零调用、零记账', async () => {
    asUser(true)
    mockBumpDaily.mockResolvedValue(ANON_MATCHING_LIMIT + 1)

    const res = await matchingPost(matchingReq())

    expect(res.status).toBe(402)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }))
    // 核心不变式：超额时一次模型都没跑 → 零 AI 成本
    expect(mockMatchByStory).not.toHaveBeenCalled()
    expect(mockLogApiUsage).not.toHaveBeenCalled()
  })

  test('analysis POST：匿名超 ANON_ANALYSIS_LIMIT → 402 QUOTA_EXCEEDED，generateAnalysis 零调用、零记账', async () => {
    asUser(true)
    mockBumpDaily.mockResolvedValue(ANON_ANALYSIS_LIMIT + 1)

    const res = await analysisPost(analysisReq())

    expect(res.status).toBe(402)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }))
    expect(generateAnalysis).not.toHaveBeenCalled()
    expect(mockLogApiUsage).not.toHaveBeenCalled()
  })

  test('analysis/phrases POST：匿名超 ANON_PHRASES_LIMIT → 402 QUOTA_EXCEEDED，generatePhrases 零调用、零记账', async () => {
    asUser(true)
    mockBumpDaily.mockResolvedValue(ANON_PHRASES_LIMIT + 1)

    const res = await phrasesPost(phrasesReq())

    expect(res.status).toBe(402)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }))
    expect(generatePhrases).not.toHaveBeenCalled()
    expect(mockLogApiUsage).not.toHaveBeenCalled()
  })

  test('restructure POST：匿名超 ANON_RESTRUCTURE_LIMIT → 402 QUOTA_EXCEEDED，restructureText 零调用、零记账', async () => {
    asUser(true)
    mockBumpAnonRestructure.mockResolvedValue(ANON_RESTRUCTURE_LIMIT + 1)

    const res = await restructurePost(restructureReq())

    expect(res.status).toBe(402)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }))
    expect(mockRestructure).not.toHaveBeenCalled()
    expect(mockLogApiUsage).not.toHaveBeenCalled()
  })
})

describe('每日次数熔断 · 注册超熔断上限 → 429 且未触达 AI（不带 code，不弹配额层）', () => {
  test('matching POST：注册超 REG_MATCHING_DAILY_LIMIT → 429', async () => {
    mockBumpDaily.mockResolvedValue(REG_MATCHING_DAILY_LIMIT + 1)
    const res = await matchingPost(matchingReq())
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual(expect.not.objectContaining({ code: 'QUOTA_EXCEEDED' }))
    expect(mockMatchByStory).not.toHaveBeenCalled()
  })

  test('analysis POST：注册超 REG_ANALYSIS_DAILY_LIMIT → 429', async () => {
    mockBumpDaily.mockResolvedValue(REG_ANALYSIS_DAILY_LIMIT + 1)
    const res = await analysisPost(analysisReq())
    expect(res.status).toBe(429)
    expect(generateAnalysis).not.toHaveBeenCalled()
  })

  test('analysis/phrases POST：注册超 REG_PHRASES_DAILY_LIMIT → 429', async () => {
    mockBumpDaily.mockResolvedValue(REG_PHRASES_DAILY_LIMIT + 1)
    const res = await phrasesPost(phrasesReq())
    expect(res.status).toBe(429)
    expect(generatePhrases).not.toHaveBeenCalled()
  })

  test('restructure POST：注册超 REG_RESTRUCTURE_DAILY_LIMIT → 429，restructureText 零调用、零记账', async () => {
    mockBumpDaily.mockResolvedValue(REG_RESTRUCTURE_DAILY_LIMIT + 1)

    const res = await restructurePost(restructureReq())

    expect(res.status).toBe(429)
    expect(await res.json()).toEqual(expect.not.objectContaining({ code: 'QUOTA_EXCEEDED' }))
    expect(mockRestructure).not.toHaveBeenCalled()
    expect(mockLogApiUsage).not.toHaveBeenCalled()
  })
})

describe('每日次数熔断 · 未超额放行 + 计次口径', () => {
  test('三条路由在额度内均正常返回 200，且各按自己的 kind 计一次', async () => {
    mockBumpDaily.mockResolvedValue(1)

    expect((await matchingPost(matchingReq())).status).toBe(200)
    expect(mockBumpDaily).toHaveBeenCalledWith('u1', 'matching')

    jest.clearAllMocks()
    beforeEachRefresh()
    expect((await analysisPost(analysisReq())).status).toBe(200)
    expect(mockBumpDaily).toHaveBeenCalledWith('u1', 'analysis')

    jest.clearAllMocks()
    beforeEachRefresh()
    expect((await phrasesPost(phrasesReq())).status).toBe(200)
    expect(mockBumpDaily).toHaveBeenCalledWith('u1', 'phrases')

    jest.clearAllMocks()
    beforeEachRefresh()
    expect((await restructurePost(restructureReq())).status).toBe(200)
    expect(mockBumpDaily).toHaveBeenCalledWith('u1', 'restructure')
  })

  test('restructure 匿名：只走 restructure 专用计数，不动 daily_usage（匿名侧原逻辑未被改坏）', async () => {
    asUser(true)
    mockBumpAnonRestructure.mockResolvedValue(1)

    const res = await restructurePost(restructureReq())

    expect(res.status).toBe(200)
    expect(mockBumpAnonRestructure).toHaveBeenCalledWith('u1')
    expect(mockBumpDaily).not.toHaveBeenCalled()
  })

  test('matching 读档命中：不跑模型 → 不扣配额（重看已匹配结果不该被白扣次数）', async () => {
    mockGetSnapshot.mockResolvedValue({ result: makeResult(), storyHash: HASH, algoVersion: RANKING_ALGO_VERSION })

    const res = await matchingPost(matchingReq())

    expect(res.status).toBe(200)
    expect(mockMatchByStory).not.toHaveBeenCalled()
    expect(mockBumpDaily).not.toHaveBeenCalled()
  })
})

// analysis / phrases 由 GET 改 POST 后，入参从 query string 迁到 body。
// 这组用例钉死「参数真的是从 body 读到的」—— 若哪天有人把解析写回 searchParams，
// 上面的熔断用例仍会全绿（它们只传 questionId，且 400 与 402 都不触达 AI），本组会立刻变红。
describe('analysis / phrases POST · 入参契约（query → body 迁移）', () => {
  test('analysis：body 缺 questionId → 400，且不扣配额、不触达 AI', async () => {
    const req = new Request('http://localhost/api/analysis', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await analysisPost(req)

    expect(res.status).toBe(400)
    expect(mockBumpDaily).not.toHaveBeenCalled()          // 计次在校验之后，失败请求不白扣次数
    expect(generateAnalysis).not.toHaveBeenCalled()
  })

  test('analysis：body 里的 storyId 被读到 → 走越权校验并带进故事读取', async () => {
    const req = new Request('http://localhost/api/analysis', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'q1', storyId: 'c1' }),
    })

    const res = await analysisPost(req)

    expect(res.status).toBe(200)
    expect(assertCorpusOwner).toHaveBeenCalledWith('u1', 'c1')
    expect(mockGetCorpus).toHaveBeenCalledWith('c1')
  })

  test('phrases：body 里的 level 被读到并传给 generatePhrases（换档位不再走 query）', async () => {
    const req = new Request('http://localhost/api/analysis/phrases', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'q1', storyId: 'c1', level: '7.5' }),
    })

    const res = await phrasesPost(req)

    expect(res.status).toBe(200)
    expect(generatePhrases).toHaveBeenCalledWith(
      expect.objectContaining({ level: '7.5' }),
      expect.any(Function),
    )
  })

  test('phrases：body 未给 level → 回退默认 6.0（旧 query 缺省语义不变）', async () => {
    const res = await phrasesPost(phrasesReq())

    expect(res.status).toBe(200)
    expect(generatePhrases).toHaveBeenCalledWith(
      expect.objectContaining({ level: '6.0' }),
      expect.any(Function),
    )
  })

  test('analysis：请求体不是合法 JSON → 400（而不是抛进 catch 白记一条 error 账）', async () => {
    const req = new Request('http://localhost/api/analysis', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: '这不是 JSON',
    })

    const res = await analysisPost(req)

    expect(res.status).toBe(400)
    expect(mockLogApiUsage).not.toHaveBeenCalled()
    expect(generateAnalysis).not.toHaveBeenCalled()
  })
})

/** clearAllMocks 后重建本套用例所需的最小桩（供单个 test 内跨路由复用时调用） */
function beforeEachRefresh(): void {
  asUser(false)
  ;(assertCorpusOwner as jest.Mock).mockResolvedValue(undefined)
  mockGetCorpus.mockResolvedValue(CLEANED)
  mockGetQuestion.mockResolvedValue(makeQuestion() as never)
  mockLogApiUsage.mockResolvedValue(undefined)
  ;(generateAnalysis as jest.Mock).mockResolvedValue({ structureLabel: 's', focusPoints: [], phrases: [] })
  ;(generatePhrases as jest.Mock).mockResolvedValue([])
  mockRestructure.mockResolvedValue({ cleanedText: CLEANED, usable: true })
  mockBumpAnonRestructure.mockResolvedValue(1)
  mockBumpDaily.mockResolvedValue(1)
}
