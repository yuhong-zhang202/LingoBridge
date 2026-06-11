/**
 * @module   storage
 * @desc     浏览器本地存储封装 — 本场暂存(sessionStorage) + 持久收藏(localStorage)
 *           登录后可把 saved_phrases 迁到 Supabase，仅需替换本文件实现
 * @author   LingoBridge
 * @created  2026-06-03
 */
import type { SessionPolish, SavedPhrase, SavedWord, SavedPronunciation } from '@/lib/types'

const SESSION_KEY = 'lingobridge:session_polishes'
const SAVED_KEY = 'lingobridge:saved_phrases'
const SAVED_WORDS_KEY = 'lingobridge:saved_words'
const SAVED_PRON_KEY = 'lingobridge:saved_pronunciations'

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

// ── 持久收藏：词组（题目分析里收藏的可用词组）──
export function getSavedWords(): SavedWord[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(SAVED_WORDS_KEY) ?? '[]') as SavedWord[]
  } catch {
    return []
  }
}
export function addSavedWord(w: SavedWord): void {
  if (typeof window === 'undefined') return
  const all = getSavedWords().filter(x => x.id !== w.id)
  all.unshift(w)
  localStorage.setItem(SAVED_WORDS_KEY, JSON.stringify(all))
}
export function removeSavedWord(id: string): void {
  if (typeof window === 'undefined') return
  const filtered = getSavedWords().filter(w => w.id !== id)
  localStorage.setItem(SAVED_WORDS_KEY, JSON.stringify(filtered))
}

// ── 持久收藏：发音正音（练习页点词收藏）──
export function getSavedPronunciations(): SavedPronunciation[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(SAVED_PRON_KEY) ?? '[]') as SavedPronunciation[]
  } catch {
    return []
  }
}
export function addSavedPronunciation(p: SavedPronunciation): void {
  if (typeof window === 'undefined') return
  const all = getSavedPronunciations().filter(x => x.id !== p.id)
  all.unshift(p)
  localStorage.setItem(SAVED_PRON_KEY, JSON.stringify(all))
}
export function removeSavedPronunciation(id: string): void {
  if (typeof window === 'undefined') return
  const filtered = getSavedPronunciations().filter(p => p.id !== id)
  localStorage.setItem(SAVED_PRON_KEY, JSON.stringify(filtered))
}
