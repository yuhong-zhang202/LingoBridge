/**
 * @module   ReviewPage
 * @desc     词组记忆卡复习页 — 加载到期卡片，翻卡 + 左右滑动评估，按 Leitner 排下次
 * @author   LingoBridge
 * @created  2026-06-12
 */
'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import FlashCard from '@/components/review/FlashCard'
import { listDueCards, gradeCard } from '@/lib/db/phrase-cards'
import type { PhraseCard } from '@/lib/types'

export default function ReviewPage(): JSX.Element {
  const router = useRouter()
  const [queue, setQueue] = useState<PhraseCard[]>([])
  const [current, setCurrent] = useState(0)
  const [total, setTotal] = useState(0)        // 初始到期数（小结用）
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const cards = await listDueCards()
        if (cancelled) return
        setQueue(cards)
        setTotal(cards.length)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败，请重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleGrade = useCallback((remembered: boolean): void => {
    const card = queue[current]
    if (!card) return
    void gradeCard(card, remembered).catch(() => {})         // 静默失败，不打断复习
    if (!remembered) setQueue(q => [...q, { ...card, box: 1 }])  // 没记住：排到队尾本轮再练（从第 1 格起）
    setCurrent(c => c + 1)
  }, [queue, current])

  const close = (): void => router.back()

  const done = !loading && !error && queue.length > 0 && current >= queue.length

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      {/* 顶栏：关闭 + 进度 */}
      <div className="relative z-10 lg:max-w-[640px] lg:w-full lg:mx-auto">
        <div className="flex items-center justify-between h-[52px] px-5">
          <button onClick={close} aria-label="关闭复习" className="w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center">
            <X size={15} className="text-v2-text-muted" />
          </button>
          {!loading && !error && queue.length > 0 && current < queue.length && (
            <span className="text-[13px] text-v2-text-muted">{current + 1} / {queue.length}</span>
          )}
        </div>
        {!loading && !error && queue.length > 0 && current < queue.length && (
          <div className="px-5">
            <div className="mt-1 h-1 rounded-full bg-bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${(current / queue.length) * 100}%`,
                  background: 'linear-gradient(90deg, rgba(212,135,90,0.9), rgba(123,166,153,0.9))',
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-10 relative z-10 flex flex-col lg:max-w-[640px] lg:w-full lg:mx-auto">
        {loading ? (
          <div className="flex-1 flex items-center justify-center"><EmptyState title="加载中…" orbSize={100} /></div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center"><EmptyState title="加载失败" subtitle={error} ctaLabel="返回" onCta={close} /></div>
        ) : queue.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState title="今天没有要复习的卡" subtitle="去词组收藏里把想记的词组「加入记忆卡片」，到期后会出现在这里" ctaLabel="返回" onCta={close} />
          </div>
        ) : done ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState title="复习完成 🎉" subtitle={`这轮过了 ${total} 张卡片`} ctaLabel="完成" onCta={close} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <FlashCard key={`${queue[current].id}-${current}`} card={queue[current]} onGrade={handleGrade} />
          </div>
        )}
      </div>
    </div>
  )
}
