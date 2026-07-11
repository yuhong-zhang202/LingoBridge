/**
 * @module   storage
 * @desc     浏览器本地存储封装 — 本场暂存(sessionStorage) + 试用墙标记(localStorage)。
 *           三类持久收藏(saved_phrases / saved_words / saved_pronunciations)均已落库 Supabase
 *           （见 lib/db/saved-*.ts），不再存本地。
 * @author   LingoBridge
 * @created  2026-06-03
 */
import type { SessionPolish } from '@/lib/types'

const SESSION_KEY = 'lingobridge:session_polishes'
const TRIAL_DONE_KEY = 'lingobridge:trial_done'

// ── 试用墙：到达 /feedback 即视为「免费一圈走完」──
export function markTrialDone(): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(TRIAL_DONE_KEY, '1')
}
export function isTrialDone(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(TRIAL_DONE_KEY) === '1'
}

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
