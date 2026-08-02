/**
 * @module   supabase-ensure-session.test
 * @desc     ensureSession 单飞防重入单测 —— 守卫「匿名账号被并发重复创建」这条 bug 的命根：
 *           首屏多模块并发调用时，signInAnonymously 只许被调用一次（生产实测虚增 1.39 倍账号，
 *           同簇账号 created_at 相差 0.00~0.05 秒）。另覆盖单飞两个必守点：成功后清缓存（后续走
 *           getSession 快速路径）、失败也清缓存（否则一次网络抖动会让 ensureSession 永久失败）。
 *           supabase 客户端全 mock，不连真库。
 * @author   LingoBridge
 * @created  2026-08-02
 */
const mockGetSession = jest.fn()
const mockSignInAnonymously = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getSession: mockGetSession, signInAnonymously: mockSignInAnonymously } }),
}))

type EnsureSession = () => Promise<string>

/** 取一份全新的 supabase 模块（重置模块级单飞槽位与客户端单例），避免用例间串味。 */
async function freshEnsureSession(): Promise<EnsureSession> {
  jest.resetModules()
  const mod = (await import('@/lib/supabase')) as { ensureSession: EnsureSession }
  return mod.ensureSession
}

/** 让出一个宏任务，制造 getSession 的异步窗口（并发调用正是挤在这个窗口里各自建号的）。 */
function tick<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0))
}

const NO_SESSION = { data: { session: null } }
const HAS_SESSION = { data: { session: { user: { id: 'u-existing' } } } }

beforeEach(() => {
  jest.clearAllMocks()
})

describe('ensureSession · 单飞防重入', () => {
  test('并发 10 次调用（无 session）→ signInAnonymously 只被调用一次，且都拿到同一个 uid', async () => {
    mockGetSession.mockImplementation(() => tick(NO_SESSION))
    mockSignInAnonymously.mockImplementation(() => tick({ data: { user: { id: 'u-anon' } }, error: null }))
    const ensureSession = await freshEnsureSession()

    const ids = await Promise.all(Array.from({ length: 10 }, () => ensureSession()))

    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1)
    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(ids).toEqual(Array.from({ length: 10 }, () => 'u-anon'))
  })

  test('成功后清缓存：后续调用重新走 getSession 快速路径，不再建号', async () => {
    mockGetSession.mockImplementation(() => tick(NO_SESSION))
    mockSignInAnonymously.mockImplementation(() => tick({ data: { user: { id: 'u-anon' } }, error: null }))
    const ensureSession = await freshEnsureSession()

    await ensureSession()
    // 登录成功后 supabase 端已有 session，模拟之
    mockGetSession.mockImplementation(() => tick(HAS_SESSION))

    expect(await ensureSession()).toBe('u-existing')
    expect(mockGetSession).toHaveBeenCalledTimes(2)   // 缓存已清，第二次确实重新查了
    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1)
  })

  test('失败也清缓存：抖动失败后下一次调用能重试成功（不会永久失败）', async () => {
    mockGetSession.mockImplementation(() => tick(NO_SESSION))
    mockSignInAnonymously.mockImplementationOnce(() => tick({ data: { user: null }, error: { message: '网络抖动' } }))
    mockSignInAnonymously.mockImplementation(() => tick({ data: { user: { id: 'u-retry' } }, error: null }))
    const ensureSession = await freshEnsureSession()

    await expect(ensureSession()).rejects.toThrow('匿名登录失败：网络抖动')
    expect(await ensureSession()).toBe('u-retry')
    expect(mockSignInAnonymously).toHaveBeenCalledTimes(2)
  })

  test('并发调用同时失败：共享同一个拒绝，只发一次登录请求', async () => {
    mockGetSession.mockImplementation(() => tick(NO_SESSION))
    mockSignInAnonymously.mockImplementation(() => tick({ data: { user: null }, error: { message: '网络抖动' } }))
    const ensureSession = await freshEnsureSession()

    const results = await Promise.allSettled([ensureSession(), ensureSession(), ensureSession()])

    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1)
  })

  test('已有 session：直接返回其 uid，完全不建号', async () => {
    mockGetSession.mockImplementation(() => tick(HAS_SESSION))
    const ensureSession = await freshEnsureSession()

    expect(await ensureSession()).toBe('u-existing')
    expect(mockSignInAnonymously).not.toHaveBeenCalled()
  })

  test('登录返回空用户 → 抛「匿名登录未返回用户」', async () => {
    mockGetSession.mockImplementation(() => tick(NO_SESSION))
    mockSignInAnonymously.mockImplementation(() => tick({ data: { user: null }, error: null }))
    const ensureSession = await freshEnsureSession()

    await expect(ensureSession()).rejects.toThrow('匿名登录未返回用户')
  })
})
