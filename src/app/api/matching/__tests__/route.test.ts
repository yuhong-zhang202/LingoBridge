/**
 * @module   api/matching/route.test
 * @desc     匹配接口缓存逻辑单测 —— 守卫「匹配一次→冻结存档→重访读档」的核心不变式：
 *           命中读档时【绝不调用 matchByStory】（这是省成本 + 消除高/中/低漂浮的根本）。
 *           覆盖命中 / hash 失效 / algoVersion 失效 / 回滚开关关四条路径。全部依赖 mock。
 * @author   LingoBridge
 * @created  2026-07-17
 */
import { createHash } from 'crypto'

// —— 依赖全 mock 在模块边界（不碰真实 DB / 模型 / 鉴权 / 埋点）——
jest.mock('server-only', () => ({}))
jest.mock('@/lib/env-server', () => ({ env: { matchSnapshotEnabled: true } }))
jest.mock('@/services/matching', () => ({ matchByStory: jest.fn() }))
jest.mock('@/lib/db/match-snapshots', () => ({
  getMatchSnapshotServer: jest.fn(),
  upsertMatchSnapshotServer: jest.fn(),
}))
jest.mock('@/lib/db/corpus-server', () => ({ getCorpusByIdServer: jest.fn() }))
jest.mock('@/lib/api-auth', () => ({
  requireUser: jest.fn(),
  assertCorpusOwner: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
// 同意闸硬前置：matching 在 AI 调用前先过 requireConsent。本套测的是缓存/记账逻辑，
// 默认放行（返回 null）以测到下游真实逻辑——与已 mock 的 requireUser 同理，提供前置通过的前提。
jest.mock('@/lib/consent-server', () => ({ requireConsent: jest.fn(() => Promise.resolve(null)) }))
jest.mock('@/lib/events', () => ({ logEvent: jest.fn() }))
jest.mock('@/lib/api-logger', () => ({
  logApiUsage: jest.fn(),
  qwenPlusCostCny: jest.fn(() => 0.001),
  API_PRICING: { qwen_plus_input_per_1m: 0.8, qwen_plus_output_per_1m: 2.0 },
}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

import { POST } from '@/app/api/matching/route'
import { env } from '@/lib/env-server'
import { matchByStory, type FunnelMatchResult } from '@/services/matching'
import { getMatchSnapshotServer, upsertMatchSnapshotServer } from '@/lib/db/match-snapshots'
import { getCorpusByIdServer } from '@/lib/db/corpus-server'
import { requireUser, assertCorpusOwner } from '@/lib/api-auth'
import { logEvent } from '@/lib/events'
import { logApiUsage } from '@/lib/api-logger'
import { getSupabaseServer } from '@/lib/supabase-server'
import { RANKING_ALGO_VERSION } from '@/lib/constants'

const mockMatchByStory   = matchByStory as jest.MockedFunction<typeof matchByStory>
const mockGetSnapshot    = getMatchSnapshotServer as jest.MockedFunction<typeof getMatchSnapshotServer>
const mockUpsertSnapshot = upsertMatchSnapshotServer as jest.MockedFunction<typeof upsertMatchSnapshotServer>
const mockGetCorpus      = getCorpusByIdServer as jest.MockedFunction<typeof getCorpusByIdServer>
const mockRequireUser    = requireUser as jest.MockedFunction<typeof requireUser>
const mockAssertOwner    = assertCorpusOwner as jest.MockedFunction<typeof assertCorpusOwner>
const mockLogEvent       = logEvent as jest.MockedFunction<typeof logEvent>
const mockLogApiUsage    = logApiUsage as jest.MockedFunction<typeof logApiUsage>
const mockGetSupabase    = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

// —— 桩数据 ——
const CLEANED = '上周末我去公园散步，待了很久就放松下来了。'
const HASH = createHash('sha256').update(CLEANED, 'utf8').digest('hex')

/** 造一份最小合法 FunnelMatchResult（tag 标明来自存档还是新算，便于断言返回体来源） */
function makeResult(tag: string): FunnelMatchResult {
  return {
    primary: { pointCode: 'SPA_03', pointName: '自然的地方', dimension: '空间感知', reason: 'r' },
    secondary: null,
    questions: [{
      id: `q-${tag}`, part: 1, question_text: 't', question_text_zh: null,
      cue_card_title: null, cue_card_title_zh: null, is_new: false, topic_only: false,
      matched_point: 'SPA_03', pointName: '自然的地方', dimension: '空间感知',
      isPrimaryMatch: true, relevanceScore: 90,
    }],
    count: 1, matchedViaSecondary: false, matchedViaNeighbor: false, neighborPointsUsed: [], noMatch: false,
  }
}

/** 构造一个带鉴权头与 corpusId 的 POST 请求 */
function makeReq(corpusId = 'c1'): Request {
  return new Request('http://localhost/api/matching', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'x-flow-id': 'f', 'content-type': 'application/json' },
    body: JSON.stringify({ corpusId }),
  })
}

/** corpus_question_matches 的 upsert stub —— 断言「读档命中不刷反查表」的探针 */
let cqmUpsert: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  ;(env as { matchSnapshotEnabled: boolean }).matchSnapshotEnabled = true

  mockRequireUser.mockResolvedValue({ userId: 'u1' })
  mockAssertOwner.mockResolvedValue(undefined)
  mockGetCorpus.mockResolvedValue(CLEANED)
  mockGetSnapshot.mockResolvedValue(null)
  mockUpsertSnapshot.mockResolvedValue(undefined)
  mockLogEvent.mockResolvedValue(undefined)
  mockLogApiUsage.mockResolvedValue(undefined)
  mockMatchByStory.mockResolvedValue(makeResult('fresh'))

  // persistMatches 走真实代码，直接用 getSupabaseServer；给它一个可链式调用的最小 stub。
  cqmUpsert = jest.fn().mockResolvedValue({ error: null })
  const corpusMaybeSingle = jest.fn().mockResolvedValue({ data: { user_id: 'u1' }, error: null })
  mockGetSupabase.mockReturnValue({
    from: (table: string) => {
      if (table === 'corpus_question_matches') return { upsert: cqmUpsert }
      return { select: () => ({ eq: () => ({ maybeSingle: corpusMaybeSingle }) }) }
    },
  } as never)
})

describe('POST /api/matching · 匹配存档缓存逻辑', () => {
  test('1. 命中读档：存档 + hash 一致 + algoVersion 一致 → 返回存档、不调 matchByStory、不刷反查表、不记 usage', async () => {
    const cached = makeResult('cache')
    mockGetSnapshot.mockResolvedValue({ result: cached, storyHash: HASH, algoVersion: RANKING_ALGO_VERSION })

    const res = await POST(makeReq())
    const body = (await res.json()) as FunnelMatchResult & { servedFrom: string }

    // 核心不变式：命中时模型零调用
    expect(mockMatchByStory).not.toHaveBeenCalled()
    // 不写快照、不刷 corpus_question_matches 反查表、不记 usage
    expect(mockUpsertSnapshot).not.toHaveBeenCalled()
    expect(cqmUpsert).not.toHaveBeenCalled()
    expect(mockLogApiUsage).not.toHaveBeenCalled()
    // 返回体 = 存档结果 + servedFrom='cache'
    expect(body.servedFrom).toBe('cache')
    expect(body.questions.map((q) => q.id)).toEqual(['q-cache'])
    // 埋点标 served_from='cache'
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'match.result', props: expect.objectContaining({ served_from: 'cache' }) }),
    )
  })

  test('2. hash 失效：存档在但 storyHash 不一致 → 重算、写新档、servedFrom=fresh，且记两条账（萃取 + 重排）', async () => {
    const cached = makeResult('stale')
    mockGetSnapshot.mockResolvedValue({ result: cached, storyHash: 'DIFFERENT_HASH', algoVersion: RANKING_ALGO_VERSION })

    const res = await POST(makeReq())
    const body = (await res.json()) as FunnelMatchResult & { servedFrom: string }

    // matchByStory 现在带 usage sink（第二个参数），断言仍以 cleanedText 起手
    expect(mockMatchByStory).toHaveBeenCalledWith(CLEANED, expect.any(Object))
    expect(mockUpsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ corpusId: 'c1', userId: 'u1', storyHash: HASH, algoVersion: RANKING_ALGO_VERSION }),
    )
    expect(body.servedFrom).toBe('fresh')
    expect(body.questions.map((q) => q.id)).toEqual(['q-fresh'])
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ props: expect.objectContaining({ served_from: 'fresh' }) }),
    )
    // 核心回归：matchByStory 内部是萃取 + 重排两次 qwen 调用，必须各记一条（此前漏了最大的重排）。
    expect(mockLogApiUsage).toHaveBeenCalledTimes(2)
    expect(mockLogApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'qwen_plus', metadata: expect.objectContaining({ phase: 'extraction' }) }),
    )
    expect(mockLogApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'qwen_plus', metadata: expect.objectContaining({ phase: 'ranking' }) }),
    )
  })

  test('5. fresh 且模型吐了真实 usage：两条账均按真实 token 记（cost_source=actual）', async () => {
    // 让 matchByStory 触发 usage sink 两个回调，模拟 callLLMJson 上抛的真实用量
    mockMatchByStory.mockImplementation(async (_text, usage) => {
      usage?.onExtraction?.({ promptTokens: 111, completionTokens: 22 })
      usage?.onRanking?.({ promptTokens: 555, completionTokens: 88 })
      return makeResult('fresh')
    })

    await POST(makeReq())

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'qwen_plus',
        usage_amount: 111 + 22,
        metadata: expect.objectContaining({ phase: 'extraction', prompt_tokens: 111, completion_tokens: 22, cost_source: 'actual' }),
      }),
    )
    expect(mockLogApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'qwen_plus',
        usage_amount: 555 + 88,
        metadata: expect.objectContaining({ phase: 'ranking', prompt_tokens: 555, completion_tokens: 88, cost_source: 'actual' }),
      }),
    )
  })

  test('6. fresh 但零候选（noMatch）：不调重排 → 只记萃取一条账', async () => {
    const empty = makeResult('fresh')
    empty.questions = []
    empty.count = 0
    empty.noMatch = true
    mockMatchByStory.mockResolvedValue(empty)

    await POST(makeReq())

    // 重排仅在有候选题时才会被 matchByStory 调用，零候选时不该记重排那条
    expect(mockLogApiUsage).toHaveBeenCalledTimes(1)
    expect(mockLogApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ phase: 'extraction' }) }),
    )
  })

  test('3. algoVersion 失效：storyHash 一致但 algoVersion 不一致 → 同样重算、写新档、servedFrom=fresh', async () => {
    const cached = makeResult('oldalgo')
    mockGetSnapshot.mockResolvedValue({ result: cached, storyHash: HASH, algoVersion: 'v0-obsolete' })

    const res = await POST(makeReq())
    const body = (await res.json()) as FunnelMatchResult & { servedFrom: string }

    expect(mockMatchByStory).toHaveBeenCalledWith(CLEANED, expect.any(Object))
    expect(mockUpsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ storyHash: HASH, algoVersion: RANKING_ALGO_VERSION }),
    )
    expect(body.servedFrom).toBe('fresh')
  })

  test('4. 回滚开关关：env.matchSnapshotEnabled=false → 永远未命中，不查存档、每次重算', async () => {
    ;(env as { matchSnapshotEnabled: boolean }).matchSnapshotEnabled = false
    // 即便有一份完全命中的存档，开关关时也不应被查询/采用
    mockGetSnapshot.mockResolvedValue({ result: makeResult('cache'), storyHash: HASH, algoVersion: RANKING_ALGO_VERSION })

    const res = await POST(makeReq())
    const body = (await res.json()) as FunnelMatchResult & { servedFrom: string }

    expect(mockGetSnapshot).not.toHaveBeenCalled()
    expect(mockMatchByStory).toHaveBeenCalledWith(CLEANED, expect.any(Object))
    expect(body.servedFrom).toBe('fresh')
    expect(body.questions.map((q) => q.id)).toEqual(['q-fresh'])
  })
})
