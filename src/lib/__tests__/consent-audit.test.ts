/**
 * @module   consent-audit.test
 * @desc     同意审计痕迹单测 —— 覆盖三件合规相关的不变式：
 *           ① 哈希口径：加盐、规范化（大小写/首尾空白无关）、salt 不同则哈希不同、结果不含明文邮箱；
 *           ② salt 缺失时【抛错】而非静默跳过（由删号路由据此中止，见 route.test.ts）；
 *           ③ 写入内容确为去标识化（只含 email_hash / 版本 / 时间，绝不含 user_id 或明文邮箱）。
 *           写入与删除的【先后顺序】在 api/account/delete/__tests__/route.test.ts 里断言。
 *           全部 mock，不连真实库。
 * @author   LingoBridge
 * @created  2026-07-20
 */
import { createHash } from 'node:crypto'

jest.mock('server-only', () => ({}))

const insertMock = jest.fn(async (_rows: Record<string, unknown>[]) => ({
  error: null as { message: string } | null,
}))
let consentRows: { consent_version: number | null; agreed_at: string }[] = []
jest.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => ({
    from: (table: string) => ({
      select: () => ({ eq: async () => ({ data: table === 'consent_records' ? consentRows : [], error: null }) }),
      insert: insertMock,
    }),
  }),
}))

// salt 走可变对象，方便逐例改写（env-server 在模块加载时就固化了 process.env）
const fakeEnv: { consentHashSalt: string } = { consentHashSalt: 'test-salt' }
jest.mock('@/lib/env-server', () => ({ env: fakeEnv }))

import { hashEmailForAudit, writeConsentAuditTrace, CONSENT_SALT_MISSING } from '@/lib/consent-audit'

beforeEach(() => {
  jest.clearAllMocks()
  fakeEnv.consentHashSalt = 'test-salt'
  consentRows = [{ consent_version: 3, agreed_at: '2026-07-01T00:00:00.000Z' }]
})

describe('hashEmailForAudit · 哈希口径', () => {
  test('等于 sha256(规范化邮箱 + salt) 的十六进制串', () => {
    const expected = createHash('sha256').update('a@x.coms1').digest('hex')
    expect(hashEmailForAudit('a@x.com', 's1')).toBe(expected)
  })

  test('大小写与首尾空白不影响结果（申诉者报的邮箱必须能比中自己的痕迹）', () => {
    const base = hashEmailForAudit('user@x.com', 's1')
    expect(hashEmailForAudit('USER@X.com', 's1')).toBe(base)
    expect(hashEmailForAudit('  user@x.com  ', 's1')).toBe(base)
  })

  test('salt 参与运算：换 salt 必得不同哈希（故 salt 一旦启用不可更换）', () => {
    expect(hashEmailForAudit('user@x.com', 's1')).not.toBe(hashEmailForAudit('user@x.com', 's2'))
  })

  test('输出不含明文邮箱片段，且为 64 位十六进制', () => {
    const h = hashEmailForAudit('user@x.com', 's1')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain('user')
    expect(h).not.toContain('@')
  })
})

describe('writeConsentAuditTrace · 写入行为', () => {
  test('salt 缺失 → 抛错（不静默跳过，供删号路由中止）', async () => {
    fakeEnv.consentHashSalt = ''
    await expect(writeConsentAuditTrace('u1', 'a@x.com')).rejects.toThrow(CONSENT_SALT_MISSING)
    expect(insertMock).not.toHaveBeenCalled()
  })

  test('salt 缺失时即便无邮箱也抛错（漏配必须在任何删号场景都暴露）', async () => {
    fakeEnv.consentHashSalt = ''
    await expect(writeConsentAuditTrace('u1', null)).rejects.toThrow(CONSENT_SALT_MISSING)
  })

  test('匿名账号（无邮箱）→ 跳过写入（无邮箱即无从比对，空壳痕迹无举证价值）', async () => {
    await writeConsentAuditTrace('u1', null)
    await writeConsentAuditTrace('u1', '   ')
    expect(insertMock).not.toHaveBeenCalled()
  })

  test('无同意记录 → 不写空行', async () => {
    consentRows = []
    await writeConsentAuditTrace('u1', 'a@x.com')
    expect(insertMock).not.toHaveBeenCalled()
  })

  test('写入的行已去标识化：只含 email_hash/版本/授予与撤回时间，无 user_id、无明文邮箱', async () => {
    consentRows = [
      { consent_version: 2, agreed_at: '2026-06-01T00:00:00.000Z' },
      { consent_version: 3, agreed_at: '2026-07-01T00:00:00.000Z' },
    ]
    await writeConsentAuditTrace('u1', 'User@X.com')

    expect(insertMock).toHaveBeenCalledTimes(1)
    const rows = insertMock.mock.calls[0]![0] as unknown as Record<string, unknown>[]
    expect(rows).toHaveLength(2)

    const hash = hashEmailForAudit('user@x.com', 'test-salt')
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['consent_version', 'email_hash', 'granted_at', 'revoked_at'].sort(),
      )
      expect(row.email_hash).toBe(hash)
      // 关键：整行序列化后不得出现 user_id 或明文邮箱
      expect(JSON.stringify(row)).not.toContain('u1')
      expect(JSON.stringify(row).toLowerCase()).not.toContain('user@x.com')
    }
    // 逐条保留原同意版本与时刻（不是压成一条）
    expect(rows.map((r) => r.consent_version)).toEqual([2, 3])
    expect(rows.map((r) => r.granted_at)).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
    ])
  })

  test('写入失败 → 抛错（不吞异常，删号必须随之中止）', async () => {
    insertMock.mockResolvedValueOnce({ error: { message: 'boom' } as unknown as null })
    await expect(writeConsentAuditTrace('u1', 'a@x.com')).rejects.toBeDefined()
  })
})
