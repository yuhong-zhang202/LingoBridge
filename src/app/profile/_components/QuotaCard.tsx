/**
 * @module   QuotaCard
 * @desc     「我的」页本月额度卡 — 实时展示故事链路 + 雅思复练当月用量（每次进页面读一次）
 * @author   LingoBridge
 * @created  2026-06-18
 */
'use client'
import { useEffect, useState } from 'react'
import { countCorpusThisMonth, STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { countReviewPracticeThisMonth, IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'

const SOFT_SM = '0 4px 16px -6px rgba(180,120,70,0.12), 0 1px 5px rgba(120,90,60,0.04)'

/** 下月 1 日的本地短文案，如 "7 月 1 日"。 */
function nextMonthFirstLabel(): string {
  const d = new Date()
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  return `${next.getMonth() + 1} 月 ${next.getDate()} 日`
}

interface QuotaRowProps {
  label: string
  used: number
  limit: number
  fillClass: string
}

function QuotaRow({ label, used, limit, fillClass }: QuotaRowProps) {
  const capped = Math.min(used, limit)
  const pct = limit > 0 ? Math.min(100, (capped / limit) * 100) : 0
  return (
    <div className="mt-3.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] text-v2-text-primary">{label}</span>
        <span className="text-[14px] text-v2-text-secondary">
          <span className="font-semibold">{capped}</span>
          {' / '}
          {limit}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function QuotaCard(): JSX.Element {
  const [storyUsed, setStoryUsed]   = useState(0)
  const [reviewUsed, setReviewUsed] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [s, r] = await Promise.all([
          countCorpusThisMonth().catch(() => 0),
          countReviewPracticeThisMonth().catch(() => 0),
        ])
        if (cancelled) return
        setStoryUsed(s)
        setReviewUsed(r)
      } catch { /* 静默 — 失败按 0 显示 */ }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div
      className="bg-bg-surface rounded-[16px] px-4 pt-4 pb-[18px] mb-3"
      style={{ boxShadow: SOFT_SM }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-v2-text-secondary">本月额度</span>
        <span className="text-[12px] text-v2-text-muted">{nextMonthFirstLabel()} 重置</span>
      </div>
      <QuotaRow label="故事练习" used={storyUsed}  limit={STORY_MONTHLY_LIMIT} fillClass="bg-brand-primary-light" />
      <QuotaRow label="题目练习" used={reviewUsed} limit={IELTS_MONTHLY_LIMIT} fillClass="bg-brand-accent-light" />
    </div>
  )
}
