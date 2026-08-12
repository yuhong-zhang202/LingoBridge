/**
 * @module   api/account/delete.test
 * @desc     删号路由的合规不变式单测（全部 mock，不连真实库/鉴权）：
 *           ① 原文孤儿防线：raw_logs 删除失败 → 整体 500 且【不调 admin.deleteUser】；
 *           ② 同意审计顺序：consent_audit 必须【先写、后删 consent_records】，写失败即中止删号；
 *           ③ 费用日志去标识化失败【不再被静默吞掉】——失败即中止，绝不留指向已注销自然人的 uuid；
 *           ④ beta_allowlist 按邮箱删残留行，且邮箱须在 admin.deleteUser【之前】取得；
 *           ⑤ 头像清理分页取满，不漏掉第 100 条之后的公开人脸照片；
 *           ⑥ review_events 必须在删除清单里——它曾漏出删号链路，注销用户 uuid 永久留库。
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
jest.mock('@/lib/consent-audit', () => ({ writeConsentAuditTrace: jest.fn() }))

/** 按发生先后记录关键操作，供顺序断言 */
let ops: string[] = []
/** 头像桶的假对象列表（用于分页断言） */
let avatarObjects: { name: string }[] = []
/** 各表操作要返回的错误（键为 `${动作}:${表名}`），未命中即成功 */
let tableErrors: Record<string, { message: string }> = {}
/** 记录 list 收到的分页参数 */
let listCalls: { limit?: number; offset?: number }[] = []

const deleteUserMock = jest.fn(async () => ({ error: null }))
type GetUserResult = { data: { user: { email: string | null } | null }; error: null }
const getUserByIdMock = jest.fn(
  async (): Promise<GetUserResult> => ({ data: { user: { email: 'Beta_User@X.com' } }, error: null }),
)
const allowlistIlikeMock = jest.fn()

function result(key: string): { error: { message: string } | null } {
  ops.push(key)
  return { error: tableErrors[key] ?? null }
}

function makeAdmin() {
  return {
    from: (table: string) => ({
      // revoked_users 吊销名单写入（route 步骤 1.2）：失败仅 logErr、不阻断删号，故默认成功。
      // 记 `upsert:${table}` 到 tableErrors 可模拟失败分支（当前无用例需要，预留）。
      upsert: async () => ({ error: tableErrors[`upsert:${table}`] ?? null }),
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
      delete: () => ({
        eq: async () => result(`delete:${table}`),
        in: async () => result(`delete:${table}`),
        ilike: async (_col: string, value: string) => {
          allowlistIlikeMock(value)
          return result(`delete:${table}`)
        },
      }),
      update: () => ({ eq: async () => result(`update:${table}`) }),
    }),
    storage: {
      from: () => ({
        list: async (_path: string, opts?: { limit?: number; offset?: number }) => {
          listCalls.push({ limit: opts?.limit, offset: opts?.offset })
          const offset = opts?.offset ?? 0
          const limit = opts?.limit ?? 100
          return { data: avatarObjects.slice(offset, offset + limit), error: null }
        },
        remove: async (paths: string[]) => {
          ops.push(`removeAvatars:${paths.length}`)
          return { error: null }
        },
      }),
    },
    auth: { admin: { deleteUser: deleteUserMock, getUserById: getUserByIdMock } },
  }
}
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: () => makeAdmin() }))

import { POST } from '@/app/api/account/delete/route'
import { requireUser } from '@/lib/api-auth'
import { deleteUserRawLogs } from '@/lib/raw-log'
import { writeConsentAuditTrace } from '@/lib/consent-audit'

const mockRequireUser = requireUser as jest.MockedFunction<typeof requireUser>
const mockDeleteRawLogs = deleteUserRawLogs as jest.MockedFunction<typeof deleteUserRawLogs>
const mockWriteAudit = writeConsentAuditTrace as jest.MockedFunction<typeof writeConsentAuditTrace>

function makeReq(): Request {
  return new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers: { authorization: 'Bearer t' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ops = []
  avatarObjects = []
  tableErrors = {}
  listCalls = []
  mockRequireUser.mockResolvedValue({ userId: 'u1' })
  mockDeleteRawLogs.mockResolvedValue(undefined)
  mockWriteAudit.mockResolvedValue(undefined)
  getUserByIdMock.mockResolvedValue({ data: { user: { email: 'Beta_User@X.com' } }, error: null })
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
    const res = await POST(makeReq())
    const body = (await res.json()) as { ok?: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(deleteUserMock).toHaveBeenCalledWith('u1')
  })
})

describe('删号 · 同意审计痕迹（migration 0025）', () => {
  test('先写审计痕迹、后删 consent_records（顺序反了会既没证据也没记录）', async () => {
    let auditWrittenAt = -1
    mockWriteAudit.mockImplementation(async () => {
      auditWrittenAt = ops.length
    })

    await POST(makeReq())

    const consentDeletedAt = ops.indexOf('delete:consent_records')
    expect(consentDeletedAt).toBeGreaterThanOrEqual(0)
    expect(auditWrittenAt).toBeGreaterThanOrEqual(0)
    expect(auditWrittenAt).toBeLessThan(consentDeletedAt)
  })

  test('审计写入用的邮箱取自 auth，且取邮箱在 admin.deleteUser 之前', async () => {
    await POST(makeReq())
    expect(mockWriteAudit).toHaveBeenCalledWith('u1', 'Beta_User@X.com')
    expect(getUserByIdMock.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteUserMock.mock.invocationCallOrder[0]!,
    )
  })

  test('审计写入失败（含 salt 未配置）→ 500，且不删 consent_records、不删账号', async () => {
    mockWriteAudit.mockRejectedValue(new Error('CONSENT_HASH_SALT_MISSING: 未配置'))

    const res = await POST(makeReq())

    expect(res.status).toBe(500)
    expect(ops).not.toContain('delete:consent_records')
    expect(deleteUserMock).not.toHaveBeenCalled()
  })
})

describe('删号 · 费用日志去标识化（不再静默吞异常）', () => {
  test('去标识化失败 → 500 且不删账号（绝不留指向已注销自然人的 uuid）', async () => {
    tableErrors['update:api_usage_logs'] = { message: 'boom' }

    const res = await POST(makeReq())

    expect(res.status).toBe(500)
    expect(deleteUserMock).not.toHaveBeenCalled()
  })

  test('成功路径下确实执行了去标识化，且排在 admin.deleteUser 之前', async () => {
    await POST(makeReq())
    expect(ops).toContain('update:api_usage_logs')
  })
})

describe('删号 · beta_allowlist 邮箱残留', () => {
  test('按规范化后的邮箱删白名单行（大小写无关，且转义 `_` 避免误伤他人）', async () => {
    await POST(makeReq())
    expect(ops).toContain('delete:beta_allowlist')
    // Beta_User@X.com → 小写化 + 下划线转义
    expect(allowlistIlikeMock).toHaveBeenCalledWith('beta\\_user@x.com')
  })

  test('删白名单失败 → 500 且不删账号（邮箱是直接标识符，不接受静默失败）', async () => {
    tableErrors['delete:beta_allowlist'] = { message: 'boom' }

    const res = await POST(makeReq())

    expect(res.status).toBe(500)
    expect(deleteUserMock).not.toHaveBeenCalled()
  })

  test('匿名账号（无邮箱）→ 跳过白名单删除，删号照常完成', async () => {
    getUserByIdMock.mockResolvedValue({ data: { user: { email: null } }, error: null })

    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(ops).not.toContain('delete:beta_allowlist')
  })
})

describe('删号 · review_events 埋点残留（审计 P1-5）', () => {
  test('删除清单里必须有 review_events（漏了=注销用户 uuid 永久留库，再无机制会清）', async () => {
    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(ops).toContain('delete:review_events')
  })

  test('删 review_events 失败 → 500 且不删账号（不吞异常，同费用日志纪律）', async () => {
    tableErrors['delete:review_events'] = { message: 'boom' }

    const res = await POST(makeReq())

    expect(res.status).toBe(500)
    expect(deleteUserMock).not.toHaveBeenCalled()
  })
})

describe('删号 · 头像清理分页', () => {
  test('超过 100 个头像时分页取满，一个不漏（公开读桶里的人脸照片）', async () => {
    avatarObjects = Array.from({ length: 250 }, (_, i) => ({ name: `${i}.jpg` }))

    await POST(makeReq())

    expect(ops).toContain('removeAvatars:250')
    // 250 条 = 3 满页 + 1 空页（100/100/50 后即停，最后一页不足即停）
    expect(listCalls.map((c) => c.offset)).toEqual([0, 100, 200])
    expect(listCalls.every((c) => c.limit === 100)).toBe(true)
  })

  test('恰好整页边界（200 个）也要多取一页确认取空，不漏第 201 条的可能', async () => {
    avatarObjects = Array.from({ length: 200 }, (_, i) => ({ name: `${i}.jpg` }))

    await POST(makeReq())

    expect(ops).toContain('removeAvatars:200')
    expect(listCalls.map((c) => c.offset)).toEqual([0, 100, 200])
  })
})
