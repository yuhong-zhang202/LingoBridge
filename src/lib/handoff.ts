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
