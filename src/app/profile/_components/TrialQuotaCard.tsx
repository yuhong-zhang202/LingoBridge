/**
 * @module   TrialQuotaCard
 * @desc     「我的」页匿名试用额度卡（只读）— 让匿名用户能在建满 1 条前后「二次确认」自己的额度口径。
 *           口径 = 服务端拦截口径（语料【总条数】≤ ANON_CORPUS_LIMIT），非注册用户的「当月/10」——
 *           两套口径混用正是 profile 显示「1/10」而建 1 条即被拦的病根，故此卡按总条数展示、并点明注册后升每月额度。
 *           视觉镜像同页 QuotaCard（rounded-16 + SOFT_SM + 进度条），仅数据源与口径不同。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { type JSX } from 'react'
import Skeleton from '@/components/Skeleton'
import { ANON_CORPUS_LIMIT } from '@/lib/constants'
import { STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { useCorpusCount } from '@/hooks/profile-data'

const SOFT_SM = '0 4px 16px -6px rgba(180,120,70,0.12), 0 1px 5px rgba(120,90,60,0.04)'

export default function TrialQuotaCard(): JSX.Element {
  // 总条数口径（listMyCorpus 全量长度）= 匿名拦截口径；不用当月计数（匿名试用是终身 1 条、非按月）。
  const { count, isLoading } = useCorpusCount()
  const used = Math.min(count, ANON_CORPUS_LIMIT)
  const pct = ANON_CORPUS_LIMIT > 0 ? Math.min(100, (used / ANON_CORPUS_LIMIT) * 100) : 0

  return (
    <div
      aria-busy={isLoading}
      className="bg-bg-surface rounded-[16px] px-4 pt-4 pb-[18px] mb-3"
      style={{ boxShadow: SOFT_SM }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[0.8125rem] font-medium text-v2-text-secondary">试用额度</span>
        <span className="text-[0.75rem] text-v2-text-muted">注册后每月 {STORY_MONTHLY_LIMIT} 次</span>
      </div>
      <div className="mt-3.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[0.875rem] text-v2-text-primary">免费试用</span>
          {isLoading ? (
            <Skeleton className="w-12 h-3.5" />
          ) : (
            <span className="text-[0.875rem] text-v2-text-secondary">
              <span className="font-semibold">{used}</span>
              {' / '}
              {ANON_CORPUS_LIMIT}
            </span>
          )}
        </div>
        {isLoading ? (
          <Skeleton className="mt-2 w-full h-1.5 rounded-full" />
        ) : (
          <div className="mt-2 h-1.5 rounded-full bg-bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-brand-primary-light" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}
