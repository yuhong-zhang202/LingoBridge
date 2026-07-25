/**
 * @module   useGotoPractice
 * @desc     题库「练习」入口共享 hook —— DimensionTab（桌面）与 DimensionTabMobile（移动）此前各持一份
 *           逐字重复的 gotoPractice，改 storyId 取法时被迫改两遍。此处抽为唯一实现：
 *           先拦月度额度（登录用户超额 → 置 reviewQuotaShown 供调用方弹 QuotaReached 雅思变体覆盖层），
 *           再带上该题匹配度最高的一条本人语料跳分析页。
 *           挂载即预取额度与语料映射，命中预取时点击零等待；未就绪则回落到现场核并对外暴露 pendingQid 供调用方渲染加载态。
 * @author   LingoBridge
 * @created  2026-07-20
 */
'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { useNav } from '@/components/NavProgress'
import { countReviewPracticeThisMonth, IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'
import { listCorpusByQuestion, mapBestCorpusIdByQuestion } from '@/lib/db/matches'
import { getAccount } from '@/lib/auth'

interface UseGotoPracticeReturn {
  /** 复练月额度已超（登录用户）→ 调用方据此渲染 QuotaReached ielts 覆盖层 */
  reviewQuotaShown: boolean
  /** 关闭额度覆盖层 */
  dismissReviewQuota: () => void
  /** 正在处理跳转的题目 id；非 null 时调用方应把该题按钮置为 loading/disabled */
  pendingQid: string | null
  /** 跳转到该题的复练分析页（内含额度拦截，超额时不跳转） */
  gotoPractice: (qid: string) => Promise<void>
}

/** 挂载时预取的结果；任一路失败则整体作废，退回逐次现场核 */
interface Prefetched {
  /** 已登录（非匿名且有邮箱）才受复练月额度约束 */
  loggedIn: boolean
  /** 本月复练次数；未登录为 0（不参与判断） */
  reviewCount: number
  /** questionId → 最贴合的语料 UUID */
  corpusByQuestion: Record<string, string>
}

/**
 * 题库「练习」入口 hook
 *
 * storyId 必须是真实 corpus UUID —— 曾硬编码 "1"，服务端 assertCorpusOwner 一律 403，
 * 分析页收到 403 会 router.push('/') 弹回首页，用户看到的是首页的额度提示，误以为雅思额度满了。
 * 取不到语料（理论上 matched=true 必有，防御性兜底）就不带 storyId，走通用分析而非再撞 403。
 *
 * @returns { reviewQuotaShown, dismissReviewQuota, pendingQid, gotoPractice }
 */
export function useGotoPractice(): UseGotoPracticeReturn {
  // 用 useNav 而非 useRouter：跳 /analysis（AI 分析页）时点击当帧即亮顶部进度条，消除跳转白屏窗口
  const { navigate } = useNav()
  const [reviewQuotaShown, setReviewQuotaShown] = useState(false)
  const [pendingQid, setPendingQid] = useState<string | null>(null)
  /** 预取的 in-flight promise；点击早于预取完成时 join 它，不重复发请求 */
  const prefetchRef = useRef<Promise<Prefetched | null> | null>(null)
  /** 预取已完成且成功 —— 有值即可走同步快路径，不产生任何 await */
  const readyRef = useRef<Prefetched | null>(null)

  // 挂载即预取：与题库自身的数据加载并行，用户读完页面再点时通常早已就绪
  useEffect(() => {
    const p = (async (): Promise<Prefetched | null> => {
      try {
        const acct = await getAccount()
        const loggedIn = !!acct && !acct.isAnonymous && !!acct.email
        const [reviewCount, corpusByQuestion] = await Promise.all([
          loggedIn ? countReviewPracticeThisMonth() : Promise.resolve(0),
          mapBestCorpusIdByQuestion(),
        ])
        return { loggedIn, reviewCount, corpusByQuestion }
      } catch {
        return null   // 预取失败不报错，点击时按老路径现场核
      }
    })()
    prefetchRef.current = p
    void p.then((r) => { readyRef.current = r })
  }, [])

  /** 组装跳转 URL 并跳转；storyId 为 null 时不带该参数，走通用分析 */
  const push = useCallback((qid: string, storyId: string | null): void => {
    const story = storyId ? `&storyId=${encodeURIComponent(storyId)}` : ''
    navigate(`/analysis?questionId=${encodeURIComponent(qid)}${story}&review=1`)
  }, [navigate])

  const gotoPractice = useCallback(async (qid: string): Promise<void> => {
    // 快路径：预取已就绪且该题命中 → 全同步，点击即跳，不闪加载态
    const ready = readyRef.current
    if (ready) {
      if (ready.loggedIn && ready.reviewCount >= IELTS_MONTHLY_LIMIT) { setReviewQuotaShown(true); return }
      const hit = ready.corpusByQuestion[qid]
      if (hit) { push(qid, hit); return }
      // 预取里没有这题（理论上 matched=true 必有）—— 现场再查一次，宁可等也不错跳
    }

    setPendingQid(qid)
    try {
      // 预取还在飞就 join 它；已失败（null）则退回逐次现场核，即 015021e 的原路径
      const pre = ready ?? await (prefetchRef.current ?? Promise.resolve(null))
      let storyId: string | null = null
      try {
        if (pre) {
          if (pre.loggedIn && pre.reviewCount >= IELTS_MONTHLY_LIMIT) { setReviewQuotaShown(true); return }
          storyId = pre.corpusByQuestion[qid] ?? null
        } else {
          const acct = await getAccount()
          const loggedIn = !!acct && !acct.isAnonymous && !!acct.email
          if (loggedIn) {
            const n = await countReviewPracticeThisMonth()
            if (n >= IELTS_MONTHLY_LIMIT) { setReviewQuotaShown(true); return }
          }
        }
        // listCorpusByQuestion 已按 high→mid→low 排序、同档新→旧，取首条即最贴合的语料
        if (!storyId) storyId = (await listCorpusByQuestion(qid))[0]?.id ?? null
      } catch { /* 静默：取不到语料就走通用分析 */ }
      push(qid, storyId)
    } finally {
      setPendingQid(null)
    }
  }, [push])

  const dismissReviewQuota = useCallback((): void => setReviewQuotaShown(false), [])

  return { reviewQuotaShown, dismissReviewQuota, pendingQid, gotoPractice }
}
