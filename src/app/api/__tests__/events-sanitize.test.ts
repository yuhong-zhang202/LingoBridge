/**
 * @module   api/events-sanitize.test
 * @desc     /api/events 服务端 sanitize 白名单红线 —— 隐私铁律「客户端塞不进原文」的守卫。
 *           锁死 match.question_opened 的收敛口径（乙.1 新增 questionId/algoVersion 后重点验放行边界）：
 *             · rank / candidateCount / dwellMs：只放行合法整数，负数/非整数/超界一律丢；
 *             · questionId：只放行严格 UUID 形态，非 UUID（含自由文本）一律丢；
 *             · algoVersion：只放行短枚举串（≤32、仅 [a-z0-9._-]），自由文本/超长一律丢；
 *             · 任何不在白名单里的键（含原文字段）绝不进库。
 *           P0/P1 补埋点（2026-08-02）追加三块：
 *             · 6 个新事件（flow.story_entry / mic_permission / capture_started / capture_submitted /
 *               capture_abandoned / ai_call）的枚举与整数收敛口径 + 原文注入负例；
 *           P2 额度转化（2026-08-03）再追加三个事件：quota.reached / quota.cta / auth.registered
 *           （枚举 + 严格布尔的收敛口径 + 原文注入负例）。
 *             · 事件名分发闸：未注册事件名必须 400 且零落库（0053 起 DB CHECK 已放宽为前缀正则，
 *               这里是唯一的真闸）；
 *             · QA 流量标记：严格 === 比对、token 未配时 fail-closed、内部账户为服务端权威来源。
 *           事件名形态护栏（2026-08-02 追加）：FlowEventName / ClientEventName 全集逐个断言符合
 *           0053 的 DB CHECK 正则，且每个客户端事件名都真被 EVENT_SPECS 接受 —— 挡的是
 *           「新事件名不合 CHECK → insert 被拒 → logEvent 静默吞 → 代码在跑但库里零数据」这类哑故障。
 *           全 mock，不碰真实 DB/鉴权；断言落到 logEvent 收到的 props（= 实际写库内容）。
 * @author   LingoBridge
 * @created  2026-08-02
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/events', () => ({ logEvent: jest.fn(() => Promise.resolve()) }))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(() => Promise.resolve({ userId: 'u1', isAnonymous: false })),
  authErrorResponse: jest.fn(() => null),
}))
// env 用可变替身：QA token 是「未配置必须 fail-closed」的红线，要按用例切换配/不配两种状态。
// qa-traffic.ts / internal-accounts.ts 一律用真实实现——被测的正是它们的判定逻辑。
jest.mock('@/lib/env-server', () => ({ env: { qaTrafficToken: '' } }))

import { POST } from '@/app/api/events/route'
import { logEvent, type FlowEventName } from '@/lib/events'
import type { ClientEventName } from '@/lib/client-events'
import { env } from '@/lib/env-server'
import { requireUserAllowAnon } from '@/lib/api-auth'
import { INTERNAL_ACCOUNT_IDS } from '@/lib/internal-accounts'

const mockLogEvent = logEvent as jest.MockedFunction<typeof logEvent>

beforeEach(() => {
  jest.clearAllMocks()
  env.qaTrafficToken = ''
})

/** 造一个带 question_opened 事件 + 给定 props 的上报请求 */
function makeReq(props: Record<string, unknown>, storyId = 'story-1'): Request {
  return new Request('http://localhost/api/events', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json', 'x-flow-id': 'flow-xyz' },
    body: JSON.stringify({ event: 'match.question_opened', storyId, props }),
  })
}

/** 取本次 logEvent 收到的 props（= 收敛后实际写库内容） */
function capturedProps(): Record<string, unknown> {
  const arg = mockLogEvent.mock.calls[0][0]
  return (arg.props ?? {}) as Record<string, unknown>
}

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000'

describe('question_opened · sanitize 白名单（乙.1）', () => {
  test('合法 questionId(UUID) + algoVersion(短枚举) 放行', async () => {
    await POST(makeReq({ rank: 3, candidateCount: 8, questionId: VALID_UUID, algoVersion: 'v1-2026-07-17' }))
    expect(capturedProps()).toEqual({ rank: 3, candidateCount: 8, questionId: VALID_UUID, algoVersion: 'v1-2026-07-17' })
  })

  test('非 UUID 的 questionId 一律丢弃（含伪装成 id 的自由文本）', async () => {
    await POST(makeReq({ rank: 1, questionId: '用户偷偷塞的原文句子' }))
    expect(capturedProps()).toEqual({ rank: 1 })
  })

  test('超长 / 含非法字符的 algoVersion 一律丢弃', async () => {
    await POST(makeReq({ rank: 1, algoVersion: '这是一段中文原文不该进库'.repeat(5) }))
    expect(capturedProps()).toEqual({ rank: 1 })
  })

  test('view_rendered 的 rankingDegraded 必须放行（曾发了却被 sanitize 丢弃、生产 138 行里 0 行有它）', async () => {
    const req = new Request('http://localhost/api/events', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'match.view_rendered', props: { visibleCount: 0, noMatch: false, rankingDegraded: true } }),
    })
    await POST(req)
    expect(capturedProps()).toEqual({ visibleCount: 0, noMatch: false, rankingDegraded: true })
  })

  test('白名单外的任意键（原文字段）绝不进库', async () => {
    await POST(makeReq({ rank: 2, note: '我的隐私故事', transcript: 'hello world' }))
    expect(capturedProps()).toEqual({ rank: 2 })
  })

  test('非法数值（负 rank / 非整 dwellMs）被丢，flowId 走 header 透传', async () => {
    await POST(makeReq({ rank: -1, candidateCount: 5, dwellMs: 1.5 }))
    expect(capturedProps()).toEqual({ candidateCount: 5 })
    expect(mockLogEvent.mock.calls[0][0].flowId).toBe('flow-xyz')
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// P0/P1 补埋点（6 个新客户端事件）+ 事件名分发闸 + QA 流量标记
// ───────────────────────────────────────────────────────────────────────────────

/** 造一个任意事件名 + props + 额外请求头的上报请求 */
function makeEventReq(event: string, props: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/events', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ event, props }),
  })
}

/** 塞进每个事件里试探的「原文」字段——一条都不许出现在写库 props 里（隐私铁律） */
const RAW_TEXT_BAIT = {
  rawText: '我昨天和妈妈吵了一架',
  text: '这是用户的故事原文',
  transcript: 'yesterday I had an argument with my mother',
  sentence: '一句不该进库的话',
}

describe('新事件 · 合法 props 原样放行', () => {
  const CASES: Array<[string, Record<string, unknown>]> = [
    ['flow.story_entry',       { entry: 'record_from_write', mode: 'ielts' }],
    ['flow.mic_permission',    { result: 'denied', surface: 'recording' }],
    ['flow.capture_started',   { mode: 'voice' }],
    ['flow.capture_submitted', { mode: 'voice', outcome: 'proceed', durationSec: 42, charCount: 180 }],
    ['flow.capture_abandoned', { mode: 'text', exit: 'pagehide', durationSec: 0, charCount: 0 }],
    ['flow.ai_call',           { stage: 'transcribe', result: 'quota_402', httpStatus: 402, latencyMs: 1234, mode: 'voice' }],
    ['quota.reached',          { variant: 'trial', surface: 'question_bank' }],
    ['quota.cta',              { variant: 'ielts', cta: 'practice_ielts' }],
    ['auth.registered',        { fromAnonymous: true }],
  ]
  test.each(CASES)('%s 正例', async (event, props) => {
    await POST(makeEventReq(event, props))
    expect(mockLogEvent.mock.calls[0][0].event).toBe(event)
    expect(capturedProps()).toEqual(props)
  })

  test.each(CASES)('%s 混入原文字段 → 原文一律不进库', async (event, props) => {
    await POST(makeEventReq(event, { ...props, ...RAW_TEXT_BAIT }))
    expect(capturedProps()).toEqual(props)
  })
})

describe('flow.ai_call · 八个 stage 全放行（2026-08-03 由 3 段补到 8 段 = 全部 AI 路由）', () => {
  // 这五个是本次补的：漏进 sanitize 白名单不会 tsc 报错，只会【那一个字段静默消失】
  // （事件照常落库、stage 一栏空），本地测不出来 —— 故每个值都要有一条正例把它钉住。
  test.each([
    ['transcribe'], ['restructure'], ['polish'],
    ['matching'], ['analysis'], ['phrases'], ['coach'], ['pronounce'],
  ])('stage=%s 原样放行', async (stage) => {
    await POST(makeEventReq('flow.ai_call', { stage, result: 'ok', httpStatus: 200, latencyMs: 10 }))
    expect(capturedProps()).toEqual({ stage, result: 'ok', httpStatus: 200, latencyMs: 10 })
  })

  test.each([
    ['ranking'],        // 服务端 phase 名，不是客户端 stage 口径（客户端一次匹配统一记 matching）
    ['extraction'],     // 同上
    ['Matching'],       // 大小写近似
    ['coach '],         // 带空格
    ['analysis/phrases'],
  ])('枚举外/近似的 stage=%s 被丢，result 仍留', async (stage) => {
    await POST(makeEventReq('flow.ai_call', { stage, result: 'busy_503', httpStatus: 503 }))
    expect(capturedProps()).toEqual({ result: 'busy_503', httpStatus: 503 })
  })
})

describe('新事件 · 枚举负例（不 trim、不转小写，近似值一律丢）', () => {
  test('枚举外的值被丢', async () => {
    await POST(makeEventReq('flow.story_entry', { entry: 'scan', mode: 'story' }))
    expect(capturedProps()).toEqual({ mode: 'story' })
  })

  test('大小写近似（Proceed）被丢', async () => {
    await POST(makeEventReq('flow.capture_submitted', { mode: 'voice', outcome: 'Proceed' }))
    expect(capturedProps()).toEqual({ mode: 'voice' })
  })

  test('带空格（proceed ）被丢', async () => {
    await POST(makeEventReq('flow.capture_submitted', { mode: 'voice', outcome: 'proceed ' }))
    expect(capturedProps()).toEqual({ mode: 'voice' })
  })

  test('非字符串的枚举值被丢', async () => {
    await POST(makeEventReq('flow.mic_permission', { result: 1, surface: null }))
    expect(capturedProps()).toEqual({})
  })

  test('quota.reached 的 surface 拼错（近似值 Home / questionBank）被丢，variant 仍留', async () => {
    await POST(makeEventReq('quota.reached', { variant: 'story', surface: 'Home' }))
    expect(capturedProps()).toEqual({ variant: 'story' })
    jest.clearAllMocks()
    await POST(makeEventReq('quota.reached', { variant: 'story', surface: 'questionBank' }))
    expect(capturedProps()).toEqual({ variant: 'story' })
  })

  test('quota.cta 的 cta 带空格 / 枚举外一律丢', async () => {
    await POST(makeEventReq('quota.cta', { variant: 'trial', cta: 'register ' }))
    expect(capturedProps()).toEqual({ variant: 'trial' })
    jest.clearAllMocks()
    await POST(makeEventReq('quota.cta', { variant: 'trial', cta: 'buy_more' }))
    expect(capturedProps()).toEqual({ variant: 'trial' })
  })

  test('auth.registered 的 fromAnonymous 只收严格布尔（"true" / 1 / null 一律丢）', async () => {
    await POST(makeEventReq('auth.registered', { fromAnonymous: 'true' }))
    expect(capturedProps()).toEqual({})
    jest.clearAllMocks()
    await POST(makeEventReq('auth.registered', { fromAnonymous: 1 }))
    expect(capturedProps()).toEqual({})
    jest.clearAllMocks()
    await POST(makeEventReq('auth.registered', { fromAnonymous: false }))
    expect(capturedProps()).toEqual({ fromAnonymous: false })
  })

  test('props 整体非对象 → 空 props，不抛错', async () => {
    const req = new Request('http://localhost/api/events', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'flow.capture_started', props: '整段原文' }),
    })
    await POST(req)
    expect(capturedProps()).toEqual({})
  })
})

describe('新事件 · 整数负例（负/小数/字符串数字/Infinity/NaN/超界一律丢）', () => {
  test('durationSec 负数 / charCount 小数被丢', async () => {
    await POST(makeEventReq('flow.capture_submitted', { mode: 'text', durationSec: -1, charCount: 1.5 }))
    expect(capturedProps()).toEqual({ mode: 'text' })
  })

  test('字符串数字 / Infinity / NaN 被丢', async () => {
    // JSON 里 Infinity/NaN 只能以 null 落地，故直接构造 body 字符串绕开 JSON.stringify 的转换
    const body = '{"event":"flow.ai_call","props":{"stage":"polish","httpStatus":"200","latencyMs":Infinity}}'
    const req = new Request('http://localhost/api/events', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body,
    })
    await POST(req)
    // body 非合法 JSON（Infinity）→ 解析失败走 500，绝不落库；这也是「脏数据进不来」的一层
    expect(mockLogEvent).not.toHaveBeenCalled()
    await POST(makeEventReq('flow.ai_call', { stage: 'polish', httpStatus: '200', latencyMs: Number.NaN }))
    expect(capturedProps()).toEqual({ stage: 'polish' })
  })

  test('超界（durationSec>3600 / charCount>10万 / httpStatus>599 / latencyMs>10min）被丢', async () => {
    await POST(makeEventReq('flow.capture_abandoned', { exit: 'nav', durationSec: 3601, charCount: 100001 }))
    expect(capturedProps()).toEqual({ exit: 'nav' })
    jest.clearAllMocks()
    await POST(makeEventReq('flow.ai_call', { stage: 'restructure', httpStatus: 600, latencyMs: 600001 }))
    expect(capturedProps()).toEqual({ stage: 'restructure' })
  })

  test('边界值（0 / 3600 / 599 / 600000）放行', async () => {
    await POST(makeEventReq('flow.ai_call', { httpStatus: 599, latencyMs: 600000 }))
    expect(capturedProps()).toEqual({ httpStatus: 599, latencyMs: 600000 })
  })
})

describe('事件名分发闸 —— 未注册立即 400、绝不落库', () => {
  test.each([
    ['flow.unknown_event'],       // 编造的名字
    ['match.result'],             // 服务端自发事件，不接受客户端上报
    ['flow.corpus_bound'],        // 同上
    ['flow.consent_granted'],     // 同上（由 /api/consent 服务端补发）
    ['FLOW.STORY_ENTRY'],         // 大小写近似
    [''],                         // 空串
  ])('事件名 %s → 400 且 logEvent 零调用', async (event) => {
    const res = await POST(makeEventReq(event, { mode: 'voice' }))
    expect(res.status).toBe(400)
    expect(mockLogEvent).not.toHaveBeenCalled()
  })

  test('event 非字符串 → 400 且 logEvent 零调用', async () => {
    const req = new Request('http://localhost/api/events', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ event: { name: 'flow.ai_call' }, props: {} }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(mockLogEvent).not.toHaveBeenCalled()
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// 事件名形态护栏 —— 挡「新事件名不符合 DB CHECK → insert 被拒 → logEvent 静默吞 → 全程零数据」
// 这一类最难查的故障：代码在跑、接口 200、页面无异常，只有库里一行都没有。
// ───────────────────────────────────────────────────────────────────────────────

/** 与 migration 0053 的 flow_events_event_check 逐字一致；改这里必须同步改迁移，反之亦然 */
const EVENT_NAME_RE = /^(flow|match|quota|auth|page)\.[a-z][a-z0-9_]{1,39}$/

/**
 * FlowEventName 全集。用 Record<FlowEventName, true> 声明：新增一个事件名却漏登记 → tsc 直接报错，
 * 不会出现「测试只覆盖旧事件名、新名字带着不合法形态上线」的空档。
 */
const ALL_FLOW_EVENTS: Record<FlowEventName, true> = {
  'match.result': true,
  'flow.corpus_bound': true,
  'match.view_rendered': true,
  'match.question_opened': true,
  'flow.story_entry': true,
  'flow.mic_permission': true,
  'flow.capture_started': true,
  'flow.capture_submitted': true,
  'flow.capture_abandoned': true,
  'flow.ai_call': true,
  'flow.consent_granted': true,
  'quota.reached': true,
  'quota.cta': true,
  'auth.registered': true,
}

/** 客户端可上报事件名全集（同款 Record 手法，漏登记即 tsc 报错） */
const ALL_CLIENT_EVENTS: Record<ClientEventName, true> = {
  'flow.story_entry': true,
  'flow.mic_permission': true,
  'flow.capture_started': true,
  'flow.capture_submitted': true,
  'flow.capture_abandoned': true,
  'flow.ai_call': true,
  'match.view_rendered': true,
  'match.question_opened': true,
  'quota.reached': true,
  'quota.cta': true,
  'auth.registered': true,
}

describe('事件名形态护栏 —— 必须过 0053 的 DB CHECK 正则', () => {
  test.each(Object.keys(ALL_FLOW_EVENTS))('FlowEventName %s 符合 DB CHECK 正则', (name) => {
    expect(name).toMatch(EVENT_NAME_RE)
  })

  test.each(Object.keys(ALL_CLIENT_EVENTS))('客户端事件名 %s 已注册进 EVENT_SPECS 分发表（否则 400、零数据）', async (name) => {
    const res = await POST(makeEventReq(name, {}))
    expect(res.status).toBe(200)
    expect(mockLogEvent.mock.calls[0][0].event).toBe(name)
  })

  test('ClientEventName 全部是 FlowEventName 的子集（客户端不能上报服务端没登记的名字）', () => {
    for (const name of Object.keys(ALL_CLIENT_EVENTS)) {
      expect(Object.keys(ALL_FLOW_EVENTS)).toContain(name)
    }
  })
})

describe('QA 流量标记 —— 严格 === 比对 + 未配 token 时 fail-closed', () => {
  /** 取本次 logEvent 收到的 isQa */
  function capturedIsQa(): boolean | undefined {
    return mockLogEvent.mock.calls[0][0].isQa
  }

  test('配了 token 且请求头完全一致 → isQa true', async () => {
    env.qaTrafficToken = 's3cret-token'
    await POST(makeEventReq('flow.capture_started', { mode: 'voice' }, { 'x-qa-traffic': 's3cret-token' }))
    expect(capturedIsQa()).toBe(true)
  })

  test('配了 token 但请求头缺失 → false', async () => {
    env.qaTrafficToken = 's3cret-token'
    await POST(makeEventReq('flow.capture_started', { mode: 'voice' }))
    expect(capturedIsQa()).toBe(false)
  })

  test.each(['0', 'true', 'yes', '1', 'S3CRET-TOKEN', 's3cret-tokenx'])(
    '配了 token 但请求头为 %s（非全等）→ false',
    async (header) => {
      env.qaTrafficToken = 's3cret-token'
      await POST(makeEventReq('flow.capture_started', { mode: 'voice' }, { 'x-qa-traffic': header }))
      expect(capturedIsQa()).toBe(false)
    },
  )

  test('请求头首尾空白由 HTTP 层剥离 → 与原 token 等价（记录既成事实，非判定放松）', async () => {
    // Headers 规范会 strip 头值的首尾 HTTP 空白，'  token  ' 到服务端就是 'token'。
    // 即：QA token 里带首尾空格没有意义，也不会因此漏判。此处锁死这一行为，免得日后误以为是比对被放宽。
    env.qaTrafficToken = 's3cret-token'
    await POST(makeEventReq('flow.capture_started', { mode: 'voice' }, { 'x-qa-traffic': '  s3cret-token  ' }))
    expect(capturedIsQa()).toBe(true)
  })

  test.each(['', '0', 'true', 'yes', 'anything'])(
    'env 未配 token 时，请求头 %s 一律 false（fail-closed，绝不能全站被标 QA）',
    async (header) => {
      env.qaTrafficToken = ''
      await POST(makeEventReq('flow.capture_started', { mode: 'voice' }, { 'x-qa-traffic': header }))
      expect(capturedIsQa()).toBe(false)
    },
  )

  test('内部账户 userId 不带任何头 → isQa true（服务端权威来源，不可伪造）', async () => {
    const internalId = Array.from(INTERNAL_ACCOUNT_IDS)[0]
    ;(requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>)
      .mockResolvedValueOnce({ userId: internalId, isAnonymous: false })
    await POST(makeEventReq('flow.capture_started', { mode: 'voice' }))
    expect(capturedIsQa()).toBe(true)
  })

  test('普通用户不带头 → isQa false', async () => {
    await POST(makeEventReq('flow.capture_started', { mode: 'voice' }))
    expect(capturedIsQa()).toBe(false)
  })
})
