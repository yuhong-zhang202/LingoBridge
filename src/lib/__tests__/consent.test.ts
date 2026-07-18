/**
 * @module   consent.test
 * @desc     首次同意闸核心逻辑单测 —— 守卫三条不变式：
 *           A) 无记录才弹：缓存/库都无当前版本同意记录 → hasRecordedConsent=false（弹窗）；有则 true（放行）。
 *           B) 成功才放行：recordConsent 仅当 /api/consent 返回 ok 才回 true 并写缓存；失败回 false、不写缓存。
 *           C) 点击才落库：recordConsent 会先 ensureSession 再 POST /api/consent（匿名同意也放行）。
 *           不碰真实 DB / 网络，全 mock。
 * @author   LingoBridge
 * @created  2026-07-18
 */
jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn(), ensureSession: jest.fn() }))
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }))

import {
  CONSENT_CACHE_KEY,
  readConsentCache,
  hasRecordedConsent,
  recordConsent,
} from '@/lib/consent'
import { getSupabase, ensureSession } from '@/lib/supabase'
import { apiFetch } from '@/lib/api-client'
import { BETA_PRIVACY_VERSION } from '@/lib/privacy-copy'

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>
const mockEnsureSession = ensureSession as jest.MockedFunction<typeof ensureSession>
const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>

/** 最小 localStorage 垫片（jest 默认 node 环境无 window/localStorage） */
function installLocalStorage(): void {
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
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

describe('CONSENT_CACHE_KEY · 从版本常量派生', () => {
  test('key 含当前 BETA_PRIVACY_VERSION，且换了前缀（不与旧 lb-ai-consent 冲突）', () => {
    expect(CONSENT_CACHE_KEY).toBe(`lb-consent-v${BETA_PRIVACY_VERSION}`)
    expect(CONSENT_CACHE_KEY).not.toContain('lb-ai-consent')
  })
})

describe('hasRecordedConsent · A) 无记录才弹', () => {
  test('缓存命中 → true，且根本不查库', async () => {
    localStorage.setItem(CONSENT_CACHE_KEY, '1')
    const stub = makeSupabaseStub({ userId: 'u1', rows: [] })
    mockGetSupabase.mockReturnValue(stub as never)

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
    expect(readConsentCache()).toBe(false)   // 未签不应写缓存
  })

  test('无缓存 + 有 session 且库里查到记录 → true，并回写缓存', async () => {
    mockGetSupabase.mockReturnValue(makeSupabaseStub({ userId: 'u1', rows: [{ id: 'c1' }] }) as never)
    await expect(hasRecordedConsent()).resolves.toBe(true)
    expect(readConsentCache()).toBe(true)    // 查到后回写缓存
  })
})

describe('recordConsent · B) 成功才放行 / C) 点击才落库', () => {
  test('成功（ok）：先 ensureSession 再 POST /api/consent → true，并写缓存', async () => {
    mockEnsureSession.mockResolvedValue('u1')
    mockApiFetch.mockResolvedValue({ ok: true } as Response)

    await expect(recordConsent()).resolves.toBe(true)
    expect(mockEnsureSession).toHaveBeenCalledTimes(1)
    expect(mockApiFetch).toHaveBeenCalledWith('/api/consent', { method: 'POST' })
    expect(readConsentCache()).toBe(true)
  })

  test('失败（非 ok）：返回 false，且绝不写缓存（不误放行）', async () => {
    mockEnsureSession.mockResolvedValue('u1')
    mockApiFetch.mockResolvedValue({ ok: false, status: 500 } as Response)

    await expect(recordConsent()).resolves.toBe(false)
    expect(readConsentCache()).toBe(false)
  })
})
