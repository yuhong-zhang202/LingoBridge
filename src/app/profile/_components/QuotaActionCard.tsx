/**
 * @module   QuotaActionCard
 * @desc     常用操作区「本月额度」卡 — 卡内直接内联展示故事/题目练习两条迷你进度条与数字；点击打开详情弹窗
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { type JSX } from 'react'
import Card from '@/components/Card'
import Skeleton from '@/components/Skeleton'
import { STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'
import { useQuota } from '@/hooks/profile-data'
import { useAccount } from '@/hooks/useAccount'
import { isInternalAccount } from '@/lib/internal-accounts'

interface MiniBarProps {
  label: string
  used: number
  limit: number
  fillClass: string
  loading: boolean
  /** 内部账户：不受额度约束，显示「不限」并隐藏进度填充 */
  unlimited?: boolean
}

function MiniBar({ label, used, limit, fillClass, loading, unlimited = false }: MiniBarProps): JSX.Element {
  const capped = Math.min(used, limit)
  const pct = unlimited ? 0 : (limit > 0 ? Math.min(100, (capped / limit) * 100) : 0)
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[0.75rem] text-v2-text-secondary">{label}</span>
        {loading ? (
          <Skeleton className="w-9 h-3" />
        ) : unlimited ? (
          <span className="text-[0.75rem] text-v2-text-secondary font-semibold">不限</span>
        ) : (
          <span className="text-[0.75rem] text-v2-text-muted">
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
  // SWR 缓存去重（key 'profile:quota'）；出错时用量默认 0，与原 catch 降级一致
  const { story: storyUsed, review: reviewUsed, isLoading: loading } = useQuota()
  const { account } = useAccount()
  const unlimited = isInternalAccount(account?.id)

  return (
    // 卡片常驻、额度数字加载中：aria-busy 随 loading 切换（加载完为 false，读屏停止「忙碌」）
    <button onClick={onOpen} aria-busy={loading} className="text-left w-full h-full">
      <Card className="p-5 h-full flex flex-col transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]">
        <div className="flex items-center justify-between mb-3.5">
          <span className="text-[0.875rem] font-semibold text-v2-text-primary">本月额度</span>
          <span className="text-[0.75rem] text-v2-text-muted">详情 →</span>
        </div>
        <div className="flex flex-col gap-3 mt-auto">
          <MiniBar label="故事练习" used={storyUsed}  limit={STORY_MONTHLY_LIMIT} fillClass="bg-brand-primary" loading={loading} unlimited={unlimited} />
          <MiniBar label="题目练习" used={reviewUsed} limit={IELTS_MONTHLY_LIMIT} fillClass="bg-brand-accent"  loading={loading} unlimited={unlimited} />
        </div>
      </Card>
    </button>
  )
}
