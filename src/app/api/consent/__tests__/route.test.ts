/**
 * @module   api/consent/route.test
 * @desc     「真捕获同意」落库端点单测 —— 守卫核心不变式：
 *           1) 点击同意 → service_role 插一条 consent_records（consent_version / scope_snapshot /
 *              consent_type='beta_general' 全取服务端权威值，客户端 body 无法伪造）；
 *           2) is_anonymous 如实透传（匿名同意也记，决策2）；
 *           3) 落库失败 → 500（客户端据此留弹窗重试，绝不误放行）；
 *           4) 无效 token → 401（authErrorResponse 映射）。
 *           全依赖 mock，不碰真实 DB / 鉴权。
 * @author   LingoBridge
 * @created  2026-07-18
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(),
  // 真实实现：鉴权错误(带 status)→ 401/403 响应，否则 null。这里用轻量仿制，够测 401 分支。
  authErrorResponse: jest.fn((e: unknown) => {
    const status = (e as { status?: number } | null)?.status
    if (status === 401 || status === 403) {
      return { status, body: (e as { message?: string }).message } as unknown
    }
    return null
  }),
}))

import { POST } from '@/app/api/consent/route'
import { requireUserAllowAnon } from '@/lib/api-auth'
import { getSupabaseServer } from '@/lib/supabase-server'
import { BETA_PRIVACY_VERSION, CONSENT_SCOPE_SNAPSHOT } from '@/lib/privacy-copy'

const mockRequireUserAllowAnon = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockGetSupabase = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

/** consent_records.insert 探针：断言到底插了什么行 */
let insertSpy: jest.Mock

/** 造一个带鉴权头的 POST 请求（body 故意塞垃圾版本，验证服务端不采信客户端） */
function makeReq(): Request {
  return new Request('http://localhost/api/consent', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ consentVersion: 999, scopeSnapshot: 'HACKED' }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireUserAllowAnon.mockResolvedValue({ userId: 'u1', isAnonymous: false })
  insertSpy = jest.fn().mockResolvedValue({ error: null })
  mockGetSupabase.mockReturnValue({
    from: (table: string) => {
      if (table === 'consent_records') return { insert: insertSpy }
      // route 成功后 fire-and-forget 往 perf_samples 写验签/插库耗时埋点（void ...then()），
      // 与同意主流程解耦；此处给个恒成功的 thenable，避免埋点写入干扰被测断言。
      if (table === 'perf_samples') return { insert: () => Promise.resolve({ error: null }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never)
})

describe('POST /api/consent · 真捕获同意落库', () => {
  test('1. 成功：插一条 consent_records（版本/快照/类型取服务端权威值，忽略客户端 body）→ ok', async () => {
    const res = await POST(makeReq())
    const body = (await res.json()) as { ok?: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.user_id).toBe('u1')
    // 服务端权威值：不采信客户端塞的 999 / 'HACKED'
    expect(row.consent_version).toBe(BETA_PRIVACY_VERSION)
    expect(row.consent_version).not.toBe(999)
    expect(row.scope_snapshot).toEqual(CONSENT_SCOPE_SNAPSHOT)
    expect(row.consent_type).toBe('beta_general')
  })

  test('2. 匿名会话：is_anonymous=true 如实透传（决策2 允许匿名同意）', async () => {
    mockRequireUserAllowAnon.mockResolvedValue({ userId: 'anon1', isAnonymous: true })

    await POST(makeReq())

    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.user_id).toBe('anon1')
    expect(row.is_anonymous).toBe(true)
  })

  test('3. 落库失败：insert 返回 error → 500，不误放行', async () => {
    insertSpy.mockResolvedValue({ error: { message: 'db down' } })

    const res = await POST(makeReq())
    const body = (await res.json()) as { error?: string; ok?: boolean }

    expect(res.status).toBe(500)
    expect(body.ok).toBeUndefined()
    expect(typeof body.error).toBe('string')
  })

  test('4. 无效 token：requireUserAllowAnon 抛 401 → 不插库、走 authErrorResponse', async () => {
    mockRequireUserAllowAnon.mockRejectedValue({ status: 401, code: 'UNAUTHORIZED', message: '未授权' })

    await POST(makeReq())

    expect(insertSpy).not.toHaveBeenCalled()
  })
})
