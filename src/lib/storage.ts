/**
 * @module   storage
 * @desc     浏览器本地存储封装 — 本场暂存(sessionStorage)。
 *           三类持久收藏(saved_phrases / saved_words / saved_pronunciations)均已落库 Supabase
 *           （见 lib/db/saved-*.ts），不再存本地。
 *           试用墙标记(trial_done)已随 RequireAccountGate 一并移除：转化闸统一由服务端 402 →
 *           QuotaReached variant="trial" 承担，localStorage 判匿名身份本就清缓存即可绕过。
 * @author   LingoBridge
 * @created  2026-06-03
 */
import type { SessionPolish } from '@/lib/types'

const SESSION_KEY = 'lingobridge:session_polishes'

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
