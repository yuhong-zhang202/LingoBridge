/**
 * @module   errors.test
 * @desc     isAppError 类型守卫 + errorLogMeta 失败记账三键萃取 + classifyErrorKind 四分类归因
 *           （看板据此把 user_input/capacity/network 从系统错误率摘出，只留真故障告警）
 */
import { isAppError, errorLogMeta, classifyErrorKind, errorKindMeta } from '@/types/errors'

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

describe('classifyErrorKind · 四分类归因', () => {
  it('user_input：EMPTY_TRANSCRIPT / 豆包静音码 20000003 / message 含 no valid speech|silence audio', () => {
    expect(classifyErrorKind({ code: 'EMPTY_TRANSCRIPT', message: '空' })).toBe('user_input')
    expect(classifyErrorKind({ code: '20000003', message: 'silence' })).toBe('user_input')
    expect(classifyErrorKind(new Error('No Valid Speech detected'))).toBe('user_input')
    expect(classifyErrorKind(new Error('silence audio input'))).toBe('user_input')
  })

  it('capacity：豆包并发超限 45000292 / AppError ASR_BUSY', () => {
    expect(classifyErrorKind({ code: '45000292', message: 'concurrency limit' })).toBe('capacity')
    expect(classifyErrorKind({ code: 'ASR_BUSY', message: '人多' })).toBe('capacity')
  })

  it('network：ECONNRESET / ECONNABORTED / AbortError / message 含 aborted（含 This operation was aborted）', () => {
    expect(classifyErrorKind({ code: 'ECONNRESET', message: 'socket hang up' })).toBe('network')
    expect(classifyErrorKind({ code: 'ECONNABORTED', message: 'x' })).toBe('network')
    const abortErr = new Error('The operation was aborted'); abortErr.name = 'AbortError'
    expect(classifyErrorKind(abortErr)).toBe('network')
    expect(classifyErrorKind(new Error('This operation was aborted'))).toBe('network')
    // 容错：错误码藏在 e.cause.code 也要读到（如 undici 包裹的 fetch 错误）
    expect(classifyErrorKind({ message: 'fetch failed', cause: { code: 'ECONNRESET' } })).toBe('network')
  })

  it('系统故障 → null（供应商 5xx / 意外异常 / 裸字符串）', () => {
    expect(classifyErrorKind(new Error('上游超时'))).toBeNull()
    expect(classifyErrorKind({ code: '500', message: 'internal error' })).toBeNull()
    expect(classifyErrorKind('plain string')).toBeNull()
    expect(classifyErrorKind(null)).toBeNull()
  })

  it('优先级：user_input 早于 capacity 早于 network（判定顺序即优先级）', () => {
    // 同时带静音关键词 + aborted：静音先命中（用户输入问题优先于网络）
    expect(classifyErrorKind(new Error('no valid speech, then aborted'))).toBe('user_input')
  })
})

describe('errorKindMeta · omit-null 片段（缺键=系统故障，全看板既定口径）', () => {
  it('命中前三类 → 带 error_kind 键', () => {
    expect(errorKindMeta({ code: '45000292', message: 'x' })).toEqual({ error_kind: 'capacity' })
    expect(errorKindMeta({ code: 'ECONNRESET', message: 'x' })).toEqual({ error_kind: 'network' })
    expect(errorKindMeta({ code: 'EMPTY_TRANSCRIPT', message: 'x' })).toEqual({ error_kind: 'user_input' })
  })
  it('系统故障 → 空对象（不写 null 键）', () => {
    expect(errorKindMeta(new Error('boom'))).toEqual({})
    expect(errorKindMeta(undefined)).toEqual({})
  })
})
