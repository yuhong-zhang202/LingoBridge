/**
 * @module   persist-match-level.test
 * @desc     事故守卫①的下半截（【行为】测试）：钉的不是 levelForScore 的返回值，而是它造成的【后果】——
 *           往 corpus_question_matches 里真正写下去的那几行。
 *
 *           事故形态（40da791 之前）：重排整体降级时全批候选没有分数，落库层 `score ?? 100` 把它们
 *           一律写成 match_level='high'。这张表是反查表（题库页「这道题匹配过哪条语料」等都读它），
 *           谎一旦落库就被下游继承，且不会自愈——重排下次跑成功也只是 upsert 覆盖有分的那些，
 *           降级批次留下的假 high 行还在。
 *
 *           支点选择：走真实的 persistMatches（不 mock @/lib/match-level），只 stub Supabase client，
 *           断言 upsert 收到的行。这样无论是 levelForScore 被改回历史形态，还是有人在 persistMatches
 *           里重新内联一个 `?? 100`，都会红。
 * @author   LingoBridge
 * @created  2026-08-08
 */
// —— 依赖全 mock 在模块边界（不碰真实 DB / 模型 / 鉴权 / 埋点），与同目录 route.test.ts 同款脚手架 ——
jest.mock('server-only', () => ({}))
jest.mock('@/lib/env-server', () => ({ env: { matchSnapshotEnabled: true, qaTrafficToken: '' } }))
jest.mock('@/services/matching', () => ({ matchByStory: jest.fn() }))
jest.mock('@/lib/db/match-snapshots', () => ({
  getMatchSnapshotServer: jest.fn(),
  upsertMatchSnapshotServer: jest.fn(),
}))
jest.mock('@/lib/db/corpus-server', () => ({
  getCorpusByIdServer: jest.fn(),
  bumpDailyUsageServer: jest.fn(),
}))
jest.mock('@/lib/db/anki-cards-server', () => ({
  getBoundQuestionIds: jest.fn(() => Promise.resolve(new Set<string>())),
}))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(),
  assertCorpusOwner: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({ requireConsent: jest.fn(() => Promise.resolve(null)) }))
jest.mock('@/lib/events', () => ({ logEvent: jest.fn() }))
jest.mock('@/lib/api-logger', () => ({
  logApiUsage: jest.fn(),
  qwenPlusCostCny: jest.fn(() => 0.001),
}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

import { POST } from '@/app/api/matching/route'
import { matchByStory, type FunnelMatchResult } from '@/services/matching'
import { getMatchSnapshotServer, upsertMatchSnapshotServer } from '@/lib/db/match-snapshots'
import { getCorpusByIdServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { requireUserAllowAnon, assertCorpusOwner } from '@/lib/api-auth'
import { logEvent } from '@/lib/events'
import { logApiUsage } from '@/lib/api-logger'
import { getSupabaseServer } from '@/lib/supabase-server'

const mockMatchByStory   = matchByStory as jest.MockedFunction<typeof matchByStory>
const mockGetSnapshot    = getMatchSnapshotServer as jest.MockedFunction<typeof getMatchSnapshotServer>
const mockUpsertSnapshot = upsertMatchSnapshotServer as jest.MockedFunction<typeof upsertMatchSnapshotServer>
const mockGetCorpus      = getCorpusByIdServer as jest.MockedFunction<typeof getCorpusByIdServer>
const mockRequireUser    = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockBumpDaily      = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>
const mockAssertOwner    = assertCorpusOwner as jest.MockedFunction<typeof assertCorpusOwner>
const mockLogEvent       = logEvent as jest.MockedFunction<typeof logEvent>
const mockLogApiUsage    = logApiUsage as jest.MockedFunction<typeof logApiUsage>
const mockGetSupabase    = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

const CLEANED = '上周末我去公园散步，待了很久就放松下来了。'

/** 落库行的形状（persistMatches 写进 corpus_question_matches 的字段集） */
interface MatchRow { user_id: string; corpus_id: string; question_id: string; match_level: string }

/** 造一道候选题；score 传 undefined = 重排没给出分数（降级 / 漏题） */
function makeQuestion(id: string, score: number | undefined): FunnelMatchResult['questions'][number] {
  return {
    id, part: 1, question_text: `${id}-text`, question_text_zh: null,
    cue_card_title: null, cue_card_title_zh: null, is_new: false, topic_only: false,
    matched_point: 'SPA_03', pointName: '自然的地方', dimension: '空间感知',
    isPrimaryMatch: true, ...(score === undefined ? {} : { relevanceScore: score }),
  }
}

/** 造一份最小合法 FunnelMatchResult */
function makeResult(questions: FunnelMatchResult['questions'], rankingDegraded = false): FunnelMatchResult {
  return {
    primary: { pointCode: 'SPA_03', pointName: '自然的地方', dimension: '空间感知', reason: 'r' },
    secondary: null,
    questions,
    count: questions.length,
    matchedViaSecondary: false, matchedViaNeighbor: false, neighborPointsUsed: [],
    noMatch: false, rankingDegraded,
  }
}

/** 走阻塞式整批路（?stream=0）：落库逻辑与流式路共用同一个 persistMatches，断言最直接 */
function makeReq(): Request {
  return new Request('http://localhost/api/matching?stream=0', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ corpusId: 'c1' }),
  })
}

/** corpus_question_matches 的 upsert 探针 */
let cqmUpsert: jest.Mock

/** 取本次请求写进 corpus_question_matches 的所有行（没写过则空数组） */
function writtenRows(): MatchRow[] {
  return cqmUpsert.mock.calls.flatMap((call) => call[0] as MatchRow[])
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireUser.mockResolvedValue({ userId: 'u1', isAnonymous: false })
  mockAssertOwner.mockResolvedValue(undefined)
  mockBumpDaily.mockResolvedValue(1)
  mockGetCorpus.mockResolvedValue(CLEANED)
  mockGetSnapshot.mockResolvedValue(null)
  mockUpsertSnapshot.mockResolvedValue(undefined)
  mockLogEvent.mockResolvedValue(undefined)
  mockLogApiUsage.mockResolvedValue(undefined)

  cqmUpsert = jest.fn().mockResolvedValue({ error: null })
  const corpusMaybeSingle = jest.fn().mockResolvedValue({ data: { user_id: 'u1' }, error: null })
  mockGetSupabase.mockReturnValue({
    from: (table: string) => {
      if (table === 'corpus_question_matches') return { upsert: cqmUpsert }
      return { select: () => ({ eq: () => ({ maybeSingle: corpusMaybeSingle }) }) }
    },
  } as never)
})

describe('落库档位【行为】重排降级时，一行假 high 都不许写进 corpus_question_matches', () => {
  it('全批候选无分数（重排整体降级的真实形态）→ 根本不发 upsert', async () => {
    mockMatchByStory.mockResolvedValue(
      makeResult([makeQuestion('q1', undefined), makeQuestion('q2', undefined), makeQuestion('q3', undefined)], true),
    )

    await POST(makeReq())

    expect(writtenRows()).toEqual([])
    expect(cqmUpsert).not.toHaveBeenCalled()
  })

  it('有分与无分混在一批 → 只写有分且达线的那些，无分的一律不落库（不是「先当 high 写进去再说」）', async () => {
    mockMatchByStory.mockResolvedValue(
      makeResult([
        makeQuestion('q-high', 92),
        makeQuestion('q-none', undefined),
        makeQuestion('q-mid', 70),
        makeQuestion('q-low', 41),
      ]),
    )

    await POST(makeReq())

    const rows = writtenRows()
    expect(rows.map((r) => r.question_id).sort()).toEqual(['q-high', 'q-mid'])
    expect(rows.find((r) => r.question_id === 'q-high')?.match_level).toBe('high')
    expect(rows.find((r) => r.question_id === 'q-mid')?.match_level).toBe('mid')
    // 显式再钉一次事故本身：无分候选绝不能以任何档位、尤其不能以 high 出现在写库行里
    expect(rows.some((r) => r.question_id === 'q-none')).toBe(false)
    expect(rows.every((r) => r.user_id === 'u1' && r.corpus_id === 'c1')).toBe(true)
  })
})
