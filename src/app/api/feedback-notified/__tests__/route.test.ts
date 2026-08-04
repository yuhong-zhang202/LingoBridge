/**
 * @module   api/feedback-notified/route.test
 * @desc     反馈闭环通知端点守卫。重点是【跨用户隔离】：这个端点吐的是用户手写的反馈原文
 *           与我们的回复，任何一处漏掉 user_id 过滤都是隐私事故，故把「查询链上必须带
 *           eq('user_id', 调用者)」写成断言钉死，而不是只测状态码。
 *           另覆盖：匿名一律空（认不出人，通知送不到）、只取 manual（crash 不发通知，产品方拍板）、
 *           notified_at 由服务端给（不收客户端时间）、未迁移/查询异常静默不打断首页。
 *           全 mock，不碰真实 DB / 鉴权。
 * @author   LingoBridge
 * @created  2026-08-04
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(),
  authErrorResponse: jest.fn((e: unknown) => {
    const status = (e as { status?: number } | null)?.status
    if (status === 401 || status === 403) {
      return { status, json: () => Promise.resolve({ error: (e as { message?: string }).message }) } as unknown
    }
    return null
  }),
}))

import { GET, POST } from '@/app/api/feedback-notified/route'
import { requireUserAllowAnon } from '@/lib/api-auth'
import { getSupabaseServer } from '@/lib/supabase-server'

const mockRequireUser = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockGetSupabase = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

const ME = 'aaaaaaaa-1111-4111-8111-111111111111'
const FB_ID = '11111111-2222-4333-8444-555555555555'

/** 记录查询链上调用过的 eq/is/not 条件，用来断言 user_id 过滤确实存在 */
let filters: Array<[string, unknown]>
/** 记录 update 的写入载荷 */
let updatePayload: Record<string, unknown> | null
/** 预置查询结果 */
let queryResult: { data: unknown[] | null; error: unknown }

function makeReq(method: 'GET' | 'POST', body?: unknown): Request {
  return new Request('http://localhost/api/feedback-notified', {
    method,
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  filters = []
  updatePayload = null
  queryResult = { data: [], error: null }
  mockRequireUser.mockResolvedValue({ userId: ME, isAnonymous: false })

  // 链式 mock：select/eq/not/is/order/limit/in/update 全部返回自身，终点 await 时给 queryResult
  const chain: Record<string, unknown> = {}
  const track = (name: string) => (...args: unknown[]) => {
    if (name === 'eq' || name === 'is' || name === 'in') filters.push([`${name}:${String(args[0])}`, args[1]])
    return chain
  }
  Object.assign(chain, {
    select: track('select'),
    eq: track('eq'),
    not: track('not'),
    is: track('is'),
    in: track('in'),
    order: track('order'),
    update: (payload: Record<string, unknown>) => { updatePayload = payload; return chain },
    limit: () => Promise.resolve(queryResult),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(queryResult).then(resolve),
  })
  mockGetSupabase.mockReturnValue({ from: () => chain } as never)
})

describe('GET · 取待告知的反馈', () => {
  it('🔴 跨用户隔离：查询必须按调用者的 user_id 过滤', async () => {
    await GET(makeReq('GET'))
    expect(filters).toContainEqual(['eq:user_id', ME])
  })

  it('只取主动反馈（crash 不发通知，产品方拍板）', async () => {
    await GET(makeReq('GET'))
    expect(filters).toContainEqual(['eq:kind', 'manual'])
  })

  it('只取还没通知过的（notified_at is null），否则同一条会反复弹', async () => {
    await GET(makeReq('GET'))
    expect(filters).toContainEqual(['is:notified_at', null])
  })

  it('匿名用户直接空数组：换设备就认不出人，不该让弹窗逻辑去猜', async () => {
    mockRequireUser.mockResolvedValue({ userId: ME, isAnonymous: true })
    const res = await GET(makeReq('GET'))
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toEqual([])
    expect(filters).toHaveLength(0)   // 压根没查库
  })

  it('未迁移 0056（42703）→ 空数组而不是 500：绝不因这条锦上添花的功能挡住首页', async () => {
    queryResult = { data: null, error: { code: '42703', message: 'column feedback.reply does not exist' } }
    const res = await GET(makeReq('GET'))
    expect(res.status).toBe(200)
    expect((await res.json() as { items: unknown[] }).items).toEqual([])
  })

  it('查询异常（非未迁移）同样吞成空数组', async () => {
    queryResult = { data: null, error: { code: '08006', message: 'connection failure' } }
    const res = await GET(makeReq('GET'))
    expect(res.status).toBe(200)
    expect((await res.json() as { items: unknown[] }).items).toEqual([])
  })
})

describe('POST · 标记已通知', () => {
  it('🔴 跨用户隔离：update 的 where 必须同时限 id 与调用者 user_id', async () => {
    queryResult = { data: [{ id: FB_ID }], error: null }
    await POST(makeReq('POST', { ids: [FB_ID] }))
    expect(filters).toContainEqual(['in:id', [FB_ID]])
    expect(filters).toContainEqual(['eq:user_id', ME])
  })

  it('notified_at 由服务端取当前时间，不接受客户端传值（否则可写未来时间永久免打扰）', async () => {
    queryResult = { data: [{ id: FB_ID }], error: null }
    await POST(makeReq('POST', { ids: [FB_ID], notified_at: '2099-01-01T00:00:00Z' }))
    const written = updatePayload?.notified_at as string
    expect(written).not.toContain('2099')
    expect(Number.isNaN(Date.parse(written))).toBe(false)
    expect(Object.keys(updatePayload ?? {})).toEqual(['notified_at'])   // 只写这一列
  })

  it('ids 非法（空数组 / 非 uuid / 超量）→ 400', async () => {
    expect((await POST(makeReq('POST', { ids: [] }))).status).toBe(400)
    expect((await POST(makeReq('POST', { ids: ['not-a-uuid'] }))).status).toBe(400)
    expect((await POST(makeReq('POST', { ids: Array(9).fill(FB_ID) }))).status).toBe(400)
  })

  it('body 不是合法 JSON → 400，不 500', async () => {
    const req = new Request('http://localhost/api/feedback-notified', {
      method: 'POST', headers: { authorization: 'Bearer t' }, body: '{bad',
    })
    expect((await POST(req)).status).toBe(400)
  })

  it('匿名：直接 ok/0，不写库', async () => {
    mockRequireUser.mockResolvedValue({ userId: ME, isAnonymous: true })
    const res = await POST(makeReq('POST', { ids: [FB_ID] }))
    expect((await res.json() as { count: number }).count).toBe(0)
    expect(updatePayload).toBeNull()
  })

  it('未登录 → 401', async () => {
    mockRequireUser.mockRejectedValue(Object.assign(new Error('未登录'), { status: 401 }))
    expect((await POST(makeReq('POST', { ids: [FB_ID] }))).status).toBe(401)
  })
})
