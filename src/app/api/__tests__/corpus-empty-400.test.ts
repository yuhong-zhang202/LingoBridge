/**
 * @module   api/corpus-empty-400.test
 * @desc     「语料无正文」这个 400 的全链路守卫 —— 从服务端回码、到客户端分流、到 sanitize 放行、
 *           再到看板归桶，四段各有一段会静默失败，故四段都要有断言。
 *
 *           【被治的病】/api/matching 的 400 有两种成因：corpusId 不合法（用户侧）与
 *           「这份语料在库里没有正文」（我们把 cleaned_text 写空了）。二者过去都记 bad_input_400，
 *           而看板把 bad_input_400 归进「用户侧·输入不合格」——**我们自己的数据故障会显示成用户的错**。
 *           不是少一个维度的问题，是指错责任方，量不大时会被当噪音略过。
 *
 *           【四段各自的哑故障，逐段有用例】
 *             ① 服务端漏带 code → 客户端无从分辨，永远记 bad_input_400（本文件用【真实 handler】取响应）；
 *             ② 客户端读错/漏读 code → 同上，且 tsc 全绿；
 *             ③ 新值没进 AI_RESULT → sanitizeAiCall 白名单不命中，**字段被静默丢弃**、事件照常落库
 *                （本项目反复吃亏的那类，故走【真实 /api/events handler】断言 logEvent 收到的内容）；
 *             ④ 看板漏配桶 → 落进 other 桶，仍然不在「该我们修」那一栏里。
 *
 *           🔴 另有一条陷阱单列了用例：响应体只能读一次。匹配页那段代码周围有「流式失败 → 降级
 *           重发 ?stream=0」，同一个 Response 可能被别处消费，故映射函数走 res.clone()。
 * @author   LingoBridge
 * @created  2026-08-27
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/events', () => ({ logEvent: jest.fn(() => Promise.resolve()) }))
jest.mock('@/lib/env-server', () => ({ env: { matchSnapshotEnabled: true, qaTrafficToken: '' } }))
jest.mock('@/services/matching', () => ({ matchByStory: jest.fn() }))
jest.mock('@/lib/db/match-snapshots', () => ({
  getMatchSnapshotServer: jest.fn(() => Promise.resolve(null)),
  upsertMatchSnapshotServer: jest.fn(),
}))
jest.mock('@/lib/db/corpus-server', () => ({
  getCorpusByIdServer: jest.fn(),
  bumpDailyUsageServer: jest.fn(() => Promise.resolve(1)),
}))
jest.mock('@/lib/db/anki-cards-server', () => ({ getBoundQuestionIds: jest.fn(() => Promise.resolve(new Set<string>())) }))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(() => Promise.resolve({ userId: 'u1', isAnonymous: false })),
  assertCorpusOwner: jest.fn(() => Promise.resolve(undefined)),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({ requireConsent: jest.fn(() => Promise.resolve(null)) }))
jest.mock('@/lib/api-logger', () => ({ logApiUsage: jest.fn(() => Promise.resolve()), qwenPlusCostCny: jest.fn(() => 0.001) }))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/global-budget-breaker', () => ({ requireGlobalBudget: jest.fn(() => Promise.resolve(null)) }))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))

import { POST as matchingPOST } from '@/app/api/matching/route'
import { POST as eventsPOST } from '@/app/api/events/route'
import { getCorpusByIdServer } from '@/lib/db/corpus-server'
import { logEvent } from '@/lib/events'
import { aiResultFromFailedResponse, CORPUS_EMPTY_CODE } from '@/lib/match-ai-result'
import { AI_RESULT } from '@/lib/event-schema'
import { aggregateAiCall, latestOursFailure, type FlowEventRow } from '@/lib/db/dashboard-flow-events'

const mockGetCorpus = getCorpusByIdServer as jest.MockedFunction<typeof getCorpusByIdServer>
const mockLogEvent  = logEvent as jest.MockedFunction<typeof logEvent>

const CORPUS_ID = '123e4567-e89b-12d3-a456-426614174000'

/** 匹配请求：默认走流式默认路，`stream0=true` 走 ?stream=0 降级路（客户端流式失败后重发的那条） */
function matchReq(body: Record<string, unknown>, stream0 = false): Request {
  return new Request(`http://localhost/api/matching${stream0 ? '?stream=0' : ''}`, {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ───────────────────────────────────────────────────────────────────────────────
// ① 服务端：两条路都要带机器可读码
// ───────────────────────────────────────────────────────────────────────────────
describe('服务端 · /api/matching 的「语料无正文」400 带 code', () => {
  test.each([
    ['流式默认路', false],
    ['?stream=0 降级路', true],
  ] as Array<[string, boolean]>)('%s：正文为空 → 400 + code=corpus_empty，文案不变', async (_name, stream0) => {
    mockGetCorpus.mockResolvedValue(null)

    const res = await matchingPOST(matchReq({ corpusId: CORPUS_ID }, stream0))
    const body = (await res.json()) as { error?: string; code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe(CORPUS_EMPTY_CODE)
    expect(body.error).toBe('语料无正文或不存在')   // 用户可见文案一字未动（本次只改「这次失败叫什么名字」）
  })

  test.each([[false], [true]])('正文全是空白（stream0=%s）同样算无正文', async (stream0) => {
    mockGetCorpus.mockResolvedValue('   \n\t ')
    const res = await matchingPOST(matchReq({ corpusId: CORPUS_ID }, stream0))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code?: string }).code).toBe(CORPUS_EMPTY_CODE)
  })

  test.each([[false], [true]])('corpusId 为空（stream0=%s）→ 400 但【不带】code：那是真·输入错，不许蹭我方桶', async (stream0) => {
    const res = await matchingPOST(matchReq({ corpusId: '  ' }, stream0))
    const body = (await res.json()) as { error?: string; code?: string }
    expect(res.status).toBe(400)
    expect(body.code).toBeUndefined()
    expect(mockGetCorpus).not.toHaveBeenCalled()
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// ② 客户端分流：喂给映射函数的是【真实 handler 产出的 Response】，不是手搓的假响应
// ───────────────────────────────────────────────────────────────────────────────
describe('客户端 · 400 分流到 corpus_empty_400 而不是 bad_input_400', () => {
  test.each([
    ['流式默认路', false],
    ['?stream=0 降级路', true],
  ] as Array<[string, boolean]>)('%s 的真实 400 响应 → corpus_empty_400', async (_name, stream0) => {
    mockGetCorpus.mockResolvedValue(null)
    const res = await matchingPOST(matchReq({ corpusId: CORPUS_ID }, stream0))

    await expect(aiResultFromFailedResponse(res)).resolves.toBe('corpus_empty_400')
  })

  test.each([[false], [true]])('corpusId 为空的真实 400（stream0=%s）仍是 bad_input_400（不误伤用户侧口径）', async (stream0) => {
    const res = await matchingPOST(matchReq({ corpusId: '' }, stream0))
    await expect(aiResultFromFailedResponse(res)).resolves.toBe('bad_input_400')
  })

  test('其余状态码原样归类（401 / 5xx / 其他）', async () => {
    await expect(aiResultFromFailedResponse(new Response('', { status: 401 }))).resolves.toBe('auth_401')
    await expect(aiResultFromFailedResponse(new Response('', { status: 500 }))).resolves.toBe('server_5xx')
    await expect(aiResultFromFailedResponse(new Response('', { status: 503 }))).resolves.toBe('server_5xx')
    await expect(aiResultFromFailedResponse(new Response('', { status: 418 }))).resolves.toBe('other')
  })

  test('响应体不是 JSON / 是空体 → 回退 bad_input_400，绝不抛（埋点不许把失败路径变成崩溃）', async () => {
    await expect(aiResultFromFailedResponse(new Response('<html>502</html>', { status: 400 }))).resolves.toBe('bad_input_400')
    await expect(aiResultFromFailedResponse(new Response(null, { status: 400 }))).resolves.toBe('bad_input_400')
  })

  test('code 是别的值 / 被伪造成对象 → 一律 bad_input_400（严格 === 比对）', async () => {
    for (const code of ['CORPUS_EMPTY', 'corpus_empty ', 'quota', 42, null, { v: 'corpus_empty' }]) {
      const res = new Response(JSON.stringify({ error: 'x', code }), { status: 400, headers: { 'content-type': 'application/json' } })
      await expect(aiResultFromFailedResponse(res)).resolves.toBe('bad_input_400')
    }
  })

  // 🔴 响应体只读一次：匹配页那条路上，同一个 Response 可能在别处被读（流式失败 → 降级重发）。
  //    这条用例证明映射函数读的是 clone —— 原体读完仍拿得到完整内容，且再调一次映射也不炸。
  test('读过之后原 Response 仍可读（走的是 clone，不消费原体）', async () => {
    mockGetCorpus.mockResolvedValue(null)
    const res = await matchingPOST(matchReq({ corpusId: CORPUS_ID }))

    expect(await aiResultFromFailedResponse(res)).toBe('corpus_empty_400')
    expect(res.bodyUsed).toBe(false)
    // 再来一次仍成立（调用方可能重试 / 别处也要读）
    expect(await aiResultFromFailedResponse(res)).toBe('corpus_empty_400')
    // 原体这时才被真正消费，内容完整
    expect((await res.json()) as { code?: string }).toEqual({ error: '语料无正文或不存在', code: CORPUS_EMPTY_CODE })
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// ③ 🔴 sanitize：新值必须真能穿过 /api/events 到达 logEvent（漏加白名单 = 字段被静默丢弃）
// ───────────────────────────────────────────────────────────────────────────────
describe('sanitize · flow.ai_call 的 result 白名单', () => {
  /** 造一条 flow.ai_call 上报 */
  function aiCallReq(result: string): Request {
    return new Request('http://localhost/api/events', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'flow.ai_call', props: { stage: 'matching', result, httpStatus: 400, latencyMs: 12 } }),
    })
  }

  test('result=corpus_empty_400 原样落库（这一条正是本次新增的值）', async () => {
    await eventsPOST(aiCallReq('corpus_empty_400'))
    expect(mockLogEvent.mock.calls[0][0].props).toEqual({
      stage: 'matching', result: 'corpus_empty_400', httpStatus: 400, latencyMs: 12,
    })
  })

  test.each([...AI_RESULT].map((r) => [r]))('result=%s 逐个放行（漏一个 = 那一类失败在库里 result 一栏恒空）', async (result) => {
    await eventsPOST(aiCallReq(result))
    expect((mockLogEvent.mock.calls[0][0].props as { result?: string }).result).toBe(result)
  })

  test('近似值（大小写 / 带空格 / 少后缀）一律丢弃，不许野值进库', async () => {
    for (const bad of ['Corpus_empty_400', 'corpus_empty_400 ', 'corpus_empty', 'corpus-empty-400']) {
      jest.clearAllMocks()
      await eventsPOST(aiCallReq(bad))
      expect((mockLogEvent.mock.calls[0][0].props as { result?: string }).result).toBeUndefined()
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// ④ 看板：必须落在「该我们修」那一栏，且中文名与「输入不合格」分得开
// ───────────────────────────────────────────────────────────────────────────────
describe('看板 · corpus_empty_400 归「我方侧」', () => {
  /** 造一条 flow.ai_call 的库行 */
  function row(result: string): FlowEventRow {
    return {
      event: 'flow.ai_call',
      props: { stage: 'matching', result },
      is_qa: false,
      user_id: 'someone-not-internal',
      created_at: '2026-08-27T00:00:00.000Z',
    }
  }

  test('计入 ourSide、不计 userSide（归错桶 = 该我们修的事躺在用户侧栏里）', () => {
    const stats = aggregateAiCall([row('corpus_empty_400')])
    const matching = stats.find((s) => s.stage === 'matching')
    expect(matching?.ourSide).toBe(1)
    expect(matching?.userSide).toBe(0)
    expect(matching?.otherSide).toBe(0)   // 漏配桶时会掉进这里
  })

  test('与 bad_input_400 各占一格、桶不同、中文名不同（一眼分得开责任方）', () => {
    const stats = aggregateAiCall([row('corpus_empty_400'), row('bad_input_400')])
    const matching = stats.find((s) => s.stage === 'matching')
    const corpusEmpty = matching?.results.find((r) => r.result === 'corpus_empty_400')
    const badInput = matching?.results.find((r) => r.result === 'bad_input_400')
    expect(corpusEmpty?.bucket).toBe('ours')
    expect(badInput?.bucket).toBe('user')
    expect(corpusEmpty?.label).not.toBe(badInput?.label)
    expect(corpusEmpty?.label).not.toBe('corpus_empty_400')   // 有中文标签，不是把 code 原样显示
    expect(matching?.ourSide).toBe(1)
    expect(matching?.userSide).toBe(1)
  })

  test('会被「最近一次该我们修的失败」下钻捞出来', () => {
    expect(latestOursFailure([row('corpus_empty_400')])?.result).toBe('corpus_empty_400')
  })
})
