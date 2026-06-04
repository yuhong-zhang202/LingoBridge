/**
 * @module   storage
 * @desc     浏览器本地存储封装 — 本场暂存(sessionStorage) + 持久收藏(localStorage)
 *           登录后可把 saved_phrases 迁到 Supabase，仅需替换本文件实现
 * @author   LingoBridge
 * @created  2026-06-03
 */
import type { SessionPolish, SavedPhrase } from '@/lib/types'

const SESSION_KEY = 'lingobridge:session_polishes'
const SAVED_KEY = 'lingobridge:saved_phrases'

// ── 本场暂存：practice → feedback ──
export function setSessionPolishes(items: SessionPolish[]): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(items))
}
export function getSessionPolishes(): SessionPolish[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '[]') as SessionPolish[]
  } catch {
    return []
  }
}
export function clearSessionPolishes(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(SESSION_KEY)
}

// ── 持久收藏：我的表达库 ──
export function getSavedPhrases(): SavedPhrase[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as SavedPhrase[]
  } catch {
    return []
  }
}
export function addSavedPhrase(p: SavedPhrase): void {
  if (typeof window === 'undefined') return
  const all = getSavedPhrases()
  all.unshift(p)
  localStorage.setItem(SAVED_KEY, JSON.stringify(all))
}

/**
 * 删除单条收藏（按 id 过滤后写回 localStorage）
 * @param id  SavedPhrase.id
 */
export function removeSavedPhrase(id: string): void {
  if (typeof window === 'undefined') return
  const filtered = getSavedPhrases().filter(p => p.id !== id)
  localStorage.setItem(SAVED_KEY, JSON.stringify(filtered))
}
