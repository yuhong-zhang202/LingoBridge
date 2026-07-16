/**
 * @module   QuotaCard
 * @desc     「我的」页本月额度卡 — 实时展示故事链路 + 雅思复练当月用量（每次进页面读一次）
 * @author   LingoBridge
 * @created  2026-06-18
 */
'use client'
import { useEffect, useState } from 'react'
import Skeleton from '@/components/Skeleton'
import OfflineState from '@/components/OfflineState'
import { nextMonthFirstLabel } from '@/lib/date'
import { countCorpusThisMonth, STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { countReviewPracticeThisMonth, IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'

const SOFT_SM = '0 4px 16px -6px rgba(180,120,70,0.12), 0 1px 5px rgba(120,90,60,0.04)'

interface QuotaRowProps {
  label: string
  used: number
  limit: number
  fillClass: string
  loading: boolean
}

function QuotaRow({ label, used, limit, fillClass, loading }: QuotaRowProps) {
  const capped = Math.min(used, limit)
  const pct = limit > 0 ? Math.min(100, (capped / limit) * 100) : 0
  return (
    <div className="mt-3.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] text-v2-text-primary">{label}</span>
        {loading ? (
          <Skeleton className="w-12 h-3.5" />
        ) : (
          <span className="text-[14px] text-v2-text-secondary">
            <span className="font-semibold">{capped}</span>
            {' / '}
            {limit}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-2 w-full h-1.5 rounded-full" />
      ) : (
        <div className="mt-2 h-1.5 rounded-full bg-bg-muted overflow-hidden">
          <div className={`h-full rounded-full ${fillClass}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export default function QuotaCard(): JSX.Element {
  const [storyUsed, setStoryUsed]   = useState(0)
  const [reviewUsed, setReviewUsed] = useState(0)
  const [loading, setLoading]       = useState(true)
  const [failed, setFailed]         = useState(false)
  const [reloadKey, setReloadKey]   = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // 不再逐个 catch：任一失败即视为取数失败，便于离线兜底判断
        const [s, r] = await Promise.all([
          countCorpusThisMonth(),
          countReviewPracticeThisMonth(),
        ])
        if (cancelled) return
        setStoryUsed(s)
        setReviewUsed(r)
      } catch { if (!cancelled) setFailed(true) }   // 失败（含离线）
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [reloadKey])

  // 取数失败且离线：用品牌化离线兜底态替代额度卡
  if (failed && typeof navigator !== 'undefined' && !navigator.onLine) {
    return (
      <div className="mb-3">
        <OfflineState onRetry={() => { setFailed(false); setLoading(true); setReloadKey(k => k + 1) }} />
      </div>
    )
  }

  return (
    // 卡片常驻、额度数字加载中：aria-busy 随 loading 切换（加载完为 false）
    <div
      aria-busy={loading}
      className="bg-bg-surface rounded-[16px] px-4 pt-4 pb-[18px] mb-3"
      style={{ boxShadow: SOFT_SM }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-v2-text-secondary">本月额度</span>
        <span className="text-[12px] text-v2-text-muted">{nextMonthFirstLabel()} 重置</span>
      </div>
      <QuotaRow label="故事练习" used={storyUsed}  limit={STORY_MONTHLY_LIMIT} fillClass="bg-brand-primary-light" loading={loading} />
      <QuotaRow label="题目练习" used={reviewUsed} limit={IELTS_MONTHLY_LIMIT} fillClass="bg-brand-accent-light" loading={loading} />
    </div>
  )
}
