/**
 * @module   errors
 * @desc     全局统一错误类型定义（ENGINEERING.md §4）
 * @author   LingoBridge
 * @created  2026-06-03
 */

import { ERROR_KIND_USER_INPUT, ERROR_KIND_CAPACITY, ERROR_KIND_NETWORK } from '@/lib/constants'

export type AppError = {
  code: string
  message: string
  cause?: unknown
}

/** 失败归因四分类的取值（= metadata.error_kind；null = 系统故障，唯一计入系统错误率的一类） */
export type ErrorKind =
  | typeof ERROR_KIND_USER_INPUT
  | typeof ERROR_KIND_CAPACITY
  | typeof ERROR_KIND_NETWORK
  | null

/** 豆包「无有效人声 / 静音」错误码（用户录了没法处理的输入，服务本身是好的）。 */
const DOUBAO_SILENCE_CODE = '20000003'
/** 豆包并发超限错误码（transcription 层把上游 X-Api-Status-Code 原样放进 AppError.code）。 */
const DOUBAO_CONCURRENCY_LIMIT_CODE = '45000292'

/**
 * 失败归因分类器：把 catch 到的未知错误归入四类之一，集中编码判定规则，供各 route 的
 * status:'error' 记账统一调用（DRY——判定只此一处，别在每个 route 复制粘贴）。
 * 返回值即 metadata.error_kind 的取值；null = 系统故障（供应商 5xx / 意外异常），是唯一
 * 计入系统错误率、需要警觉的一类。其余三类计入失败成本、但从错误率摘出（见 constants ERROR_KIND_* 注释）。
 *
 * 判定容错：错误码从 AppError.code / e.code / e.cause.code 三处任取，message 与 name 也都试，任一命中即归类。
 *   · user_input：AppError 'EMPTY_TRANSCRIPT'，或豆包码 20000003，或 message 含 'no valid speech' / 'silence audio'；
 *   · capacity  ：豆包并发超限码 45000292，或 AppError 'ASR_BUSY'（沿用 transcribe 原 isCapacityError 语义）；
 *   · network   ：错误码 ∈ {ECONNRESET, ECONNABORTED}，或 name === 'AbortError'，或 message 含 'aborted'
 *                （涵盖 'This operation was aborted'）——客户端网络重置 / 请求中断，非后端故障；
 *   · null      ：其余，真·系统故障。
 * 判定顺序即优先级：user_input → capacity → network → 系统故障。
 * @param e  catch 到的未知错误
 * @returns  四分类之一（'user_input' | 'capacity' | 'network' | null）
 */
export function classifyErrorKind(e: unknown): ErrorKind {
  const code = String(
    (isAppError(e) ? e.code : undefined)
      ?? (e as { code?: unknown } | null)?.code
      ?? (e as { cause?: { code?: unknown } } | null)?.cause?.code
      ?? '',
  )
  const message = String((e as { message?: unknown } | null)?.message ?? '').toLowerCase()
  const name = String((e as { name?: unknown } | null)?.name ?? '')

  // ① 用户输入：空录音 / 静音（服务好、这份输入没法处理）
  if (code === 'EMPTY_TRANSCRIPT' || code === DOUBAO_SILENCE_CODE
    || message.includes('no valid speech') || message.includes('silence audio')) {
    return ERROR_KIND_USER_INPUT
  }
  // ② 容量繁忙：豆包并发超限 / ASR_BUSY（人多稍等、非故障）
  if (code === DOUBAO_CONCURRENCY_LIMIT_CODE || code === 'ASR_BUSY') {
    return ERROR_KIND_CAPACITY
  }
  // ③ 网络中断：连接重置 / 请求被中断（客户端网络问题、非后端故障）
  if (code === 'ECONNRESET' || code === 'ECONNABORTED'
    || name === 'AbortError' || message.includes('aborted')) {
    return ERROR_KIND_NETWORK
  }
  // ④ 其余：真·系统故障（缺键即系统故障，看板据此计入错误率）
  return null
}

/**
 * 失败归因 error_kind 的 metadata 片段（各 route 的 status:'error' 记账统一 `...errorKindMeta(e)`）：
 * 命中四分类前三类（user_input / capacity / network）→ { error_kind: '<kind>' }；
 * 系统故障（classifyErrorKind 返回 null）→ {}（不写键）。
 * 「缺键 = 系统故障」是全看板既定口径（见 constants ERROR_KIND_* 注释 + dashboard isSystemError）：
 * 刻意不写 null 键，让新系统故障行与埋点前无键的历史行同形、metadata 保持干净。
 * @param e  catch 到的未知错误
 * @returns  metadata 片段（命中前三类才含 error_kind 键，否则为空对象）
 */
export function errorKindMeta(e: unknown): { error_kind?: string } {
  const kind = classifyErrorKind(e)
  return kind === null ? {} : { error_kind: kind }
}

/**
 * AppError 类型守卫：判定 catch 到的未知错误是否为受控 AppError（同时带 code + message 字段）。
 * 各 route/服务此前各自内联同一份判断，收归此处唯一来源。
 * @param e  catch 到的未知错误
 */
export function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e
}

/**
 * 失败记账三键：主用于 transcribe 供应商链路，三键取自供应商响应（错误码 / 状态描述 X-Api-Message / 日志 ID），
 * 该链路无用户录音文本、无 PII。但本函数也被 practice/matching 等通用兜底 catch 复用，那里 error_message
 * 来自任意 Error.message（截断落库），可能含未受控文本（SDK 内部报错、被 catch 的第三方异常描述等）——
 * 故「无 PII」是 transcribe 供应商键的保证，不是本类型对所有调用点的普适保证。
 */
export type ErrorLogMeta = {
  error_code: string
  error_message?: string
  logId?: string
}

/**
 * 从 catch 到的错误萃取失败记账三键，供各 route 的 status:'error' 记账统一附带到 metadata。
 * 让成本看板一眼区分「并发超限 / 真故障」，并给运维留一个可回溯的日志 ID。
 * 在 transcribe 供应商链路，三键均来自供应商响应头/结构、error_message 是供应商状态描述（如豆包 X-Api-Message）、
 * 非用户原文，无 PII。注意：本函数也被 practice/matching 等【通用兜底 catch】复用，此时 error_message 直接取
 * 任意 Error.message（截断 ≤200 字落库），内容不受控、可能含 SDK/第三方内部报错文本——非 transcribe 链路时
 * 不应假设 error_message 一定无敏感信息。
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
