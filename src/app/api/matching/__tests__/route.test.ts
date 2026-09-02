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
jest.mock('@/lib/env-server', () => ({ env: { matchSnapshotEnabled: true, qaTrafficToken: '' } }))
jest.mock('@/services/matching', () => ({ matchByStory: jest.fn() }))
jest.mock('@/services/scheme3-matching', () => ({
  matchByStoryScheme3Production: jest.fn(),
  preloadScheme3ProductionAssets: jest.fn(),
}))
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
import {
  matchByStoryScheme3Production,
  preloadScheme3ProductionAssets,
} from '@/services/scheme3-matching'
import { getMatchSnapshotServer, upsertMatchSnapshotServer } from '@/lib/db/match-snapshots'
import { getCorpusByIdServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { getBoundQuestionIds } from '@/lib/db/anki-cards-server'
import { requireUserAllowAnon, assertCorpusOwner } from '@/lib/api-auth'
import { logEvent } from '@/lib/events'
import { logApiUsage } from '@/lib/api-logger'
import { getSupabaseServer } from '@/lib/supabase-server'
import { logErr } from '@/lib/log'
import { RANKING_ALGO_VERSION } from '@/lib/constants'
import { __resetMatchInflightForTest } from '@/lib/matching-inflight'
import { matchingAlgorithmConfig } from '@/lib/matching-algorithm'

const mockMatchByStory   = matchByStory as jest.MockedFunction<typeof matchByStory>
const mockMatchByScheme3 = matchByStoryScheme3Production as jest.MockedFunction<typeof matchByStoryScheme3Production>
const mockPreloadScheme3 = preloadScheme3ProductionAssets as jest.MockedFunction<typeof preloadScheme3ProductionAssets>
const mockGetSnapshot    = getMatchSnapshotServer as jest.MockedFunction<typeof getMatchSnapshotServer>
const mockUpsertSnapshot = upsertMatchSnapshotServer as jest.MockedFunction<typeof upsertMatchSnapshotServer>
const mockGetCorpus      = getCorpusByIdServer as jest.MockedFunction<typeof getCorpusByIdServer>
const mockRequireUser    = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockBumpDaily      = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>
const mockAssertOwner    = assertCorpusOwner as jest.MockedFunction<typeof assertCorpusOwner>
const mockLogEvent       = logEvent as jest.MockedFunction<typeof logEvent>
const mockLogApiUsage    = logApiUsage as jest.MockedFunction<typeof logApiUsage>
const mockGetSupabase    = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>
const mockGetBoundQids    = getBoundQuestionIds as jest.MockedFunction<typeof getBoundQuestionIds>

// —— 桩数据 ——
const CLEANED = '上周末我去公园散步，待了很久就放松下来了。'
const HASH = createHash('sha256').update(CLEANED, 'utf8').digest('hex')
const MAPPING_SNAPSHOT_KEY = matchingAlgorithmConfig('mapping').snapshotKey

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

/**
 * 构造一个带鉴权头与 corpusId 的 POST 请求（阻塞式整批路 ?stream=0）。
 * 本套守卫的是「快照/matches/计费/ankiSaved/错误」这些与传输无关的核心不变式，走 ?stream=0 返回普通 JSON
 * 断言最直接；同一套逻辑在流式默认路（handleStreaming）复用同样的 persist/snapshot/usage helper，
 * 流式路的传输行为另由下方「默认流式 SSE」describe 覆盖。
 */
function makeReq(corpusId = 'c1'): Request {
  return new Request('http://localhost/api/matching?stream=0', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'x-flow-id': 'f', 'content-type': 'application/json' },
    body: JSON.stringify({ corpusId }),
  })
}

/** 构造流式默认路（无 ?stream=0）的 POST 请求 */
function makeStreamReq(corpusId = 'c1'): Request {
  return new Request('http://localhost/api/matching', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'x-flow-id': 'f', 'content-type': 'application/json' },
    body: JSON.stringify({ corpusId }),
  })
}

/** 读干一个 SSE Response，解析成 { event, data } 帧数组（data 已 JSON.parse） */
async function readSSE(res: Response): Promise<{ event: string; data: unknown }[]> {
  const text = await res.text()
  const frames: { event: string; data: unknown }[] = []
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue
    let event = ''
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data = line.slice(5).trim()
    }
    if (event) frames.push({ event, data: data ? JSON.parse(data) : null })
  }
  return frames
}

/** 原子替换 RPC 探针。 */
let cqmRpc: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  // 单飞是进程内状态：用例之间必须清，否则上一条用例没跑完的那趟会被下一条搭上（假绿）
  __resetMatchInflightForTest()
  ;(env as { matchSnapshotEnabled: boolean }).matchSnapshotEnabled = true
  // 本文件覆盖的是既有 Mapping 缓存/计费行为；默认值已切方案三，故紧急回滚 arm 必须显式钉住。
  ;(env as { matchingAlgoRaw?: string }).matchingAlgoRaw = 'mapping'

  mockRequireUser.mockResolvedValue({ userId: 'u1', isAnonymous: false })
  mockAssertOwner.mockResolvedValue(undefined)
  mockBumpDaily.mockResolvedValue(1)
  mockGetCorpus.mockResolvedValue(CLEANED)
  mockGetSnapshot.mockResolvedValue(null)
  mockUpsertSnapshot.mockResolvedValue(undefined)
  mockLogEvent.mockResolvedValue(undefined)
  mockLogApiUsage.mockResolvedValue(undefined)
  mockMatchByStory.mockResolvedValue(makeResult('fresh'))
  mockPreloadScheme3.mockResolvedValue({} as Awaited<ReturnType<typeof preloadScheme3ProductionAssets>>)
  mockGetBoundQids.mockResolvedValue(new Set<string>())

  cqmRpc = jest.fn().mockResolvedValue({ error: null })
  mockGetSupabase.mockReturnValue({ rpc: cqmRpc } as never)
})

describe('方案三生产资产入口前置闸', () => {
  test('资产缺失或损坏时返回明确503，且零鉴权、DB、额度与模型调用', async () => {
    ;(env as { matchingAlgoRaw?: string }).matchingAlgoRaw = 'scheme3_enhanced_key'
    mockPreloadScheme3.mockRejectedValueOnce(new Error('资产 SHA 不匹配'))

    const response = await POST(makeReq())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: '方案三生产资产缺失或校验失败',
      code: 'MATCHING_ALGO_NOT_READY',
    })
    expect(mockRequireUser).not.toHaveBeenCalled()
    expect(mockGetCorpus).not.toHaveBeenCalled()
    expect(mockGetSnapshot).not.toHaveBeenCalled()
    expect(mockBumpDaily).not.toHaveBeenCalled()
    expect(mockGetSupabase).not.toHaveBeenCalled()
    expect(mockMatchByStory).not.toHaveBeenCalled()
    expect(mockMatchByScheme3).not.toHaveBeenCalled()
  })
})

describe('POST /api/matching · 算法开关 fail-closed', () => {
  test('非法 MATCHING_ALGO 返回 503，且不进入鉴权、数据库或模型链路', async () => {
    ;(env as { matchingAlgoRaw?: string }).matchingAlgoRaw = 'enhanced'

    const res = await POST(makeReq())

    expect(res.status).toBe(503)
    expect((await res.json()) as unknown).toEqual(expect.objectContaining({ code: 'MATCHING_ALGO_INVALID' }))
    expect(mockRequireUser).not.toHaveBeenCalled()
    expect(mockGetCorpus).not.toHaveBeenCalled()
    expect(mockMatchByStory).not.toHaveBeenCalled()
  })

})

describe('POST /api/matching · 匹配存档缓存逻辑', () => {
  test('1. 命中读档：返回存档、不调模型，并用存档同步反查表自愈', async () => {
    const cached = makeResult('cache')
    mockGetSnapshot.mockResolvedValue({ result: cached, storyHash: HASH, algoVersion: RANKING_ALGO_VERSION })

    const res = await POST(makeReq())
    const body = (await res.json()) as FunnelMatchResult & { servedFrom: string }

    // 核心不变式：命中时模型零调用
    expect(mockMatchByStory).not.toHaveBeenCalled()
    // 不重复写快照；反查表必须同步一次，以修复历史写失败或迁移清理后的缺口。
    expect(mockUpsertSnapshot).not.toHaveBeenCalled()
    expect(cqmRpc).toHaveBeenCalledWith('replace_auto_corpus_question_matches', {
      p_corpus_id: 'c1',
      p_matches: [{ question_id: 'q-cache', match_level: 'high' }],
    })
    expect(mockLogApiUsage).not.toHaveBeenCalled()
    // 读档命中零模型成本 → 不该扣每日配额（否则用户重看已匹配结果会被白扣次数）
    expect(mockBumpDaily).not.toHaveBeenCalled()
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
      expect.objectContaining({ corpusId: 'c1', userId: 'u1', storyHash: HASH, algoVersion: MAPPING_SNAPSHOT_KEY }),
    )
    expect(cqmRpc.mock.invocationCallOrder[0]).toBeLessThan(mockUpsertSnapshot.mock.invocationCallOrder[0])
    expect(body.servedFrom).toBe('fresh')
    expect(body.matchingAlgo).toBe('mapping')
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

  /**
   * 口径回归（2026-07-20）：两条 usage 日志的 latency_ms 曾【都】写 `Date.now() - t0`（请求总耗时），
   * 同一个总时长被记了两遍，看板上 matching 耗时因此虚报约一倍（实际 19.8s 被读成 39s）。
   * 生产数据的佐证是两条记录差值中位数仅 207ms —— 那只是中间一次 Supabase insert 的往返，
   * 而不是萃取与重排的耗时差。这组断言就是钉死这个口径：分段实测，各记各的，绝不能再相等。
   */
  test('7. latency_ms 分段实测：萃取与重排各记各的真实耗时，两条不再相等', async () => {
    mockMatchByStory.mockImplementation(async (_text, usage) => {
      usage?.onExtractionLatency?.(1_800)
      usage?.onRankingLatency?.(17_400)
      return makeResult('fresh')
    })

    await POST(makeReq())

    const calls = mockLogApiUsage.mock.calls.map(([arg]) => arg)
    const extraction = calls.find((c) => (c.metadata as { phase?: string } | undefined)?.phase === 'extraction')
    const ranking = calls.find((c) => (c.metadata as { phase?: string } | undefined)?.phase === 'ranking')

    // 各自记回传的真实分段耗时，而不是请求总耗时
    expect(extraction?.latency_ms).toBe(1_800)
    expect(ranking?.latency_ms).toBe(17_400)
    // 核心：两条不许再是同一个数（回退成 Date.now()-t0 时这条必挂）
    expect(extraction?.latency_ms).not.toBe(ranking?.latency_ms)
  })

  test('8. 服务未回传分段耗时：latency_ms 落 0，绝不退回拿请求总耗时冒充分段耗时', async () => {
    // 不触发 onExtractionLatency / onRankingLatency
    mockMatchByStory.mockResolvedValue(makeResult('fresh'))

    await POST(makeReq())

    const calls = mockLogApiUsage.mock.calls.map(([arg]) => arg)
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c.latency_ms === 0)).toBe(true)
  })

  /**
   * 后置任务（留档/记账/埋点）改为并行发出、统一 await 后，错误处理纪律不许丢：
   * persistMatches 曾静默失败很久（台账 115），它的 .catch(logErr) 必须还在；
   * 且一个任务失败不许拖垮其余——两条 usage 账、写档、埋点都得照写，响应照常 200。
   */
  test('9. persistMatches 失败被吞并留证，响应/记账/埋点不受影响，但不得写快照', async () => {
    cqmRpc.mockResolvedValue({ error: { message: 'boom' } })

    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    // 失败留证（绝不静默）
    expect(logErr).toHaveBeenCalledWith('[matching persist]', expect.anything())
    // 快照必须依赖反查写成功；否则重访会永久命中坏档、失去自愈机会。
    expect(mockUpsertSnapshot).not.toHaveBeenCalled()
    expect(mockLogApiUsage).toHaveBeenCalledTimes(2)
    expect(mockLogEvent).toHaveBeenCalled()
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
      expect.objectContaining({ storyHash: HASH, algoVersion: MAPPING_SNAPSHOT_KEY }),
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

  /**
   * 降级不冻结快照（机制①服务端不变式）：rankingDegraded=true（候选存在但重排一分没产出）是瞬时失败，
   * 冻进快照会让前端降级态的「重试」命中降级档、永不重跑重排，重试形同虚设。故降级结果绝不写档；
   * 正常结果照常写档。这条守的是「降级不冻结快照、让重试真生效」——此前服务端无测试覆盖。
   */
  test('13. 重排整体降级（rankingDegraded=true）→ 不写快照；正常结果 → 写快照', async () => {
    // 降级结果：不写档
    const degraded = makeResult('fresh')
    degraded.rankingDegraded = true
    mockMatchByStory.mockResolvedValue(degraded)

    const res1 = await POST(makeReq())
    expect(res1.status).toBe(200)
    expect(mockUpsertSnapshot).not.toHaveBeenCalled()

    // 对照：正常结果（rankingDegraded 缺省 → falsy）→ 照常写档。
    // 只清快照 mock 的调用记录，beforeEach 设的各 mock 实现照旧生效（clearAllMocks/mockClear 只清 calls 不清实现）。
    mockUpsertSnapshot.mockClear()
    mockMatchByStory.mockResolvedValue(makeResult('fresh'))

    const res2 = await POST(makeReq())
    expect(res2.status).toBe(200)
    expect(mockUpsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ corpusId: 'c1', userId: 'u1', storyHash: HASH, algoVersion: MAPPING_SNAPSHOT_KEY }),
    )
  })

  /**
   * 失败可诊断性（2026-07-20）：matchByStory 抛错时，catch 里的失败记账要带 metadata.phase，
   * 否则空 metadata 会掉进看板 other 桶、辨不出是匹配接口挂的。萃取 / 重排两步同在 matchByStory 内深处，
   * 从 catch 处无法判定挂在哪步，故用能表意的兜底值 'matching'。系统故障不补 error_kind（缺键即系统故障）。
   */
  test('10. matchByStory 抛错 → 记 status=error 且 phase=matching 兜底，不带 error_kind', async () => {
    mockMatchByStory.mockRejectedValue(new Error('重排上游 5xx'))

    const res = await POST(makeReq())

    expect(res.status).toBe(500)
    const calls = mockLogApiUsage.mock.calls.map(([arg]) => arg)
    const errCall = calls.find((c) => c.status === 'error')
    expect(errCall).toBeDefined()
    const meta = errCall?.metadata as { phase?: string; error_kind?: string } | undefined
    expect(meta?.phase).toBe('matching')
    expect(meta?.error_kind).toBeUndefined()
  })

  test('11. ankiSaved：注册用户按已存题卡集合逐题标注（已绑 → true，未绑 → false）', async () => {
    // 两题：q-a 已存对子、q-b 未存
    const multi = makeResult('fresh')
    multi.questions = [
      { ...multi.questions[0], id: 'q-a' },
      { ...multi.questions[0], id: 'q-b' },
    ]
    mockMatchByStory.mockResolvedValue(multi)
    mockGetBoundQids.mockResolvedValue(new Set<string>(['q-a']))

    const res = await POST(makeReq())
    const body = (await res.json()) as { questions: { id: string; ankiSaved: boolean }[] }

    expect(mockGetBoundQids).toHaveBeenCalledWith('u1', ['q-a', 'q-b'])
    const saved = Object.fromEntries(body.questions.map((q) => [q.id, q.ankiSaved]))
    expect(saved).toEqual({ 'q-a': true, 'q-b': false })
  })

  test('12. 匿名用户：一律不查已存题卡、每题 ankiSaved=false', async () => {
    mockRequireUser.mockResolvedValue({ userId: 'anon1', isAnonymous: true })

    const res = await POST(makeReq())
    const body = (await res.json()) as { questions: { ankiSaved: boolean }[] }

    // 匿名不查库（存对子注册专属，匿名点存必被 401 拦）
    expect(mockGetBoundQids).not.toHaveBeenCalled()
    expect(body.questions.every((q) => q.ankiSaved === false)).toBe(true)
  })
})

describe('POST /api/matching · 默认流式 SSE', () => {
  test('S1. fresh 未命中：返回 text/event-stream，帧序 meta → question → done，done 带 servedFrom=fresh', async () => {
    mockMatchByStory.mockImplementation(async (_text, usage) => {
      const r = makeResult('fresh')
      usage?.onMeta?.({ primary: r.primary, secondary: r.secondary, matchedViaSecondary: false, matchedViaNeighbor: false, candidateCount: r.questions.length })
      for (const q of r.questions) usage?.onItem?.(q)
      return r
    })

    const res = await POST(makeStreamReq())
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const frames = await readSSE(res)

    expect(frames[0].event).toBe('meta')
    expect(frames.some((f) => f.event === 'question')).toBe(true)
    const done = frames[frames.length - 1]
    expect(done.event).toBe('done')
    expect((done.data as { servedFrom: string }).servedFrom).toBe('fresh')
    expect((done.data as { questions: { id: string }[] }).questions.map((q) => q.id)).toEqual(['q-fresh'])
    // 流结束后照记两条账（萃取 + 重排），字段/职责与阻塞路一致
    expect(mockLogApiUsage).toHaveBeenCalledTimes(2)
    expect(mockUpsertSnapshot).toHaveBeenCalled()
  })

  test('S2. 快照命中：走 SSE 并同步反查表，不调模型、不记 usage', async () => {
    const cached = makeResult('cache')
    mockGetSnapshot.mockResolvedValue({ result: cached, storyHash: HASH, algoVersion: RANKING_ALGO_VERSION })

    const res = await POST(makeStreamReq())
    const frames = await readSSE(res)

    expect(mockMatchByStory).not.toHaveBeenCalled()
    expect(mockLogApiUsage).not.toHaveBeenCalled()
    expect(cqmRpc).toHaveBeenCalledWith('replace_auto_corpus_question_matches', {
      p_corpus_id: 'c1',
      p_matches: [{ question_id: 'q-cache', match_level: 'high' }],
    })
    expect(mockBumpDaily).not.toHaveBeenCalled()
    expect(frames[0].event).toBe('meta')
    const done = frames[frames.length - 1]
    expect(done.event).toBe('done')
    expect((done.data as { servedFrom: string }).servedFrom).toBe('cache')
    expect((done.data as { questions: { id: string }[] }).questions.map((q) => q.id)).toEqual(['q-cache'])
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'match.result', props: expect.objectContaining({ served_from: 'cache' }) }),
    )
  })

  test('S2b. 流式 fresh 的反查替换失败：仍发done成功响应，但不写快照', async () => {
    cqmRpc.mockResolvedValue({ error: { message: 'boom' } })
    mockMatchByStory.mockImplementation(async (_text, usage) => {
      const result = makeResult('fresh')
      usage?.onMeta?.({
        primary: result.primary,
        secondary: result.secondary,
        matchedViaSecondary: false,
        matchedViaNeighbor: false,
        candidateCount: result.questions.length,
      })
      for (const question of result.questions) usage?.onItem?.(question)
      return result
    })

    const response = await POST(makeStreamReq())
    const frames = await readSSE(response)

    expect(frames[frames.length - 1].event).toBe('done')
    expect(logErr).toHaveBeenCalledWith('[matching persist]', expect.anything())
    expect(mockUpsertSnapshot).not.toHaveBeenCalled()
  })

  test('S3. matchByStory 抛错（开流后）：发 error 帧让前端降级，且记一条 status=error·phase=matching 账', async () => {
    mockMatchByStory.mockRejectedValue(new Error('重排上游 5xx'))

    const res = await POST(makeStreamReq())
    const frames = await readSSE(res)

    expect(frames.some((f) => f.event === 'error')).toBe(true)
    expect(frames.some((f) => f.event === 'done')).toBe(false)
    const errCall = mockLogApiUsage.mock.calls.map(([a]) => a).find((c) => c.status === 'error')
    expect(errCall).toBeDefined()
    expect((errCall?.metadata as { phase?: string } | undefined)?.phase).toBe('matching')
  })

  test('S4. 配额闸在开流前（注册超上限 → 429 普通 JSON，不开流、不调模型）', async () => {
    mockBumpDaily.mockResolvedValue(9999)

    const res = await POST(makeStreamReq())

    expect(res.status).toBe(429)
    expect(res.headers.get('content-type')).not.toContain('text/event-stream')
    expect(mockMatchByStory).not.toHaveBeenCalled()
  })

  test('S5. 配额闸在开流前（匿名超上限 → 402 QUOTA_EXCEEDED，不开流）', async () => {
    mockRequireUser.mockResolvedValue({ userId: 'anon1', isAnonymous: true })
    mockBumpDaily.mockResolvedValue(9999)

    const res = await POST(makeStreamReq())
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(402)
    expect(body.code).toBe('QUOTA_EXCEEDED')
    expect(mockMatchByStory).not.toHaveBeenCalled()
  })
})

/**
 * QA 自测流量标记（迁移 0059）—— 萃取/重排两条 usage 是全站最贵的 AI 调用，
 * 产品方自测时不标就永远剔不掉（无痕模式的匿名号进不了 isInternalAccount 名册）。
 * 阻塞路与流式路走同一份 pushMatchUsageLogs，故两路各测一次即可覆盖两条记账。
 * ⚠️ 只验统计列取值，绝不把 is_qa 接到额度/权限判定上（可伪造，红线见 qa-traffic 顶注）。
 */
describe('POST /api/matching · 成本记账的 QA 标记', () => {
  /** 服务端配置的 QA token */
  const TOKEN = 's3cret-token'

  /** 带 QA 头的请求（stream 参数决定走阻塞路还是流式路） */
  function qaReq(buffered: boolean, header?: string): Request {
    const headers: Record<string, string> = { authorization: 'Bearer t', 'x-flow-id': 'f', 'content-type': 'application/json' }
    if (header !== undefined) headers['x-qa-traffic'] = header
    return new Request(`http://localhost/api/matching${buffered ? '?stream=0' : ''}`, {
      method: 'POST', headers, body: JSON.stringify({ corpusId: 'c1' }),
    })
  }

  /** 本次全部记账入参的 is_qa 取值集合（两条账必须同值） */
  function isQaValues(): unknown[] {
    return [...new Set(mockLogApiUsage.mock.calls.map((c) => (c[0] as { is_qa?: boolean }).is_qa))]
  }

  beforeEach(() => {
    ;(env as { qaTrafficToken: string }).qaTrafficToken = TOKEN
  })

  test('阻塞路（?stream=0）：带对 QA 头 → 萃取/重排两条账都标 is_qa=true', async () => {
    await POST(qaReq(true, TOKEN))
    expect(mockLogApiUsage).toHaveBeenCalledTimes(2)
    expect(isQaValues()).toEqual([true])
  })

  test('阻塞路：普通用户不带头 → 两条账都 false（绝不误剔真实成本）', async () => {
    await POST(qaReq(true))
    expect(mockLogApiUsage).toHaveBeenCalledTimes(2)
    expect(isQaValues()).toEqual([false])
  })

  test('流式默认路：带对 QA 头 → 两条账同样标 true（2026-08-02 漏标 isQa 那次就出在这一路）', async () => {
    const res = await POST(qaReq(false, TOKEN))
    await readSSE(res)
    expect(mockLogApiUsage).toHaveBeenCalledTimes(2)
    expect(isQaValues()).toEqual([true])
  })

  test('服务端未配 token → 头再对也判 false（fail-closed，绝不能全站成本被标成自测）', async () => {
    ;(env as { qaTrafficToken: string }).qaTrafficToken = ''
    await POST(qaReq(true, TOKEN))
    expect(isQaValues()).toEqual([false])
  })

  test('失败记账（模型抛错）同样带 QA 标记 —— 失败也烧钱', async () => {
    mockMatchByStory.mockRejectedValueOnce(new Error('模型超时'))
    const res = await POST(qaReq(true, TOKEN))
    expect(res.status).toBe(500)
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error', is_qa: true, user_id: 'u1', is_anonymous: false,
    }))
  })
})

/**
 * 并发单飞（2026-08-12，审计 P1-3）—— 守的是【花钱那步只发生一次】，不是「两边返回值一样」。
 * 生产实测 131 个跑过匹配的语料里 4 个跑了两趟，其中 3 次两趟相隔 0.25s / 6.8s / 14.5s（均小于单趟耗时）
 * ＝ 快照的读与写之间没有锁。本组用「把第一趟钉在飞行中」的手法复现那个窗口。
 *
 * 每条都同时断言 bumpDailyUsageServer 的次数：单飞【只去掉重复的模型调用】，绝不去掉任何一个请求
 * 自己该过的额度计次（熔断闸与它同位置，一并守住）。
 */
describe('POST /api/matching · 同语料并发单飞', () => {
  /** 一个可手动放行的 Promise，用来把「一趟正在飞」钉住 */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
  /** 让队列跑空，确保后发的请求已经走到单飞那一步 */
  async function tick(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0))
  }

  test('C1. 阻塞路并发两次同 corpusId：matchByStory 只被调一次，两边同结果，第二个标 servedFrom=joined', async () => {
    const gate = deferred<FunnelMatchResult>()
    mockMatchByStory.mockImplementation(() => gate.promise)

    const p1 = POST(makeReq('c1'))
    const p2 = POST(makeReq('c1'))
    await tick()

    // 核心：两个请求都已越过额度闸进到「要跑模型」那一步，而模型只被调了一次
    expect(mockBumpDaily).toHaveBeenCalledTimes(2)
    expect(mockMatchByStory).toHaveBeenCalledTimes(1)

    gate.resolve(makeResult('fresh'))
    const [b1, b2] = await Promise.all([
      p1.then((r) => r.json() as Promise<FunnelMatchResult & { servedFrom: string }>),
      p2.then((r) => r.json() as Promise<FunnelMatchResult & { servedFrom: string }>),
    ])

    expect(mockMatchByStory).toHaveBeenCalledTimes(1)
    expect(b1.questions.map((q) => q.id)).toEqual(['q-fresh'])
    expect(b2.questions.map((q) => q.id)).toEqual(['q-fresh'])
    expect([b1.servedFrom, b2.servedFrom].sort()).toEqual(['fresh', 'joined'])
    // 记账只能有 leader 那两条（萃取 + 重排）；搭车者补记 = 记一笔没花的钱
    expect(mockLogApiUsage).toHaveBeenCalledTimes(2)
    // 留档/写档也只做一次（同一份结果写两遍只是白费往返）
    expect(mockUpsertSnapshot).toHaveBeenCalledTimes(1)
    expect(cqmRpc).toHaveBeenCalledTimes(1)
    // 埋点两个请求各发一条，但只有 leader 那条是 fresh —— 离线口径按 fresh 算分布，不会把同一趟数两遍
    const servedFroms = mockLogEvent.mock.calls.map(([a]) => (a.props as { served_from: string }).served_from)
    expect(servedFroms.sort()).toEqual(['fresh', 'joined'])
  })

  test('C2. 流式路并发两次：模型只调一次，晚到的那条流照样拿到完整 meta → question → done', async () => {
    const gate = deferred<void>()
    const r = makeResult('fresh')
    mockMatchByStory.mockImplementation(async (_text, usage) => {
      usage?.onMeta?.({ primary: r.primary, secondary: r.secondary, matchedViaSecondary: false, matchedViaNeighbor: false, candidateCount: 1 })
      await gate.promise            // 第二个请求在这个窗口里进来（正是生产那 3 次的形状）
      for (const q of r.questions) usage?.onItem?.(q)
      return r
    })

    const res1 = await POST(makeStreamReq('c1'))
    await tick()
    const res2 = await POST(makeStreamReq('c1'))   // meta 已发生之后才加入 → 靠回放补齐
    await tick()

    expect(mockBumpDaily).toHaveBeenCalledTimes(2)
    expect(mockMatchByStory).toHaveBeenCalledTimes(1)

    gate.resolve()
    const [f1, f2] = await Promise.all([readSSE(res1), readSSE(res2)])

    for (const frames of [f1, f2]) {
      expect(frames[0].event).toBe('meta')
      // 各一帧，不多不少：leader 既是「跑的人」又是「订阅者」，扇出实现若把它算两遍就会重复发帧
      expect(frames.filter((f) => f.event === 'meta')).toHaveLength(1)
      expect(frames.filter((f) => f.event === 'question')).toHaveLength(1)
      expect(frames[frames.length - 1].event).toBe('done')
      expect((frames[frames.length - 1].data as { questions: { id: string }[] }).questions.map((q) => q.id)).toEqual(['q-fresh'])
    }
    const dtoSources = [f1, f2].map((f) => (f[f.length - 1].data as { servedFrom: string }).servedFrom)
    expect(dtoSources.sort()).toEqual(['fresh', 'joined'])
    expect(mockLogApiUsage).toHaveBeenCalledTimes(2)
    expect(mockUpsertSnapshot).toHaveBeenCalledTimes(1)
  })

  test('C3. 流式在飞时前端降级重发 ?stream=0：搭同一趟，模型仍只调一次', async () => {
    const gate = deferred<FunnelMatchResult>()
    mockMatchByStory.mockImplementation(() => gate.promise)

    const res1 = await POST(makeStreamReq('c1'))
    await tick()
    const p2 = POST(makeReq('c1'))
    await tick()

    expect(mockMatchByStory).toHaveBeenCalledTimes(1)
    gate.resolve(makeResult('fresh'))

    const [frames, body] = await Promise.all([
      readSSE(res1),
      p2.then((r) => r.json() as Promise<FunnelMatchResult & { servedFrom: string }>),
    ])
    expect(frames[frames.length - 1].event).toBe('done')
    expect(body.questions.map((q) => q.id)).toEqual(['q-fresh'])
    expect(body.servedFrom).toBe('joined')
    expect(mockLogApiUsage).toHaveBeenCalledTimes(2)
  })

  test('C4. 不同 corpusId 并发：各跑各的，互不阻塞（两趟都要真跑）', async () => {
    const g1 = deferred<FunnelMatchResult>()
    const g2 = deferred<FunnelMatchResult>()
    mockMatchByStory
      .mockImplementationOnce(() => g1.promise)
      .mockImplementationOnce(() => g2.promise)

    const p1 = POST(makeReq('c1'))
    const p2 = POST(makeReq('c2'))
    await tick()
    expect(mockMatchByStory).toHaveBeenCalledTimes(2)

    // c2 先完成即可返回，不必等 c1（若被误串成一条队，这里会挂住）
    g2.resolve(makeResult('two'))
    const b2 = (await (await p2).json()) as FunnelMatchResult & { servedFrom: string }
    expect(b2.questions.map((q) => q.id)).toEqual(['q-two'])
    expect(b2.servedFrom).toBe('fresh')

    g1.resolve(makeResult('one'))
    const b1 = (await (await p1).json()) as FunnelMatchResult & { servedFrom: string }
    expect(b1.questions.map((q) => q.id)).toEqual(['q-one'])
    expect(b1.servedFrom).toBe('fresh')
    expect(mockLogApiUsage).toHaveBeenCalledTimes(4)   // 两趟各两条账
  })

  test('C5. 读档命中不进单飞：并发两次全是 cache（零模型、零计次），行为与改动前一字不变', async () => {
    mockGetSnapshot.mockResolvedValue({ result: makeResult('cache'), storyHash: HASH, algoVersion: RANKING_ALGO_VERSION })

    const [r1, r2] = await Promise.all([POST(makeReq('c1')), POST(makeReq('c1'))])
    const b1 = (await r1.json()) as FunnelMatchResult & { servedFrom: string }
    const b2 = (await r2.json()) as FunnelMatchResult & { servedFrom: string }

    // 两个都是 cache（若读档也被圈进单飞，第二个会变成 joined）
    expect(b1.servedFrom).toBe('cache')
    expect(b2.servedFrom).toBe('cache')
    expect(b1.questions.map((q) => q.id)).toEqual(['q-cache'])
    expect(mockMatchByStory).not.toHaveBeenCalled()
    expect(mockBumpDaily).not.toHaveBeenCalled()
    expect(mockLogApiUsage).not.toHaveBeenCalled()
  })

  test('C7. 同语料有一趟在飞时，读档命中的请求不排队：当场返回 cache，不等那趟跑完', async () => {
    const gate = deferred<FunnelMatchResult>()
    mockMatchByStory.mockImplementation(() => gate.promise)

    const p1 = POST(makeReq('c1'))     // 未命中 → 起一趟并把它钉在飞行中
    await tick()
    // 此刻另一个请求读到了存档（leader 尚未写档，故这里显式给一份，模拟已有档的重访）
    mockGetSnapshot.mockResolvedValue({ result: makeResult('cache'), storyHash: HASH, algoVersion: RANKING_ALGO_VERSION })

    // 若单飞被放到「包住整个 handler」那一层，这一行会一直等到 gate 放行 → 用例超时变红
    const b2 = (await (await POST(makeReq('c1'))).json()) as FunnelMatchResult & { servedFrom: string }
    expect(b2.servedFrom).toBe('cache')
    expect(b2.questions.map((q) => q.id)).toEqual(['q-cache'])
    expect(mockMatchByStory).toHaveBeenCalledTimes(1)   // 读档那次没有再起一趟

    gate.resolve(makeResult('fresh'))
    await p1
  })

  test('C6. 第一趟失败：搭车者跟着失败（不各自重跑），槽位清干净——下一次请求重新跑一趟', async () => {
    const gate = deferred<FunnelMatchResult>()
    mockMatchByStory.mockImplementation(() => gate.promise)

    const p1 = POST(makeReq('c1'))
    const p2 = POST(makeReq('c1'))
    await tick()
    gate.reject(new Error('重排上游 5xx'))

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.status).toBe(500)
    expect(r2.status).toBe(500)
    expect(mockMatchByStory).toHaveBeenCalledTimes(1)   // 失败不许放大成两趟

    // 槽位已清：下一次是全新一趟（拿不到那个已失败的 Promise）
    mockMatchByStory.mockResolvedValue(makeResult('fresh'))
    const r3 = await POST(makeReq('c1'))
    expect(r3.status).toBe(200)
    expect(mockMatchByStory).toHaveBeenCalledTimes(2)
  })
})
