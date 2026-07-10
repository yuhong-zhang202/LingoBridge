/**
 * @module   profile-data
 * @desc     「我的」页统计数据的 SWR 封装 —— 按 key 去重 + 缓存（ENGINEERING.md §9）。
 *           同 key 的请求在多组件间只发一次：listMyCorpus 由 IdentityCard/PortraitCard 共用同一 'profile:corpus'。
 *           统计类数据切回窗口无需重拉，故统一 revalidateOnFocus:false；出错时 data 为 undefined，调用方按现状降级。
 * @author   LingoBridge
 * @created  2026-07-11
 */
'use client'
import useSWR from 'swr'
import { listMyCorpus, countCorpusThisMonth } from '@/lib/db/corpus'
import { getStreak, getPracticeCount, countReviewPracticeThisMonth } from '@/lib/db/practice-sessions'
import { getDimensionScores, type DimensionScore } from '@/lib/db/dimension-scores'

/** 统计数据不需要每次切回窗口就重拉；其余用 SWR 默认（去重、错误重试等） */
const CONFIG = { revalidateOnFocus: false } as const

/** 语料段数（'profile:corpus' 共用 key 是全页去重的关键） */
export function useCorpusCount(): { count: number; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useSWR('profile:corpus', () => listMyCorpus(), CONFIG)
  return { count: data?.length ?? 0, isLoading, error }
}

/** 连续打卡天数 */
export function useStreak(): { streak: number; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useSWR('profile:streak', () => getStreak(), CONFIG)
  return { streak: data ?? 0, isLoading, error }
}

/** 练习次数 */
export function usePracticeCount(): { practiceCount: number; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useSWR('profile:practice', () => getPracticeCount(), CONFIG)
  return { practiceCount: data ?? 0, isLoading, error }
}

/** 六维得分 */
export function useDimensionScores(): { scores: DimensionScore[]; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useSWR('profile:dimensions', () => getDimensionScores(), CONFIG)
  return { scores: data ?? [], isLoading, error }
}

/** 本月额度用量（故事 / 题目练习并行取，同 key 去重） */
export function useQuota(): { story: number; review: number; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useSWR(
    'profile:quota',
    async () => {
      const [story, review] = await Promise.all([countCorpusThisMonth(), countReviewPracticeThisMonth()])
      return { story, review }
    },
    CONFIG,
  )
  return { story: data?.story ?? 0, review: data?.review ?? 0, isLoading, error }
}
