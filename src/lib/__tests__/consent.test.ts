/**
 * @module   consent.test
 * @desc     首次同意闸核心逻辑单测 —— 守卫四条不变式：
 *           A) 无记录才弹：缓存/库都无当前版本同意记录 → hasRecordedConsent=false（弹窗）；有则 true（放行）。
 *           B) 成功才放行：recordConsent 仅当 /api/consent 返回 ok 才回 true 并写缓存；失败回 false、不写缓存。
 *           C) 点击才落库：recordConsent 会先 ensureSession 再 POST /api/consent（匿名同意也放行）。
 *           D) 按 uid 隔离：缓存 key 并入当前 session uid —— A uid 写的缓存，B uid 读不到（根治同机换号死循环）。
 *           不碰真实 DB / 网络，全 mock。
 * @author   LingoBridge
 * @created  2026-07-18
 */
jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn(), ensureSession: jest.fn() }))
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }))

import {
  CONSENT_CACHE_PREFIX,
  consentCacheKey,
  readConsentCache,
  writeConsentCache,
  clearConsentCache,
  hasRecordedConsent,
  recordConsent,
} from '@/lib/consent'
import { getSupabase, ensureSession } from '@/lib/supabase'
import { apiFetch } from '@/lib/api-client'
import { BETA_PRIVACY_VERSION } from '@/lib/privacy-copy'

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>
const mockEnsureSession = ensureSession as jest.MockedFunction<typeof ensureSession>
const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>

/** 最小 localStorage 垫片（jest 默认 node 环境无 window/localStorage）；含 length/key 供 clearConsentCache 遍历。 */
function installLocalStorage(): void {
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  }
  ;(globalThis as unknown as { window: unknown }).window = { localStorage: ls }
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = ls
}

/** 构造一个链式 supabase client stub：给定「有无 session」与「库里查到几行」 */
function makeSupabaseStub(opts: { userId: string | null; rows: Array<{ id: string }> }): unknown {
  const limit = jest.fn().mockResolvedValue({ data: opts.rows, error: null })
  return {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: opts.userId ? { user: { id: opts.userId } } : null },
      }),
    },
    from: jest.fn(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ limit }) }) }),
    })),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  installLocalStorage()
})

describe('CONSENT_CACHE_PREFIX / consentCacheKey · 从版本常量派生 + 并入 uid', () => {
  test('前缀含当前 BETA_PRIVACY_VERSION，且换了前缀（不与旧 lb-ai-consent 冲突）', () => {
    expect(CONSENT_CACHE_PREFIX).toBe(`lb-consent-v${BETA_PRIVACY_VERSION}-`)
    expect(CONSENT_CACHE_PREFIX).not.toContain('lb-ai-consent')
  })

  test('缓存 key = 前缀 + uid：不同 uid 得到不同 key', () => {
    expect(consentCacheKey('uA')).toBe(`${CONSENT_CACHE_PREFIX}uA`)
    expect(consentCacheKey('uA')).not.toBe(consentCacheKey('uB'))
  })
})

describe('hasRecordedConsent · A) 无记录才弹', () => {
  test('缓存命中（当前 uid）→ true，且根本不查库', async () => {
    const stub = makeSupabaseStub({ userId: 'u1', rows: [] })
    mockGetSupabase.mockReturnValue(stub as never)
    localStorage.setItem(consentCacheKey('u1'), '1')   // 按当前 session uid 预置缓存

    await expect(hasRecordedConsent()).resolves.toBe(true)
    expect((stub as { from: jest.Mock }).from).not.toHaveBeenCalled()
  })

  test('无缓存 + 无 session → false（全新访客必弹）', async () => {
    mockGetSupabase.mockReturnValue(makeSupabaseStub({ userId: null, rows: [] }) as never)
    await expect(hasRecordedConsent()).resolves.toBe(false)
  })

  test('无缓存 + 有 session 但库里无当前版本记录 → false（弹窗）', async () => {
    mockGetSupabase.mockReturnValue(makeSupabaseStub({ userId: 'u1', rows: [] }) as never)
    await expect(hasRecordedConsent()).resolves.toBe(false)
    expect(readConsentCache('u1')).toBe(false)   // 未签不应写缓存
  })

  test('无缓存 + 有 session 且库里查到记录 → true，并回写该 uid 缓存', async () => {
    mockGetSupabase.mockReturnValue(makeSupabaseStub({ userId: 'u1', rows: [{ id: 'c1' }] }) as never)
    await expect(hasRecordedConsent()).resolves.toBe(true)
    expect(readConsentCache('u1')).toBe(true)    // 查到后回写当前 uid 缓存
  })
})

describe('hasRecordedConsent · D) 按 uid 隔离（根治同机换号死循环）', () => {
  test('A uid 写的缓存，B uid 读不到 → B 必须查库判定（不命中 A 的残留）', async () => {
    // 场景复现：匿名 A 同意后缓存置 '1'；换登老账号 B（B 无同意记录、库里查不到）。
    localStorage.setItem(consentCacheKey('uA'), '1')

    // 当前 session = B，且 B 在库里无当前版本记录（rows: []）。
    const stubB = makeSupabaseStub({ userId: 'uB', rows: [] })
    mockGetSupabase.mockReturnValue(stubB as never)

    // 不变式：B 不得命中 A 的缓存 → 必须落到查库 → 库无记录 → false（该弹窗，而非被误判已签致死循环）。
    await expect(hasRecordedConsent()).resolves.toBe(false)
    expect((stubB as { from: jest.Mock }).from).toHaveBeenCalled()   // 确实查了库，而非读缓存短路
    expect(readConsentCache('uB')).toBe(false)                       // 未签不写 B 的缓存
    expect(readConsentCache('uA')).toBe(true)                        // A 的缓存原样保留、互不干扰
  })

  test('clearConsentCache 清掉本版本前缀下所有 uid 残留（登出无害兜底）', () => {
    localStorage.setItem(consentCacheKey('uA'), '1')
    localStorage.setItem(consentCacheKey('uB'), '1')
    localStorage.setItem('unrelated-key', 'keep')   // 非本前缀，不该被清

    clearConsentCache()

    expect(readConsentCache('uA')).toBe(false)
    expect(readConsentCache('uB')).toBe(false)
    expect(localStorage.getItem('unrelated-key')).toBe('keep')
  })

  test('writeConsentCache 只写指定 uid 的 key（不误写别的 uid）', () => {
    writeConsentCache('uA')
    expect(readConsentCache('uA')).toBe(true)
    expect(readConsentCache('uB')).toBe(false)
  })
})

describe('recordConsent · B) 成功才放行 / C) 点击才落库', () => {
  test('成功（ok）：先 ensureSession 再 POST /api/consent → true，并写缓存', async () => {
    mockEnsureSession.mockResolvedValue('u1')
    mockApiFetch.mockResolvedValue({ ok: true } as Response)

    await expect(recordConsent()).resolves.toBe(true)
    expect(mockEnsureSession).toHaveBeenCalledTimes(1)
    expect(mockApiFetch).toHaveBeenCalledWith('/api/consent', { method: 'POST' })
    expect(readConsentCache('u1')).toBe(true)   // 按 ensureSession 返回的 uid 写缓存
  })

  test('失败（非 ok）：返回 false，且绝不写缓存（不误放行）', async () => {
    mockEnsureSession.mockResolvedValue('u1')
    mockApiFetch.mockResolvedValue({ ok: false, status: 500 } as Response)

    await expect(recordConsent()).resolves.toBe(false)
    expect(readConsentCache('u1')).toBe(false)
  })
})
