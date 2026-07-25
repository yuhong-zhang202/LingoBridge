/**
 * @module   api-auth-identity.test
 * @desc     身份权威化红线 —— authUser 判「匿名/注册分额度」时不信可能陈旧的 JWT is_anonymous claim，
 *           改查权威实时源(auth.admin.getUserById)。锁死本次修复的核心不变式：
 *             ① 陈旧 token（is_anonymous:true）+ 权威源(is_anonymous:false) → requireUserAllowAnon 报 false（不误走匿名闸）
 *             ② 权威源同步 email：陈旧 token email=null + 权威源有 email → 走白名单校验（不因 null 漏判）
 *             ③ getUserById 失败 → fail-back 到 token claim（= 改动前行为，不放大权限，不让全站不可用）
 *             ④ 30 秒进程内缓存：同 userId 多次请求只查一次 getUserById
 *           鉴权链已迁本地验签，故 mock 掉 @/lib/jwt-verify（隔离纯 ESM 包 jose + 吐可控 payload）。
 *           每用例 resetModules 清进程内缓存，杜绝串味。全 mock，不碰真实 DB。
 * @author   LingoBridge
 * @created  2026-07-25
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/env-server', () => ({ env: { adminEmails: '' } }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

/** 持有当前 supabase mock，供 resetModules 后新加载的模块实例读到同一份。 */
const mockSupabaseHolder: { current: unknown } = { current: null }
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: () => mockSupabaseHolder.current }))

/** 持有当前用例的验签 payload（verifyAccessToken 返回值）。 */
const mockPayloadHolder: { current: { sub: string; email: string | null; is_anonymous: boolean; exp: number } } = {
  current: { sub: 'u0', email: null, is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 3600 },
}
jest.mock('@/lib/jwt-verify', () => ({ verifyAccessToken: () => Promise.resolve(mockPayloadHolder.current) }))

import type { requireUserAllowAnon as RequireAnon } from '@/lib/api-auth'

function req(): Request {
  return new Request('https://example.test/api/x', { headers: { authorization: 'Bearer tok' } })
}

/**
 * 装配 mock：token 载荷（可陈旧）与权威源 getUserById 返回值分别指定，以便造「token 与权威不一致」场景。
 * @param token      验签吐出的 payload（模拟旧 token 快照）
 * @param authoritative  getUserById 返回的权威用户；传 'error' 表示查库失败
 * @returns          getUserById 的 jest.fn（供断言调用次数）
 */
function setup(
  token: { sub: string; email: string | null; is_anonymous: boolean },
  authoritative: { email: string | null; is_anonymous: boolean } | 'error',
): jest.Mock {
  mockPayloadHolder.current = { ...token, exp: Math.floor(Date.now() / 1000) + 3600 }
  const getUserById = jest.fn((id: string) =>
    authoritative === 'error'
      ? Promise.resolve({ data: { user: null }, error: { message: 'gotrue down' } })
      : Promise.resolve({ data: { user: { id, email: authoritative.email, is_anonymous: authoritative.is_anonymous } }, error: null }),
  )
  mockSupabaseHolder.current = {
    auth: { admin: { getUserById } },
    // 白名单未启用（空表）→ 放行；吊销名单空 → 不吊销。本套件只测身份取值来源。
    from: (table: string) =>
      table === 'revoked_users'
        ? { select: () => Promise.resolve({ data: [], error: null }) }
        : { select: () => Promise.resolve({ data: [], error: null }) },
  }
  return getUserById
}

async function loadRequireAnon(): Promise<typeof RequireAnon> {
  const mod: typeof import('@/lib/api-auth') = await import('@/lib/api-auth')
  return mod.requireUserAllowAnon
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
})

describe('身份权威化 · authUser 取 is_anonymous / email 于权威源', () => {
  test('① 陈旧 token(is_anonymous:true) + 权威源(false) → isAnonymous=false（不误走匿名闸）', async () => {
    setup({ sub: 'u1', email: null, is_anonymous: true }, { email: 'a@x.com', is_anonymous: false })
    const requireUserAllowAnon = await loadRequireAnon()

    await expect(requireUserAllowAnon(req())).resolves.toEqual({ userId: 'u1', isAnonymous: false })
  })

  test('② 权威源仍为匿名 → isAnonymous=true（升级前正常匿名不受影响）', async () => {
    setup({ sub: 'u2', email: null, is_anonymous: true }, { email: null, is_anonymous: true })
    const requireUserAllowAnon = await loadRequireAnon()

    await expect(requireUserAllowAnon(req())).resolves.toEqual({ userId: 'u2', isAnonymous: true })
  })

  test('③ getUserById 失败 → fail-back 到 token claim（= 改动前行为）', async () => {
    setup({ sub: 'u3', email: null, is_anonymous: true }, 'error')
    const requireUserAllowAnon = await loadRequireAnon()

    await expect(requireUserAllowAnon(req())).resolves.toEqual({ userId: 'u3', isAnonymous: true })
  })

  test('④ 30 秒缓存：同 userId 两次请求只查一次 getUserById', async () => {
    const getUserById = setup({ sub: 'u4', email: null, is_anonymous: true }, { email: 'a@x.com', is_anonymous: false })
    const requireUserAllowAnon = await loadRequireAnon()

    await requireUserAllowAnon(req())
    await requireUserAllowAnon(req())
    expect(getUserById).toHaveBeenCalledTimes(1)
  })
})
