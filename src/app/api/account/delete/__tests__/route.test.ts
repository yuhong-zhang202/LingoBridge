/**
 * @module   api/account/delete.test
 * @desc     删号路由「原文孤儿防线」单测 —— 证明被遗忘权的核心不变式：
 *           原始留证（llm/asr_raw_logs 用户原文）删除失败时，【整体删号必须失败、绝不删掉账号】，
 *           否则会留下无主原文孤儿。校验：
 *           ① deleteUserRawLogs 抛错 → 响应 500，且【不调 admin.deleteUser】（账号保留、用户可重试）；
 *           ② 原文删除成功 → 正常走到 admin.deleteUser、返回 200。
 *           全部 mock，不连真实库/鉴权。
 * @author   LingoBridge
 * @created  2026-07-18
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/api-auth', () => ({
  requireUser: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/raw-log', () => ({ deleteUserRawLogs: jest.fn() }))

// 假 admin client：所有业务表删除/查询/头像清理/费用去标识一律成功；只把 auth.admin.deleteUser 单独抽出可断言。
const deleteUserMock = jest.fn(async () => ({ error: null }))
function makeAdmin() {
  return {
    from: () => ({
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
      delete: () => ({
        eq: async () => ({ error: null }),
        in: async () => ({ error: null }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    auth: { admin: { deleteUser: deleteUserMock } },
  }
}
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: () => makeAdmin() }))

import { POST } from '@/app/api/account/delete/route'
import { requireUser } from '@/lib/api-auth'
import { deleteUserRawLogs } from '@/lib/raw-log'

const mockRequireUser = requireUser as jest.MockedFunction<typeof requireUser>
const mockDeleteRawLogs = deleteUserRawLogs as jest.MockedFunction<typeof deleteUserRawLogs>

function makeReq(): Request {
  return new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers: { authorization: 'Bearer t' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireUser.mockResolvedValue({ userId: 'u1' })
})

describe('删号 · 原文孤儿防线', () => {
  test('原文（raw_logs）删除抛错 → 整体删号失败(500)，且不调 admin.deleteUser（不留孤儿）', async () => {
    mockDeleteRawLogs.mockRejectedValue(new Error('raw log delete boom'))

    const res = await POST(makeReq())
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBe(500)
    expect(typeof body.error).toBe('string')
    // 关键断言：账号未被删除 —— 原文删不掉就绝不能把号删掉
    expect(deleteUserMock).not.toHaveBeenCalled()
  })

  test('原文删除成功 → 走到 admin.deleteUser、返回 200', async () => {
    mockDeleteRawLogs.mockResolvedValue(undefined)

    const res = await POST(makeReq())
    const body = (await res.json()) as { ok?: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(deleteUserMock).toHaveBeenCalledWith('u1')
  })
})
