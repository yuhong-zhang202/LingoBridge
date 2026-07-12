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
 * 按 id 取出并 JSON 反序列化；仅在解析成功时消费（删除并返回值），解析失败或不存在返回 null。
 * 解析失败故意不消费——旧版纯字符串 handoff 走此路会返回 null，调用方可回退用 takeHandoff 原样读出。
 */
export function takeHandoffJson<T>(id: string): T | null {
  if (typeof window === 'undefined' || !id) return null
  const key = PREFIX + id
  const raw = sessionStorage.getItem(key)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as T
    sessionStorage.removeItem(key)
    return parsed
  } catch {
    return null
  }
}
