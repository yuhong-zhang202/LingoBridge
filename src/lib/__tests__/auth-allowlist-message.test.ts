/**
 * @module   auth-allowlist-message.test
 * @desc     内测白名单「被拒文案映射」单测【临时措施·随白名单一起删除】。
 *           isAllowlistDenied 刻意不导出（内测结束好整段删），故经公开入口
 *           registerWithPassword / loginWithPassword 驱动。
 *           核心不变式：判定依据是 status 500 + code 'unexpected_failure'
 *           （原「错误消息含关键词 BETA_ALLOWLIST_DENIED」方案已被生产实测证伪，
 *           GoTrue 吞掉 DB 异常原文，见 src/lib/auth.ts 段落注释）。
 *           全依赖 mock，不碰真实 Supabase。
 * @author   LingoBridge
 * @created  2026-07-19
 */

/** 当前用例期望 updateUser / signInWithPassword 返回的 error（null 表示成功）。 */
const mockAuthErrorHolder: { current: unknown } = { current: null }

jest.mock('@/lib/supabase', () => ({
  ensureSession: () => Promise.resolve(),
  getSupabase: () => ({
    auth: {
      updateUser: () => Promise.resolve({ error: mockAuthErrorHolder.current }),
      signInWithPassword: () => Promise.resolve({ error: mockAuthErrorHolder.current }),
      // registerWithPassword 在 updateUser 之前会读一次 session（取 auth.registered 埋点的
      // fromAnonymous，升级后就读不到了）。这里给匿名会话，让被测路径与线上一致。
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1', is_anonymous: true, user_metadata: {} } } } }),
    },
  }),
}))
jest.mock('@/lib/consent', () => ({ clearConsentCache: () => {} }))

import { registerWithPassword, loginWithPassword } from '@/lib/auth'

/** 造一个形似 GoTrue AuthApiError 的错误对象。 */
function authError(status: number, code: string, message: string): Record<string, unknown> {
  return { name: 'AuthApiError', message, status, code, __isAuthError: true }
}

/** 白名单触发器拒绝时 GoTrue 实际回给前端的错误（qa-engineer 生产实测原样抄录）。 */
function deniedError(message: string): Record<string, unknown> {
  return authError(500, 'unexpected_failure', message)
}

beforeEach(() => {
  mockAuthErrorHolder.current = null
})

describe('白名单被拒文案映射 · registerWithPassword', () => {
  test('1. 生产实测错误（500 / unexpected_failure）→ NOT_ALLOWLISTED + 兼容措辞文案', async () => {
    mockAuthErrorHolder.current = deniedError('Database error saving new user')

    await expect(registerWithPassword('a@x.com', 'pw1234')).rejects.toMatchObject({
      code: 'NOT_ALLOWLISTED',
      message:
        '注册失败。如果你不在内测名单内，请联系我们获取邀请；如果你确认已受邀，请稍后重试。',
    })
  })

  test('2. 原始关键词不再是判定依据：带关键词但 status 400 → 不映射为白名单', async () => {
    mockAuthErrorHolder.current = authError(400, 'bad_request', 'BETA_ALLOWLIST_DENIED: nope')

    await expect(registerWithPassword('a@x.com', 'pw1234')).rejects.toMatchObject({
      code: 'REGISTER_FAILED',
    })
  })

  test('3. 邮箱已注册（422）→ 仍走 EMAIL_EXISTS，未被白名单分支抢走', async () => {
    mockAuthErrorHolder.current = authError(422, 'email_exists', 'Email address already registered')

    await expect(registerWithPassword('a@x.com', 'pw1234')).rejects.toMatchObject({
      code: 'EMAIL_EXISTS',
    })
  })

  test('4. 500 但 code 不是 unexpected_failure → 不映射（兜底 REGISTER_FAILED）', async () => {
    mockAuthErrorHolder.current = authError(500, 'internal_error', 'boom')

    await expect(registerWithPassword('a@x.com', 'pw1234')).rejects.toMatchObject({
      code: 'REGISTER_FAILED',
    })
  })

  test('5. 无错误 → 正常返回', async () => {
    await expect(registerWithPassword('a@x.com', 'pw1234')).resolves.toBeUndefined()
  })
})

describe('白名单被拒文案映射 · loginWithPassword', () => {
  test('6. 500 / unexpected_failure → NOT_ALLOWLISTED + 登录版兼容措辞文案', async () => {
    mockAuthErrorHolder.current = deniedError('Database error querying schema')

    await expect(loginWithPassword('a@x.com', 'pw1234')).rejects.toMatchObject({
      code: 'NOT_ALLOWLISTED',
      message:
        '登录失败。如果你不在内测名单内，请联系我们获取邀请；如果你确认已受邀，请稍后重试。',
    })
  })

  test('7. 凭据错误（400 invalid_credentials）→ 仍回「邮箱或密码错误」，未被误伤', async () => {
    mockAuthErrorHolder.current = authError(400, 'invalid_credentials', 'Invalid login credentials')

    await expect(loginWithPassword('a@x.com', 'pw1234')).rejects.toMatchObject({
      code: 'LOGIN_FAILED',
      message: '邮箱或密码错误',
    })
  })
})
