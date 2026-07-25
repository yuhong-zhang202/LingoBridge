/**
 * @module   errors.test
 * @desc     isAppError 类型守卫 + errorLogMeta 失败记账三键萃取（豆包/千问失败落错误码，看板区分排队vs真故障）
 */
import { isAppError, errorLogMeta } from '@/types/errors'

describe('isAppError', () => {
  it('同时带 code + message → true', () => {
    expect(isAppError({ code: '45000292', message: 'busy' })).toBe(true)
  })
  it('缺 code → false', () => {
    expect(isAppError({ message: 'x' })).toBe(false)
  })
  it('null / 原始值 → false', () => {
    expect(isAppError(null)).toBe(false)
    expect(isAppError('err')).toBe(false)
  })
})

describe('errorLogMeta', () => {
  it('AppError → error_code 取 e.code', () => {
    const meta = errorLogMeta({ code: '45000292', message: '并发超限' })
    expect(meta.error_code).toBe('45000292')
    expect(meta.error_message).toBe('并发超限')
  })

  it('非 AppError → error_code 恒为 unknown', () => {
    expect(errorLogMeta(new Error('boom')).error_code).toBe('unknown')
    expect(errorLogMeta('plain string').error_code).toBe('unknown')
  })

  it('error_message 超 200 字截断', () => {
    const long = 'x'.repeat(500)
    const meta = errorLogMeta({ code: 'X', message: long })
    expect(meta.error_message).toHaveLength(200)
  })

  it('无 message → 省略 error_message 键（不落空串）', () => {
    const meta = errorLogMeta({ code: 'X', message: '' })
    expect(meta.error_message).toBeUndefined()
    expect(meta.error_code).toBe('X')
  })

  it('cause.logId 为字符串 → 带出 logId', () => {
    const meta = errorLogMeta({ code: 'X', message: 'm', cause: { logId: 'tt-log-123' } })
    expect(meta.logId).toBe('tt-log-123')
  })

  it('无 logId → 省略 logId 键', () => {
    expect(errorLogMeta({ code: 'X', message: 'm' }).logId).toBeUndefined()
  })
})
