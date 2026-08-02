/**
 * @module   qa-flag-client-events.test
 * @desc     QA 流量标记 + 客户端上报封装的客户端链路验证（ENGINEERING §8：lib 工具函数必须有单测）。
 *           【不 mock api-client】：track → apiFetch → fetch 全走真实实现、只把最外层 fetch 打桩，
 *           这样验的是真实请求形态（URL / 方法 / 头 / body / keepalive），而不是几个 mock 的自洽。
 *           守卫四条：
 *             A) ?qa=<token> 写入、?qa=0 清除、无参数不动（标记只能显式开关，不会被普通导航冲掉），
 *                且写入/读出两处都过【形态】白名单 —— 非 ASCII/含换行的值会让 Headers 构造抛错、
 *                使受害者全站 API 永久发不出请求（形态校验在客户端，语义校验仍在服务端）；
 *             B) 无 session 时一个请求都不发（全新访客首页无 session，否则一串 401 噪音）；
 *             C) 有标记时请求头带 X-QA-Traffic —— 漏斗末级 flow.corpus_bound 全靠它才标得上 QA；
 *             D) fire-and-forget：数字取整、undefined 丢弃、fetch 抛错不外溢到调用方。
 *           jest 默认 node 环境无 window/localStorage，沿用 consent.test.ts 的垫片写法。
 * @author   LingoBridge
 * @created  2026-08-02
 */
jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn(), ensureSession: jest.fn() }))

import { syncQaFlagFromUrl, qaToken } from '@/lib/qa-flag'
import { track } from '@/lib/client-events'
import { getSupabase } from '@/lib/supabase'

/** 最小 storage 垫片（node 环境无 window/localStorage/sessionStorage） */
function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size },
  } as Storage
}

let fetchMock: jest.Mock

/** 装好 window / storage / fetch 垫片，并设定当前 URL 的 query */
function setup(search: string, token: string | null): void {
  const ls = makeStorage()
  const ss = makeStorage()
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { location: { search }, localStorage: ls, sessionStorage: ss }
  g.localStorage = ls
  g.sessionStorage = ss
  fetchMock = jest.fn(() => Promise.resolve(new Response('{"ok":true}', { status: 200 })))
  g.fetch = fetchMock
  ;(getSupabase as jest.Mock).mockReturnValue({
    auth: { getSession: () => Promise.resolve({ data: { session: token ? { access_token: token } : null } }) },
  })
}

/** track 是 fire-and-forget（同步返回 void），要把挂起的微任务放完才能断言 */
function flush(): Promise<void> {
  return new Promise((r) => setImmediate(r))
}

/** 取本次 fetch 的 init（headers / body / keepalive） */
function fetchInit(): RequestInit & { headers: Record<string, string>; body: string } {
  return fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string>; body: string }
}

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>
  delete g.window
  delete g.localStorage
  delete g.sessionStorage
  delete g.fetch
  jest.clearAllMocks()
})

describe('A) qa-flag —— 标记只能显式开关', () => {
  test('?qa=<合法形态 token> 写入本地（是否有效仍由服务端判）', () => {
    setup('?qa=s3cret-token', 'tok')
    syncQaFlagFromUrl()
    expect(qaToken()).toBe('s3cret-token')
  })

  test('?qa=0 清除标记', () => {
    setup('?qa=s3cret-token', 'tok')
    syncQaFlagFromUrl()
    ;(globalThis as unknown as { window: { location: { search: string } } }).window.location.search = '?qa=0'
    syncQaFlagFromUrl()
    expect(qaToken()).toBeNull()
  })

  test('无 qa 参数 → 已有标记保持不变（普通导航不会把标记冲掉）', () => {
    setup('?qa=s3cret-token', 'tok')
    syncQaFlagFromUrl()
    ;(globalThis as unknown as { window: { location: { search: string } } }).window.location.search = '?from=home'
    syncQaFlagFromUrl()
    expect(qaToken()).toBe('s3cret-token')
  })

  test('?qa=（空值）→ 不写也不清', () => {
    setup('?qa=', 'tok')
    syncQaFlagFromUrl()
    expect(qaToken()).toBeNull()
  })

  // 形态白名单（客户端自保，非语义校验）：这些值一旦进了 X-QA-Traffic 头，浏览器构造 Headers 就抛
  // TypeError → 受害者的每个 API 请求都发不出去，且本模块不自动过期 = 永久瘫痪。一条链接即可触发。
  test.each(['中', '中文token', 'a\nb', 'a b', 'x'.repeat(65), 'tok%0d%0aX-Evil:1'])(
    '?qa=%s（非法形态）→ 一个字都不写',
    (bad) => {
      setup(`?qa=${bad}`, 'tok')
      syncQaFlagFromUrl()
      expect(qaToken()).toBeNull()
    },
  )

  test('本次修复前写进 localStorage 的历史脏值 → 读出口也当没有标记', () => {
    setup('', 'tok')
    localStorage.setItem('lingobridge:qa', '中')
    expect(qaToken()).toBeNull()
  })
})

describe('B) track —— 无 session 静默短路', () => {
  test('无 session 时一个请求都不发', async () => {
    setup('', null)
    track('flow.story_entry', { entry: 'record', mode: 'story' })
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('C) track → apiFetch 真实请求形态', () => {
  test('POST /api/events，带 Authorization + JSON body', async () => {
    setup('', 'tok-123')
    track('flow.story_entry', { entry: 'record', mode: 'story' }, { storyId: 'story-1' })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/events')
    const init = fetchInit()
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok-123')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({
      event: 'flow.story_entry',
      storyId: 'story-1',
      props: { entry: 'record', mode: 'story' },
    })
  })

  test('本地有 QA 标记 → 请求头带 X-QA-Traffic（漏斗末级靠它才标得上 QA）', async () => {
    setup('?qa=s3cret-token', 'tok-123')
    syncQaFlagFromUrl()
    track('flow.capture_started', { mode: 'voice' })
    await flush()
    expect(fetchInit().headers['X-QA-Traffic']).toBe('s3cret-token')
  })

  test('无 QA 标记 → 不带该头（真实用户请求一字不变）', async () => {
    setup('', 'tok-123')
    track('flow.capture_started', { mode: 'voice' })
    await flush()
    expect(fetchInit().headers['X-QA-Traffic']).toBeUndefined()
  })

  test('keepalive 透传（页面离开路径必须用它，不是 sendBeacon）', async () => {
    setup('', 'tok-123')
    track('flow.capture_abandoned', { mode: 'text', exit: 'pagehide' }, { keepalive: true })
    await flush()
    expect(fetchInit().keepalive).toBe(true)
  })
})

describe('D) track —— 取整、丢空、错误不外溢', () => {
  test('数字统一 Math.round（服务端只收整数，浮点会被静默丢弃）', async () => {
    setup('', 'tok-123')
    track('flow.ai_call', { stage: 'transcribe', latencyMs: 1234.6, httpStatus: 200 })
    await flush()
    expect(JSON.parse(fetchInit().body).props).toEqual({ stage: 'transcribe', latencyMs: 1235, httpStatus: 200 })
  })

  test('undefined 字段丢弃、非有限数丢弃', async () => {
    setup('', 'tok-123')
    track('flow.capture_submitted', { mode: 'voice', outcome: undefined, durationSec: Number.NaN, charCount: Infinity })
    await flush()
    expect(JSON.parse(fetchInit().body).props).toEqual({ mode: 'voice' })
  })

  test('fetch 抛错不外溢（埋点失败对调用方完全无感）', async () => {
    setup('', 'tok-123')
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    expect(() => track('flow.capture_started', { mode: 'voice' })).not.toThrow()
    await flush()
  })
})
