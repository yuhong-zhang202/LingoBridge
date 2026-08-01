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

// ── 练习页功能引导：首次进入弹一次（跨会话持久 → localStorage） ──
const PRACTICE_INTRO_SEEN_KEY = 'lingobridge:practice_intro_seen'

/** 是否已看过练习页功能引导。SSR / localStorage 不可用（隐私模式）时当作「已看过」，绝不误弹或报错。 */
export function hasSeenPracticeIntro(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(PRACTICE_INTRO_SEEN_KEY) === '1'
  } catch {
    return true
  }
}

/** 标记已看过；隐私模式写不了则静默（本次会话内靠组件 state 已不再弹）。 */
export function markPracticeIntroSeen(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PRACTICE_INTRO_SEEN_KEY, '1')
  } catch {
    /* 隐私模式：忽略 */
  }
}

// ── 版本更新公告：按版本号只弹一次（首页公告卡 ChangelogAnnouncement 用；与顶栏铃铛红点各用各的 key，互不影响） ──
const CHANGELOG_SEEN_PREFIX = 'lingobridge:changelog_seen_'

/**
 * 是否已看过某版本的更新公告。SSR / localStorage 不可用（隐私模式）时当作「已看过」，绝不误弹或报错。
 * @param  version  版本号（CHANGELOG[0].version，如 'v0.8.0'）
 * @returns         是否已看过该版本公告
 */
export function hasSeenChangelog(version: string): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(`${CHANGELOG_SEEN_PREFIX}${version}`) === '1'
  } catch {
    return true
  }
}

/**
 * 标记某版本公告已看过（关闭公告卡时调用）；隐私模式写不了则静默。
 * @param  version  版本号（CHANGELOG[0].version）
 * @sideEffect      写 localStorage
 */
export function markChangelogSeen(version: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`${CHANGELOG_SEEN_PREFIX}${version}`, '1')
  } catch {
    /* 隐私模式：忽略 */
  }
}

// ── 目标分提醒弹窗：给「未设目标分」的注册用户提醒一次「词组已按目标分出」（首页 TargetBandNudge 用；只弹一次） ──
const TARGETBAND_NUDGE_SEEN_KEY = 'lingobridge:targetband_nudge_seen'

/** 是否已看过目标分提醒。SSR / localStorage 不可用（隐私模式）时一律当作「已看过」，绝不误弹或报错。 */
export function hasSeenTargetBandNudge(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(TARGETBAND_NUDGE_SEEN_KEY) === '1'
  } catch {
    return true
  }
}

/** 标记目标分提醒已看过（三种关闭路径都调）；隐私模式写不了则静默（本次会话靠组件 state 已不再弹）。 */
export function markTargetBandNudgeSeen(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(TARGETBAND_NUDGE_SEEN_KEY, '1')
  } catch {
    /* 隐私模式：忽略 */
  }
}
