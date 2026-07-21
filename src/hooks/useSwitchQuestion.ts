/**
 * @module   useSwitchQuestion
 * @desc     首页雅思切换题 hook — 从 /api/questions?mode=switch 取题，去重 + 循环
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { useState, useCallback } from 'react'
import type { SwitchQuestion } from '@/lib/types'
import { apiFetch } from '@/lib/api-client'

interface UseSwitchQuestionResult {
  question: SwitchQuestion | null
  loading: boolean
  error: string | null
  /** 抽题池已抽空（当季所有「没练过」的题都取过了）——用于首页展示空态文案，而非空白题卡 */
  exhausted: boolean
  /** 取下一道题（自动排除已看过的；一轮看完后重置循环） */
  next: () => Promise<void>
}

/**
 * 首页雅思切换题 hook
 * @returns 当前题目、加载态、错误信息、取下一题的方法
 */
export function useSwitchQuestion(): UseSwitchQuestionResult {
  const [question, setQuestion] = useState<SwitchQuestion | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exhausted, setExhausted] = useState(false)
  const [seenIds, setSeenIds] = useState<string[]>([])

  const next = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    setExhausted(false)
    try {
      const exclude = seenIds.join(',')
      const url = `/api/questions?mode=switch${exclude ? `&exclude=${encodeURIComponent(exclude)}` : ''}`
      // apiFetch 带上当前 session 的 Bearer 头，服务端据此永久排除该用户已练过的题
      const res = await apiFetch(url)
      if (!res.ok) throw new Error('请求失败')
      const data = (await res.json()) as { question: SwitchQuestion | null }

      let q = data.question

      // 本会话已看过的都看完了 → 不带 exclude 重新取一道，重置「本会话」循环
      // （服务端仍会按 token 排除「已练过」的题，故重置只重置本会话去重、不会重现已练题）
      if (!q && seenIds.length > 0) {
        const res2 = await apiFetch('/api/questions?mode=switch')
        const data2 = (await res2.json()) as { question: SwitchQuestion | null }
        q = data2.question
        setSeenIds(q ? [q.id] : [])
      } else if (q) {
        setSeenIds((prev) => [...prev, q!.id])
      }

      setQuestion(q)
      // 两次取题（带 exclude + 重置重取）后仍为 null = 当季没练过的题都取光了 → 空态
      setExhausted(!q)
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取题目失败')
    } finally {
      setLoading(false)
    }
  }, [seenIds])

  return { question, loading, error, exhausted, next }
}
