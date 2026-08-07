/**
 * @module   api/analysis/route.test
 * @desc     分析接口双路单测 —— 守卫流式改造的核心不变式：
 *           ① 默认流式：未命中边生成边发帧（meta → section → done），流末记一条 usage + 回填缓存；
 *           ② 缓存命中走 SSE：一帧 meta + 拆出的 section 帧 + done(cache)，【不调 AI、不写 usage】；
 *           ③ 开流后异常 → error 帧 + 记 error 账；④ 配额闸在开流前（402/429 普通 JSON、不开流、不调模型）；
 *           ⑤ 预取（body.prefetch=true）自阶段三起【也走流式 SSE】（generateAnalysisStreaming、成本归因
 *              metadata.prefetch=true、预取闸取/满503/释放、命中缓存不取闸）；仅 ?stream=0 降级路走
 *              handleBuffered（阻塞式整批、用 generateAnalysis）。
 *           全部依赖 mock，不碰真实 DB / 模型 / 鉴权。
 * @author   LingoBridge
 * @created  2026-08-01
 */
import { createHash } from 'crypto'

// —— 依赖全 mock 在模块边界 ——
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/db/questions', () => ({ getQuestionById: jest.fn() }))
jest.mock('@/lib/db/question-analyses', () => ({
  getPersonalAnalysis: jest.fn(),
  upsertPersonalAnalysis: jest.fn(),
}))
jest.mock('@/lib/db/corpus-server', () => ({
  getCorpusByIdServer: jest.fn(),
  getCorpusPrimaryPointCodeServer: jest.fn(),
  bumpDailyUsageServer: jest.fn(),
}))
jest.mock('@/services/analysis', () => ({
  generateAnalysis: jest.fn(),
  generateAnalysisStreaming: jest.fn(),
}))
jest.mock('@/lib/api-logger', () => ({
  logApiUsage: jest.fn(),
  qwenPlusCostCny: jest.fn(() => 0.001),
}))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(),
  assertCorpusOwner: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({ requireConsent: jest.fn(() => Promise.resolve(null)) }))
// env-server 只在 qa-traffic 这条链路被用到（读 QA_TRAFFIC_TOKEN）：mock 掉，供 QA 标记用例开关它。
jest.mock('@/lib/env-server', () => ({ env: { qaTrafficToken: '' } }))
// 预取闸：acquire 走可控 mockAcquire（惰性引用，绕开 jest.mock 提升 TDZ）；测试改其 resolve 值控制取闸成功/满，
// 挂 mockReleaseFn 供断言【恰好释放一次】。真实用户请求（非预取）根本不调 acquire。
const mockAcquire = jest.fn()
let mockReleaseFn: jest.Mock
jest.mock('@/lib/concurrency-gate', () => ({
  createConcurrencyGate: () => ({ acquire: (...args: unknown[]) => mockAcquire(...args) }),
}))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))

import { POST } from '@/app/api/analysis/route'
import { getQuestionById } from '@/lib/db/questions'
import { getPersonalAnalysis, upsertPersonalAnalysis } from '@/lib/db/question-analyses'
import { getCorpusByIdServer, getCorpusPrimaryPointCodeServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { generateAnalysis, generateAnalysisStreaming } from '@/services/analysis'
import { logApiUsage } from '@/lib/api-logger'
import { requireUserAllowAnon, assertCorpusOwner } from '@/lib/api-auth'
import { env } from '@/lib/env-server'
import type { QuestionAnalysis } from '@/lib/types'

const mockGetQuestion   = getQuestionById as jest.MockedFunction<typeof getQuestionById>
const mockGetPersonal   = getPersonalAnalysis as jest.MockedFunction<typeof getPersonalAnalysis>
const mockUpsert        = upsertPersonalAnalysis as jest.MockedFunction<typeof upsertPersonalAnalysis>
const mockGetCorpus     = getCorpusByIdServer as jest.MockedFunction<typeof getCorpusByIdServer>
const mockGetPrimary    = getCorpusPrimaryPointCodeServer as jest.MockedFunction<typeof getCorpusPrimaryPointCodeServer>
const mockBumpDaily     = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>
const mockGenerate      = generateAnalysis as jest.MockedFunction<typeof generateAnalysis>
const mockGenStream     = generateAnalysisStreaming as jest.MockedFunction<typeof generateAnalysisStreaming>
const mockLogApiUsage   = logApiUsage as jest.MockedFunction<typeof logApiUsage>
const mockRequireUser   = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockAssertOwner   = assertCorpusOwner as jest.MockedFunction<typeof assertCorpusOwner>

// —— 桩数据 ——
const STORY = '上周末我去公园散步，放松了很久。'
// content_hash 折进 level（body 未带 level → 默认 '6.0'）：与 route.ts 的 contentHashOf(story, level) 同口径。
const HASH = createHash('sha256').update(`${STORY}\nlevel=6.0`).digest('hex')
const SEASON = '2026-05'

const ANALYSIS: QuestionAnalysis = {
  structureLabel: '交代背景 · 讲清重点',
  focusPoints: [{ title: '交代背景', desc: '一句话带过时间地点。' }],
  phrases: [{ group: '感受', items: [{ text: 'felt relaxed', meaning: '放松', scene: '休息后' }] }],
}

function makeQuestion() {
  return {
    id: 'q1', part: 1 as const, question_text: 'What do you do at weekends?', question_text_zh: '周末做什么？',
    cue_card_title: null, cue_card_title_zh: null, observation_points: ['SPA_03'], season: SEASON, is_new: false,
  }
}

/** 流式默认路请求（无 stream 参数、无 prefetch） */
function makeStreamReq(body: Record<string, unknown> = { questionId: 'q1', storyId: 'c1' }): Request {
  return new Request('http://localhost/api/analysis', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** 读干一个 SSE Response → { event, data } 帧数组（data 已 JSON.parse） */
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

beforeEach(() => {
  jest.clearAllMocks()
  // 默认取闸成功、release 挂稳定 jest.fn（供断言释放次数）；gate 满的用例各自覆盖 mockAcquire。
  mockReleaseFn = jest.fn()
  mockAcquire.mockResolvedValue({ ok: true, release: mockReleaseFn })
  mockRequireUser.mockResolvedValue({ userId: 'u1', isAnonymous: false })
  mockAssertOwner.mockResolvedValue(undefined)
  mockBumpDaily.mockResolvedValue(1)
  mockGetCorpus.mockResolvedValue(STORY)
  mockGetPrimary.mockResolvedValue(null)
  mockGetQuestion.mockResolvedValue(makeQuestion() as never)
  mockGetPersonal.mockResolvedValue(null)
  mockUpsert.mockResolvedValue(undefined)
  mockLogApiUsage.mockResolvedValue(undefined)
  mockGenerate.mockResolvedValue(ANALYSIS)
  mockGenStream.mockImplementation(async (_input, onSection, onUsage) => {
    onSection?.({ kind: 'structureLabel', value: ANALYSIS.structureLabel })
    onSection?.({ kind: 'focusPoint', value: ANALYSIS.focusPoints[0] })
    onSection?.({ kind: 'phraseGroup', value: ANALYSIS.phrases[0] })
    onUsage?.({ promptTokens: 100, completionTokens: 40 })
    return ANALYSIS
  })
})

describe('POST /api/analysis · 默认流式 SSE', () => {
  test('S1. fresh 未命中：event-stream，帧序 meta → section → done；流末记一条 usage + 回填缓存', async () => {
    const res = await POST(makeStreamReq())
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const frames = await readSSE(res)

    expect(frames[0].event).toBe('meta')
    expect((frames[0].data as { question: { id: string } }).question.id).toBe('q1')
    const sectionFrames = frames.filter((f) => f.event === 'section')
    expect(sectionFrames.map((f) => (f.data as { kind: string }).kind)).toEqual(['structureLabel', 'focusPoint', 'phraseGroup'])
    const done = frames[frames.length - 1]
    expect(done.event).toBe('done')
    expect((done.data as { analysis: QuestionAnalysis }).analysis).toEqual(ANALYSIS)

    // 流末：真实 usage 记一条（cost_source=actual），回填缓存一次（键/季度/哈希与 buffered 同）
    expect(mockLogApiUsage).toHaveBeenCalledTimes(1)
    expect(mockLogApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', metadata: expect.objectContaining({ phase: 'analysis', cost_source: 'actual', prefetch: false }) }),
    )
    expect(mockUpsert).toHaveBeenCalledWith('c1', 'q1', SEASON, HASH, ANALYSIS)
  })

  test('S2. 缓存命中：走 SSE 一帧 meta + section + done(cache)，不调 AI、不写 usage、不回填', async () => {
    mockGetPersonal.mockResolvedValue({ analysis: ANALYSIS, season: SEASON, contentHash: HASH })

    const res = await POST(makeStreamReq())
    const frames = await readSSE(res)

    expect(mockGenStream).not.toHaveBeenCalled()
    expect(mockLogApiUsage).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
    // 命中也照扣次（与 handleBuffered 同口径：bump 在读缓存前、无条件）
    expect(mockBumpDaily).toHaveBeenCalledTimes(1)
    expect(frames[0].event).toBe('meta')
    const sectionFrames = frames.filter((f) => f.event === 'section')
    expect(sectionFrames.map((f) => (f.data as { kind: string }).kind)).toEqual(['structureLabel', 'focusPoint', 'phraseGroup'])
    const done = frames[frames.length - 1]
    expect(done.event).toBe('done')
    expect((done.data as { analysis: QuestionAnalysis }).analysis).toEqual(ANALYSIS)
  })

  test('S3. 开流后 generateAnalysisStreaming 抛错 → error 帧、无 done，且记一条 status=error·phase=analysis 账', async () => {
    mockGenStream.mockRejectedValue(new Error('上游 5xx'))

    const res = await POST(makeStreamReq())
    const frames = await readSSE(res)

    expect(frames.some((f) => f.event === 'error')).toBe(true)
    expect(frames.some((f) => f.event === 'done')).toBe(false)
    const errCall = mockLogApiUsage.mock.calls.map(([a]) => a).find((c) => c.status === 'error')
    expect(errCall).toBeDefined()
    expect((errCall?.metadata as { phase?: string } | undefined)?.phase).toBe('analysis')
  })

  test('S4. 配额闸在开流前：注册超上限 → 429 普通 JSON，不开流、不调模型', async () => {
    mockBumpDaily.mockResolvedValue(999999)

    const res = await POST(makeStreamReq())

    expect(res.status).toBe(429)
    expect(res.headers.get('content-type')).not.toContain('text/event-stream')
    expect(mockGenStream).not.toHaveBeenCalled()
  })

  test('S5. 配额闸在开流前：匿名超上限 → 402 QUOTA_EXCEEDED，不开流', async () => {
    mockRequireUser.mockResolvedValue({ userId: 'anon1', isAnonymous: true })
    mockBumpDaily.mockResolvedValue(999999)

    const res = await POST(makeStreamReq())
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(402)
    expect(body.code).toBe('QUOTA_EXCEEDED')
    expect(mockGenStream).not.toHaveBeenCalled()
  })

  test('S6. 缺 questionId → 400 普通 JSON，不开流', async () => {
    const res = await POST(makeStreamReq({ storyId: 'c1' }))
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).not.toContain('text/event-stream')
    expect(mockGenStream).not.toHaveBeenCalled()
  })
})

describe('POST /api/analysis · 预取（流式）/ 降级（?stream=0 → handleBuffered）', () => {
  test('B1. 预取未命中 → 流式 SSE（generateAnalysisStreaming），成本归因 metadata.prefetch=true，取闸并在 done 后释放一次', async () => {
    const res = await POST(makeStreamReq({ questionId: 'q1', storyId: 'c1', prefetch: true }))

    // 预取现在也走流式（与真实用户同路），仅 body 多带 prefetch:true
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const frames = await readSSE(res)
    expect(frames[0].event).toBe('meta')
    const done = frames[frames.length - 1]
    expect(done.event).toBe('done')
    expect((done.data as { analysis: QuestionAnalysis }).analysis).toEqual(ANALYSIS)

    expect(mockGenStream).toHaveBeenCalledTimes(1)
    expect(mockGenerate).not.toHaveBeenCalled()
    // 成本归因：预取的 metadata.prefetch=true（真实 isPrefetch 已传进 logAnalysisUsage）
    expect(mockLogApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', metadata: expect.objectContaining({ phase: 'analysis', prefetch: true }) }),
    )
    // 预取闸：取一次、done 帧后释放【恰好一次】（不泄漏、不双释）
    expect(mockAcquire).toHaveBeenCalledTimes(1)
    expect(mockReleaseFn).toHaveBeenCalledTimes(1)
  })

  test('B1b. 预取未命中 + 闸满 → 503 普通 JSON，不开流、不调模型、不释放', async () => {
    mockAcquire.mockResolvedValue({ ok: false, reason: 'queue_full' })

    const res = await POST(makeStreamReq({ questionId: 'q1', storyId: 'c1', prefetch: true }))

    expect(res.status).toBe(503)
    expect(res.headers.get('content-type')).not.toContain('text/event-stream')
    expect(mockGenStream).not.toHaveBeenCalled()
    expect(mockReleaseFn).not.toHaveBeenCalled()   // ok=false 不可 release（gate 契约）
  })

  test('B1c. 预取命中缓存 → 不取闸（无 AI 调用），仍走 SSE 回放缓存', async () => {
    mockGetPersonal.mockResolvedValue({ analysis: ANALYSIS, season: SEASON, contentHash: HASH })

    const res = await POST(makeStreamReq({ questionId: 'q1', storyId: 'c1', prefetch: true }))
    const frames = await readSSE(res)

    expect(mockAcquire).not.toHaveBeenCalled()   // 命中不调 AI → 不取闸（同 handleBuffered 口径）
    expect(mockGenStream).not.toHaveBeenCalled()
    expect(mockLogApiUsage).not.toHaveBeenCalled()
    expect(frames[frames.length - 1].event).toBe('done')
  })

  test('B1d. 预取开流后 generateAnalysisStreaming 抛错 → error 帧 + 释放闸一次（异常出路不泄漏）', async () => {
    mockGenStream.mockRejectedValue(new Error('上游 5xx'))

    const res = await POST(makeStreamReq({ questionId: 'q1', storyId: 'c1', prefetch: true }))
    const frames = await readSSE(res)

    expect(frames.some((f) => f.event === 'error')).toBe(true)
    expect(mockAcquire).toHaveBeenCalledTimes(1)
    expect(mockReleaseFn).toHaveBeenCalledTimes(1)
  })

  test('B2. ?stream=0（降级路）→ 阻塞式整批 JSON，用 generateAnalysis，不走流式', async () => {
    const req = new Request('http://localhost/api/analysis?stream=0', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'q1', storyId: 'c1' }),
    })
    const res = await POST(req)

    expect(res.headers.get('content-type')).not.toContain('text/event-stream')
    const body = (await res.json()) as { analysis: QuestionAnalysis }
    expect(body.analysis).toEqual(ANALYSIS)
    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(mockGenStream).not.toHaveBeenCalled()
    // 降级路是真实用户请求（非预取）：metadata.prefetch=false
    expect(mockLogApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ phase: 'analysis', prefetch: false }) }),
    )
  })
})

/**
 * QA 自测流量标记（迁移 0059）——【流式默认路】的记账同样要标：真实用户走的就是这一路，
 * 2026-08-02 matching 那次「漏标 isQa、生产数据全 false」正是只漏在流式路上。
 * ⚠️ 只验统计列取值，绝不把 is_qa 接到额度/权限判定上（可伪造，红线见 qa-traffic 顶注）。
 */
describe('POST /api/analysis · 流式路记账的 QA 标记', () => {
  const TOKEN = 's3cret-token'

  /** 带（或不带）QA 头的流式请求 */
  function qaStreamReq(header?: string): Request {
    const headers: Record<string, string> = { authorization: 'Bearer t', 'content-type': 'application/json' }
    if (header !== undefined) headers['x-qa-traffic'] = header
    return new Request('http://localhost/api/analysis', {
      method: 'POST', headers, body: JSON.stringify({ questionId: 'q1', storyId: 'c1' }),
    })
  }

  /** 本次唯一一条记账的 is_qa */
  function isQaOf(): boolean | undefined {
    const call = mockLogApiUsage.mock.calls[0]?.[0] as { is_qa?: boolean } | undefined
    if (!call) throw new Error('未记到任何一条账')
    return call.is_qa
  }

  // 未命中缓存 + generateAnalysisStreaming 的桩由外层 beforeEach 统一提供（本 describe 不另造，
  // 免得两份桩漂移）；这里只把服务端 QA token 配上。
  beforeEach(() => {
    ;(env as { qaTrafficToken: string }).qaTrafficToken = TOKEN
  })

  test('带对 QA 头 → 流末那条 usage 标 is_qa=true', async () => {
    const res = await POST(qaStreamReq(TOKEN))
    await res.text()
    expect(isQaOf()).toBe(true)
  })

  test('普通用户不带头 → false（绝不误剔真实成本）', async () => {
    const res = await POST(qaStreamReq())
    await res.text()
    expect(isQaOf()).toBe(false)
  })

  test('服务端未配 token → 头再对也判 false（fail-closed）', async () => {
    ;(env as { qaTrafficToken: string }).qaTrafficToken = ''
    const res = await POST(qaStreamReq(TOKEN))
    await res.text()
    expect(isQaOf()).toBe(false)
  })

  test('开流后异常的失败记账：同样带 QA 标记与归属（失败也烧钱）', async () => {
    mockGenStream.mockRejectedValueOnce(new Error('模型超时'))
    const res = await POST(qaStreamReq(TOKEN))
    await res.text()
    expect(mockLogApiUsage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error', is_qa: true, user_id: 'u1', is_anonymous: false,
    }))
  })
})
