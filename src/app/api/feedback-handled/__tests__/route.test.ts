/**
 * @module   api/feedback-handled/route.test
 * @desc     「已处理」标记端点守卫：401/403 鉴权分支、405 方法不对、400 参数不合法、
 *           200 标记（handled_at=now 串）/ 200 撤销（handled_at=null）、
 *           409 待迁移（42703·handled_at → code=HANDLED_NOT_MIGRATED，绝不含混 500）、404 反馈不存在。
 *           全 mock，不碰真实 DB / 鉴权。
 * @author   LingoBridge
 * @created  2026-08-03
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn(),
  // 轻量仿制真实实现：鉴权错误（带 status 401/403）映射为同状态响应，其余 null 走 500 分支
  authErrorResponse: jest.fn((e: unknown) => {
    const status = (e as { status?: number } | null)?.status
    if (status === 401 || status === 403) {
      return { status, json: () => Promise.resolve({ error: (e as { message?: string }).message }) } as unknown
    }
    return null
  }),
}))

import { POST, GET } from '@/app/api/feedback-handled/route'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseServer } from '@/lib/supabase-server'

const mockRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>
const mockGetSupabase = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

const FB_ID = '11111111-2222-4333-8444-555555555555'

/** update() 收到的写入载荷（断言 handled_at 到底写了什么） */
let updatePayload: Record<string, unknown> | null
/** update…select 链的预置结果 */
let updateResult: { data: unknown[] | null; error: unknown }

/** 造 POST 请求 */
function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/feedback-handled', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireAdmin.mockResolvedValue({ userId: 'admin1', email: 'admin@x.co' })
  updatePayload = null
  updateResult = { data: [{ id: FB_ID }], error: null }
  mockGetSupabase.mockReturnValue({
    from: (table: string) => {
      if (table !== 'feedback') throw new Error(`unexpected table ${table}`)
      return {
        update: (v: Record<string, unknown>) => {
          updatePayload = v
          return { eq: () => ({ select: () => Promise.resolve(updateResult) }) }
        },
      }
    },
  } as never)
})

it('非管理员 → 403，且不发生任何写入', async () => {
  mockRequireAdmin.mockRejectedValue({ status: 403, code: 'FORBIDDEN', message: '需要管理员权限' })
  const res = await POST(makeReq({ id: FB_ID, handled: true }))
  expect(res.status).toBe(403)
  expect(updatePayload).toBeNull()
})

it('无效 token → 401', async () => {
  mockRequireAdmin.mockRejectedValue({ status: 401, code: 'UNAUTHORIZED', message: '未授权' })
  const res = await POST(makeReq({ id: FB_ID, handled: true }))
  expect(res.status).toBe(401)
})

it('方法不对（GET）→ 405', () => {
  const res = GET()
  expect(res.status).toBe(405)
})

it('参数不合法（缺 handled / id 非 uuid / body 非 JSON）→ 400', async () => {
  expect((await POST(makeReq({ id: FB_ID }))).status).toBe(400)
  expect((await POST(makeReq({ id: 'not-a-uuid', handled: true }))).status).toBe(400)
  const badJson = new Request('http://localhost/api/feedback-handled', {
    method: 'POST', headers: { authorization: 'Bearer t' }, body: '{{{',
  })
  expect((await POST(badJson)).status).toBe(400)
})

it('标记已处理：handled=true 写 handled_at=now（ISO 串）→ 200', async () => {
  const res = await POST(makeReq({ id: FB_ID, handled: true }))
  expect(res.status).toBe(200)
  expect(typeof updatePayload?.handled_at).toBe('string')
  expect(Number.isNaN(Date.parse(updatePayload?.handled_at as string))).toBe(false)
  const body = (await res.json()) as { ok: boolean; handled: boolean }
  expect(body.ok).toBe(true)
  expect(body.handled).toBe(true)
})

// 撤销必须把 reply 与 notified_at 一并清空：否则会留下「未处理但带着旧回复」的半状态，
// 下次再勾就把过期的回复推送给用户（闭环弹窗读的正是 reply + notified_at is null 这个组合）。
it('撤销：handled=false 同时清空 handled_at/reply/notified_at → 200', async () => {
  const res = await POST(makeReq({ id: FB_ID, handled: false }))
  expect(res.status).toBe(200)
  expect(updatePayload).toEqual({ handled_at: null, reply: null, notified_at: null })
  const body = (await res.json()) as { ok: boolean; handled: boolean }
  expect(body.handled).toBe(false)
})

it('标记已处理时带 reply：写进 reply 列（成为闭环弹窗正文）', async () => {
  const res = await POST(makeReq({ id: FB_ID, handled: true, reply: '  已经把上传体积降到三分之一  ' }))
  expect(res.status).toBe(200)
  expect(updatePayload?.reply).toBe('已经把上传体积降到三分之一')   // 首尾空白被裁掉
})

it('reply 为纯空白：当作没写，不写 reply 列（避免推一条空弹窗给用户）', async () => {
  const res = await POST(makeReq({ id: FB_ID, handled: true, reply: '   ' }))
  expect(res.status).toBe(200)
  expect(updatePayload).not.toHaveProperty('reply')
})

it('reply 超长：截到 500 字而不是报错（管理员正在收尾，不该被打断）', async () => {
  const res = await POST(makeReq({ id: FB_ID, handled: true, reply: 'x'.repeat(600) }))
  expect(res.status).toBe(200)
  expect((updatePayload?.reply as string).length).toBe(500)
})

it('reply 类型不对（数字）→ 400，不静默吞掉', async () => {
  const res = await POST(makeReq({ id: FB_ID, handled: true, reply: 123 }))
  expect(res.status).toBe(400)
})

it('迁移 0055 未跑（42703·handled_at）→ 409 + code=HANDLED_NOT_MIGRATED，不是 500', async () => {
  updateResult = { data: null, error: { code: '42703', message: 'column "handled_at" of relation "feedback" does not exist' } }
  const res = await POST(makeReq({ id: FB_ID, handled: true }))
  expect(res.status).toBe(409)
  const body = (await res.json()) as { code: string }
  expect(body.code).toBe('HANDLED_NOT_MIGRATED')
})

it('id 不存在（update 无命中行）→ 404', async () => {
  updateResult = { data: [], error: null }
  const res = await POST(makeReq({ id: FB_ID, handled: true }))
  expect(res.status).toBe(404)
})

it('其余 DB 错误 → 500', async () => {
  updateResult = { data: null, error: { code: 'XX000', message: 'boom' } }
  const res = await POST(makeReq({ id: FB_ID, handled: true }))
  expect(res.status).toBe(500)
})
