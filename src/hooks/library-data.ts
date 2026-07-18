/**
 * @module   library-data
 * @desc     素材库三类收藏（语料卡 / 词组 / 发音）的 SWR 封装（ENGINEERING.md §9）。
 *           每个 fetcher 读取前先跑一次对应的幂等迁移（旧 localStorage → Supabase），
 *           故任何读收藏的入口都会顺带触发迁移。纯云端 + SWR 缓存兜底，无本地双写；
 *           出错时 data 为 undefined，调用方按现状降级。收藏 / 删除后用 refreshXxx 失效重拉。
 * @author   LingoBridge
 * @created  2026-07-11
 */
'use client'
import useSWR, { mutate } from 'swr'
import { listSavedPhrases, migrateLegacySavedPhrases } from '@/lib/db/saved-phrases'
import { listSavedWords, migrateLegacySavedWords } from '@/lib/db/saved-words'
import { listSavedPronunciations, migrateLegacySavedPronunciations } from '@/lib/db/saved-pronunciations'
import type { SavedPhrase, SavedWord, SavedPronunciation } from '@/lib/types'

/** 各类收藏 SWR key（收藏 / 删除后用对应 key 失效重拉） */
export const SAVED_PHRASES_KEY = 'library:saved-phrases'
export const SAVED_WORDS_KEY = 'library:saved-words'
export const SAVED_PRONUNCIATIONS_KEY = 'library:saved-pronunciations'

/** 收藏数据不需要每次切回窗口就重拉；其余用 SWR 默认（去重、错误重试等） */
const CONFIG = { revalidateOnFocus: false } as const

// 加载中 / 出错时的稳定空数组：`data ?? []` 每 render 会新建数组引用，会让「用 effect / useMemo
// 同步派生态」的调用方无限重渲染（Maximum update depth）。用模块级常量固定引用，一劳永逸。
// 调用方只读（map/filter/spread），不得就地 mutate 这些常量。
const EMPTY_PHRASES: SavedPhrase[] = []
const EMPTY_WORDS: SavedWord[] = []
const EMPTY_PRONUNCIATIONS: SavedPronunciation[] = []

/**
 * 语料卡收藏列表（fetcher 先跑一次幂等迁移，再读云端）
 * @returns  phrases（created_at desc）/ isLoading / error
 */
export function useSavedPhrases(): { phrases: SavedPhrase[]; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useSWR(
    SAVED_PHRASES_KEY,
    async () => { await migrateLegacySavedPhrases(); return listSavedPhrases() },
    CONFIG,
  )
  return { phrases: data ?? EMPTY_PHRASES, isLoading, error }
}

/** 收藏 / 删除后调用：失效并重拉语料卡收藏列表 */
export function refreshSavedPhrases(): Promise<unknown> {
  return mutate(SAVED_PHRASES_KEY)
}

/**
 * 词组收藏列表（fetcher 先跑一次幂等迁移，再读云端）
 * @returns  words（created_at desc）/ isLoading / error
 */
export function useSavedWords(): { words: SavedWord[]; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useSWR(
    SAVED_WORDS_KEY,
    async () => { await migrateLegacySavedWords(); return listSavedWords() },
    CONFIG,
  )
  return { words: data ?? EMPTY_WORDS, isLoading, error }
}

/** 收藏 / 删除后调用：失效并重拉词组收藏列表 */
export function refreshSavedWords(): Promise<unknown> {
  return mutate(SAVED_WORDS_KEY)
}

/**
 * 发音收藏列表（fetcher 先跑一次幂等迁移，再读云端）
 * @returns  pronunciations（created_at desc）/ isLoading / error
 */
export function useSavedPronunciations(): { pronunciations: SavedPronunciation[]; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useSWR(
    SAVED_PRONUNCIATIONS_KEY,
    async () => { await migrateLegacySavedPronunciations(); return listSavedPronunciations() },
    CONFIG,
  )
  return { pronunciations: data ?? EMPTY_PRONUNCIATIONS, isLoading, error }
}

/** 收藏 / 删除 / 更新音标后调用：失效并重拉发音收藏列表 */
export function refreshSavedPronunciations(): Promise<unknown> {
  return mutate(SAVED_PRONUNCIATIONS_KEY)
}
