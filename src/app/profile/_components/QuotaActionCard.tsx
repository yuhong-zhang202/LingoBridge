/**
 * @module   QuotaActionCard
 * @desc     常用操作区「本月额度」卡 — 卡内直接内联展示故事/题目练习两条迷你进度条与数字；点击打开详情弹窗
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { useEffect, useState } from 'react'
import Card from '@/components/Card'
import Skeleton from '@/components/Skeleton'
import { countCorpusThisMonth, STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { countReviewPracticeThisMonth, IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'

interface MiniBarProps {
  label: string
  used: number
  limit: number
  fillClass: string
  loading: boolean
}

function MiniBar({ label, used, limit, fillClass, loading }: MiniBarProps): JSX.Element {
  const capped = Math.min(used, limit)
  const pct = limit > 0 ? Math.min(100, (capped / limit) * 100) : 0
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] text-v2-text-secondary">{label}</span>
        {loading ? (
          <Skeleton className="w-9 h-3" />
        ) : (
          <span className="text-[12px] text-v2-text-muted">
            <b className="font-semibold text-v2-text-secondary">{capped}</b> / {limit}
          </span>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${fillClass}`} style={{ width: loading ? '0%' : `${pct}%` }} />
      </div>
    </div>
  )
}

/**
 * 本月额度卡（内联进度条）
 * @param onOpen 点击卡片打开额度详情弹窗
 * @sideEffect   挂载时并行读取当月故事/题目练习用量
 */
export default function QuotaActionCard({ onOpen }: { onOpen: () => void }): JSX.Element {
  const [storyUsed, setStoryUsed]   = useState(0)
  const [reviewUsed, setReviewUsed] = useState(0)
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [s, r] = await Promise.all([countCorpusThisMonth(), countReviewPracticeThisMonth()])
        if (!cancelled) { setStoryUsed(s); setReviewUsed(r) }
      } catch (err) {
        console.warn('[ProfilePage] 额度读取失败', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <button onClick={onOpen} className="text-left w-full h-full">
      <Card className="p-5 h-full flex flex-col transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]">
        <div className="flex items-center justify-between mb-3.5">
          <span className="text-[14px] font-semibold text-v2-text-primary">本月额度</span>
          <span className="text-[12px] text-v2-text-muted">详情 →</span>
        </div>
        <div className="flex flex-col gap-3 mt-auto">
          <MiniBar label="故事练习" used={storyUsed}  limit={STORY_MONTHLY_LIMIT} fillClass="bg-brand-primary" loading={loading} />
          <MiniBar label="题目练习" used={reviewUsed} limit={IELTS_MONTHLY_LIMIT} fillClass="bg-brand-accent"  loading={loading} />
        </div>
      </Card>
    </button>
  )
}
