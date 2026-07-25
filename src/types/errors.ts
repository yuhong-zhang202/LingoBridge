/**
 * @module   errors
 * @desc     全局统一错误类型定义（ENGINEERING.md §4）
 * @author   LingoBridge
 * @created  2026-06-03
 */

export type AppError = {
  code: string
  message: string
  cause?: unknown
}

/**
 * AppError 类型守卫：判定 catch 到的未知错误是否为受控 AppError（同时带 code + message 字段）。
 * 各 route/服务此前各自内联同一份判断，收归此处唯一来源。
 * @param e  catch 到的未知错误
 */
export function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e
}

/** 失败记账三键：全部取自供应商响应（错误码 / 状态描述 / 日志 ID），无用户录音文本、无 PII，落库安全。 */
export type ErrorLogMeta = {
  error_code: string
  error_message?: string
  logId?: string
}

/**
 * 从 catch 到的错误萃取失败记账三键，供各 route 的 status:'error' 记账统一附带到 metadata。
 * 让成本看板一眼区分「并发超限 / 真故障」，并给运维留一个可回溯的日志 ID。三键均来自供应商响应头/结构，
 * 绝无用户内容：error_message 是供应商状态描述（如豆包 X-Api-Message）、非用户原文。
 *   · error_code    = isAppError(e) ? e.code : 'unknown'（豆包把上游 X-Api-Status-Code 放进 AppError.code）
 *   · error_message = 错误 message，截断 ≤200 字防超长；无 message 则省略
 *   · logId         = AppError.cause.logId（豆包 X-Tt-Logid），可空则省略
 * @param e  catch 到的未知错误
 * @returns  metadata 片段（只含有值的键；error_code 恒有）
 */
export function errorLogMeta(e: unknown): ErrorLogMeta {
  const meta: ErrorLogMeta = { error_code: isAppError(e) ? e.code : 'unknown' }
  const rawMessage = (e as { message?: unknown } | null)?.message
  if (typeof rawMessage === 'string' && rawMessage.length > 0) {
    meta.error_message = rawMessage.slice(0, 200)
  }
  const logId = (e as { cause?: { logId?: unknown } } | null)?.cause?.logId
  if (typeof logId === 'string' && logId.length > 0) {
    meta.logId = logId
  }
  return meta
}
