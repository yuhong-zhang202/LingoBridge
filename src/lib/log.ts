/**
 * @module   log
 * @desc     极简安全日志 — 错误对象只提取 message/name/status，绝不打 stack/payload/请求体。
 * @author   LingoBridge
 * @created  2026-06-17
 */

interface SafeError {
  message: string
  name?: string
  status?: number
}

/**
 * 把任意 unknown error 转成只含安全字段的小对象，message 截到 300 字。
 */
export function safeErr(e: unknown): SafeError {
  const out: SafeError = { message: '' }
  if (e instanceof Error) {
    out.message = e.message.slice(0, 300)
    if (e.name) out.name = e.name
  } else {
    out.message = String(e).slice(0, 300)
  }
  if (typeof e === 'object' && e !== null) {
    const o = e as Record<string, unknown>
    const status = o.status ?? o.statusCode
    if (typeof status === 'number') out.status = status
  }
  return out
}

/**
 * 在控制台打一条带前缀的脱敏错误日志。
 */
export function logErr(tag: string, e: unknown): void {
  console.error(tag, safeErr(e))
}
