/**
 * @module   useSwitchQuestion
 * @desc     首页雅思切换题 hook — 从 /api/questions?mode=switch 取题，去重 + 循环
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { useState, useCallback } from 'react'
import type { SwitchQuestion } from '@/lib/types'

interface UseSwitchQuestionResult {
  question: SwitchQuestion | null
  loading: boolean
  error: string | null
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
  const [seenIds, setSeenIds] = useState<string[]>([])

  const next = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const exclude = seenIds.join(',')
      const url = `/api/questions?mode=switch${exclude ? `&exclude=${encodeURIComponent(exclude)}` : ''}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('请求失败')
      const data = (await res.json()) as { question: SwitchQuestion | null }

      let q = data.question

      // 池子空了（都看过）→ 不带 exclude 重新取一道，重置循环
      if (!q && seenIds.length > 0) {
        const res2 = await fetch('/api/questions?mode=switch')
        const data2 = (await res2.json()) as { question: SwitchQuestion | null }
        q = data2.question
        setSeenIds(q ? [q.id] : [])
      } else if (q) {
        setSeenIds((prev) => [...prev, q!.id])
      }

      setQuestion(q)
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取题目失败')
    } finally {
      setLoading(false)
    }
  }, [seenIds])

  return { question, loading, error, next }
}
