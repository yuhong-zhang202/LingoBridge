/**
 * @module   handoff
 * @desc     一次性中转传值（基于 sessionStorage）— URL 只带短 id，正文不进 URL；
 *           取一次即删，避免历史/上报工具沾上用户故事正文。
 * @author   LingoBridge
 * @created  2026-06-17
 */

const PREFIX = 'lingobridge:handoff:'

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 把一段文本暂存到 sessionStorage，返回短 id（用于 URL）。
 * @returns 短 id；服务端环境返回空串
 */
export function putHandoff(text: string): string {
  if (typeof window === 'undefined') return ''
  const id = randomId()
  sessionStorage.setItem(PREFIX + id, text)
  return id
}

/**
 * 按 id 取出文本并立即删除；不存在或服务端环境返回 null。
 */
export function takeHandoff(id: string): string | null {
  if (typeof window === 'undefined' || !id) return null
  const key = PREFIX + id
  const v = sessionStorage.getItem(key)
  if (v === null) return null
  sessionStorage.removeItem(key)
  return v
}

/**
 * 把任意可序列化值 JSON 序列化后暂存，返回短 id（用于 URL）。
 * @returns 短 id；服务端环境返回空串
 */
export function putHandoffJson<T>(value: T): string {
  return putHandoff(JSON.stringify(value))
}

/**
 * 按 id 取出并 JSON 反序列化，validate 校验形状后返回；仅在「解析成功且校验通过」时消费（删除）。
 * 三种输入的行为：
 *   1) 新版结构化 handoff（putHandoffJson 写入的合法 JSON 且形状匹配）→ 消费并返回值；
 *   2) 旧版纯文本 handoff（非合法 JSON）→ parse 失败，不消费、返回 null，调用方可回退用 takeHandoff 原样读出；
 *   3) 旧版纯文本恰为合法 JSON（如 "123"、"[1,2]"）→ parse 成功但 validate 不通过，不消费、返回 null，
 *      同样可被 takeHandoff 原样兜底，避免误消费。
 * @param id        handoff 短 id
 * @param validate  类型守卫，判定 parse 结果是否为期望形状 T
 * @returns         校验通过的 T；否则 null
 */
export function takeHandoffJson<T>(id: string, validate: (v: unknown) => v is T): T | null {
  if (typeof window === 'undefined' || !id) return null
  const key = PREFIX + id
  const raw = sessionStorage.getItem(key)
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!validate(parsed)) return null
  sessionStorage.removeItem(key)
  return parsed
}
