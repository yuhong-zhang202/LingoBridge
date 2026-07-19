/**
 * @module   api-auth-allowlist.test
 * @desc     内测邮箱白名单兜底闸单测【临时措施·随白名单一起删除】。
 *           assertAllowlisted 刻意不导出（内测结束好整段删），故经公开入口 requireUser() 驱动，
 *           覆盖 7 条不变式：① 匿名放行 ② 表空放行 ③ '*' 哨兵放行 ④ 名单内放行
 *           ⑤ 名单外抛 403 ⑥ 查表失败 fail-open 放行 ⑦ 大小写不一致仍匹配（两侧 lower）。
 *           api-auth 内有 60 秒进程内缓存，故每个用例前 resetModules 重新加载，杜绝用例间串味。
 *           全依赖 mock，不碰真实 DB。
 * @author   LingoBridge
 * @created  2026-07-19
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/env-server', () => ({ env: { adminEmails: '' } }))

/** 持有当前 supabase mock，供 resetModules 后新加载的模块实例读到同一份（jest 工厂仅允许引用 mock* 前缀外部变量）。 */
const mockSupabaseHolder: { current: unknown } = { current: null }
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: () => mockSupabaseHolder.current }))

import type { requireUser as RequireUser } from '@/lib/api-auth'

/** 造一个请求头带合法 Bearer token 的 Request。 */
function req(): Request {
  return new Request('https://example.test/api/x', { headers: { authorization: 'Bearer tok' } })
}

/**
 * 装配 supabase mock：getUser 回指定用户，beta_allowlist 查询回指定行/错误。
 * @param user      getUser 返回的用户（email 可为 null 表示匿名）
 * @param allowlist 白名单查询结果；传 'error' 表示查表失败
 */
function setup(
  user: { id: string; email: string | null; is_anonymous: boolean },
  allowlist: Array<{ email: string }> | 'error',
): void {
  mockSupabaseHolder.current = {
    auth: { getUser: () => Promise.resolve({ data: { user }, error: null }) },
    from: (table: string) => {
      if (table !== 'beta_allowlist') throw new Error(`unexpected table ${table}`)
      return {
        select: () =>
          Promise.resolve(
            allowlist === 'error'
              ? { data: null, error: { message: 'relation does not exist' } }
              : { data: allowlist, error: null },
          ),
      }
    },
  }
}

/** resetModules 后重新加载 api-auth（清掉上一用例残留的白名单缓存）。 */
async function loadRequireUser(): Promise<typeof RequireUser> {
  const mod: typeof import('@/lib/api-auth') = await import('@/lib/api-auth')
  return mod.requireUser
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
})

describe('内测白名单兜底闸 · assertAllowlisted（经 requireUser 驱动）', () => {
  test('1. 匿名会话（无邮箱）→ 放行', async () => {
    setup({ id: 'u1', email: null, is_anonymous: true }, [{ email: 'someone@x.com' }])
    const requireUser = await loadRequireUser()

    await expect(requireUser(req())).resolves.toEqual({ userId: 'u1' })
  })

  test('2. 名单表为空 → 视为未启用，放行（防呆兜底）', async () => {
    setup({ id: 'u2', email: 'nobody@x.com', is_anonymous: false }, [])
    const requireUser = await loadRequireUser()

    await expect(requireUser(req())).resolves.toEqual({ userId: 'u2' })
  })

  test("3. 含 '*' 哨兵 → 白名单停用，放行（拆除开关）", async () => {
    setup({ id: 'u3', email: 'nobody@x.com', is_anonymous: false }, [{ email: '*' }, { email: 'a@x.com' }])
    const requireUser = await loadRequireUser()

    await expect(requireUser(req())).resolves.toEqual({ userId: 'u3' })
  })

  test('4. 邮箱在名单内 → 放行', async () => {
    setup({ id: 'u4', email: 'a@x.com', is_anonymous: false }, [{ email: 'a@x.com' }])
    const requireUser = await loadRequireUser()

    await expect(requireUser(req())).resolves.toEqual({ userId: 'u4' })
  })

  test('5. 邮箱不在名单内 → 抛 403 NOT_ALLOWLISTED', async () => {
    setup({ id: 'u5', email: 'evil@x.com', is_anonymous: false }, [{ email: 'a@x.com' }])
    const requireUser = await loadRequireUser()

    await expect(requireUser(req())).rejects.toMatchObject({ status: 403, code: 'NOT_ALLOWLISTED' })
  })

  test('6. 查表失败 → fail-open 放行（兜底层故障不该让全站 403）', async () => {
    setup({ id: 'u6', email: 'evil@x.com', is_anonymous: false }, 'error')
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const requireUser = await loadRequireUser()

    await expect(requireUser(req())).resolves.toEqual({ userId: 'u6' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  test('7. 大小写不一致仍匹配（两侧 lower）→ 放行', async () => {
    setup({ id: 'u7', email: 'A.User@X.COM', is_anonymous: false }, [{ email: 'a.user@x.com' }])
    const requireUser = await loadRequireUser()

    await expect(requireUser(req())).resolves.toEqual({ userId: 'u7' })
  })
})
