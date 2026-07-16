/**
 * @module   QuotaReached
 * @desc     月额度用完态 — 故事 / 雅思复练两个变体；CTA 按另一额度是否也用完动态显示。
 *           视觉规格沿用 EmptyState（Orb size=120 + 标题/副文 v2 token + 渐变描边胶囊 CTA）。
 * @author   LingoBridge
 * @created  2026-06-18
 */
'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Orb from '@/components/Orb'
import GradientButton from '@/components/GradientButton'
import { cn } from '@/lib/utils'
import { nextMonthFirstLabel } from '@/lib/date'
import { countCorpusThisMonth, STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { countReviewPracticeThisMonth, IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'

interface Props {
  /** story：故事月额度用完；ielts：雅思复练月额度用完；trial：匿名试用结束（引导注册，非月额度）。 */
  variant: 'story' | 'ielts' | 'trial'
  /** 浮层模式（盖在当前页之上时使用）。inline 时不传，直接铺在父容器里。 */
  asOverlay?: boolean
  /** asOverlay 时点遮罩/关闭逻辑（如取消触发的复练操作） */
  onClose?: () => void
  className?: string
}

export default function QuotaReached({ variant, asOverlay, onClose, className }: Props) {
  const router = useRouter()
  const [storyDone, setStoryDone] = useState(variant === 'story')
  const [reviewDone, setReviewDone] = useState(variant === 'ielts')

  // 异步核另一额度（决定要不要显示对侧 CTA）。仅月额度变体需要；trial 试用变体不涉及月额度，跳过。
  useEffect(() => {
    if (variant !== 'story' && variant !== 'ielts') return
    let cancelled = false
    void (async () => {
      try {
        if (variant === 'story') {
          const n = await countReviewPracticeThisMonth()
          if (!cancelled) setReviewDone(n >= IELTS_MONTHLY_LIMIT)
        } else {
          const n = await countCorpusThisMonth()
          if (!cancelled) setStoryDone(n >= STORY_MONTHLY_LIMIT)
        }
      } catch {
        /* 静默 — 默认按 variant 自身的状态展示 */
      }
    })()
    return () => { cancelled = true }
  }, [variant])

  // 「练雅思题」跳题库题目列表，让用户自选题目；复练拦截/计数由列表里"练习"按钮负责
  const handlePracticeIelts = () => router.push('/question-bank')

  // trial：匿名试用结束态，面向注册转化，与「月额度用完（10/10）」文案区分，避免误导匿名用户。
  const trialBody = (
    <div className={cn('flex flex-col items-center text-center px-6 py-10', className)}>
      <Orb size={120} pulse={false} />
      <p className="text-[15px] font-medium text-v2-text-primary mt-5">试用已完成</p>
      <p className="text-[13px] text-v2-text-secondary mt-2 max-w-[260px] leading-relaxed">
        注册账号，继续把你的故事变成雅思口语素材。
      </p>
      <div className="flex flex-col items-center gap-2.5 mt-5">
        <GradientButton
          onClick={() => router.push('/login')}
          className="px-6 py-2.5 rounded-full text-[14px] font-medium"
        >
          注册 / 登录
        </GradientButton>
      </div>
    </div>
  )

  const quotaBody = (
    <div className={cn('flex flex-col items-center text-center px-6 py-10', className)}>
      <Orb size={120} pulse={false} />
      <p className="text-[15px] font-medium text-v2-text-primary mt-5">本月额度已用完（10/10）</p>
      <p className="text-[13px] text-v2-text-secondary mt-2 max-w-[260px] leading-relaxed">
        {nextMonthFirstLabel()} 自动恢复 · 先去别处逛逛？
      </p>

      <div className="flex flex-col items-center gap-2.5 mt-5">
        {!reviewDone && (
          <GradientButton
            onClick={handlePracticeIelts}
            className="px-6 py-2.5 rounded-full text-[14px] font-medium"
          >
            练雅思题
          </GradientButton>
        )}
        {!storyDone && (
          <GradientButton
            onClick={() => router.push('/')}
            className="px-6 py-2.5 rounded-full text-[14px] font-medium"
          >
            讲个故事
          </GradientButton>
        )}
        <GradientButton
          onClick={() => router.push('/review')}
          className="px-6 py-2.5 rounded-full text-[14px] font-medium"
        >
          回顾词卡
        </GradientButton>
      </div>

      <p className="text-[13px] text-v2-text-muted mt-6">
        需要更多额度？添加开发者微信 <span className="text-v2-text-secondary font-medium">zyh202x</span>
      </p>
    </div>
  )

  const body = variant === 'trial' ? trialBody : quotaBody

  if (!asOverlay) return body

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[360px] bg-bg-surface rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] animate-fade-up"
      >
        {body}
      </div>
    </div>
  )
}
