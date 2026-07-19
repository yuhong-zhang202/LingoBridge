/**
 * @module   useGotoPractice
 * @desc     题库「练习」入口共享 hook —— DimensionTab（桌面）与 DimensionTabMobile（移动）此前各持一份
 *           逐字重复的 gotoPractice，改 storyId 取法时被迫改两遍。此处抽为唯一实现，行为与原两份一致：
 *           先拦月度额度（登录用户超额 → 置 reviewQuotaShown 供调用方弹 QuotaReached 雅思变体覆盖层），
 *           再带上该题匹配度最高的一条本人语料跳分析页。
 * @author   LingoBridge
 * @created  2026-07-20
 */
'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { countReviewPracticeThisMonth, IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'
import { listCorpusByQuestion } from '@/lib/db/matches'
import { getAccount } from '@/lib/auth'

interface UseGotoPracticeReturn {
  /** 复练月额度已超（登录用户）→ 调用方据此渲染 QuotaReached ielts 覆盖层 */
  reviewQuotaShown: boolean
  /** 关闭额度覆盖层 */
  dismissReviewQuota: () => void
  /** 跳转到该题的复练分析页（内含额度拦截，超额时不跳转） */
  gotoPractice: (qid: string) => Promise<void>
}

/**
 * 题库「练习」入口 hook
 *
 * storyId 必须是真实 corpus UUID —— 曾硬编码 "1"，服务端 assertCorpusOwner 一律 403，
 * 分析页收到 403 会 router.push('/') 弹回首页，用户看到的是首页的额度提示，误以为雅思额度满了。
 * 取不到语料（理论上 matched=true 必有，防御性兜底）就不带 storyId，走通用分析而非再撞 403。
 *
 * @returns { reviewQuotaShown, dismissReviewQuota, gotoPractice }
 */
export function useGotoPractice(): UseGotoPracticeReturn {
  const router = useRouter()
  const [reviewQuotaShown, setReviewQuotaShown] = useState(false)

  const gotoPractice = useCallback(async (qid: string): Promise<void> => {
    let storyId: string | null = null
    try {
      const acct = await getAccount()
      const loggedIn = !!acct && !acct.isAnonymous && !!acct.email
      if (loggedIn) {
        const n = await countReviewPracticeThisMonth()
        if (n >= IELTS_MONTHLY_LIMIT) { setReviewQuotaShown(true); return }
      }
      // listCorpusByQuestion 已按 high→mid→low 排序、同档新→旧，取首条即最贴合的语料
      storyId = (await listCorpusByQuestion(qid))[0]?.id ?? null
    } catch { /* 静默：取不到语料就走通用分析 */ }
    const story = storyId ? `&storyId=${encodeURIComponent(storyId)}` : ''
    router.push(`/analysis?questionId=${encodeURIComponent(qid)}${story}&review=1`)
  }, [router])

  const dismissReviewQuota = useCallback((): void => setReviewQuotaShown(false), [])

  return { reviewQuotaShown, dismissReviewQuota, gotoPractice }
}
