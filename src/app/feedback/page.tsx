/**
 * @module   FeedbackPage
 * @desc     反馈卡片 — 回顾本场 🔨 优化的句子，左滑跳过/右滑收藏进表达库
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, Heart } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import { StepBar } from '@/components/StepBar'
import FeedbackCard from '@/components/FeedbackCard'
import GradientButton from '@/components/GradientButton'
import { getSessionPolishes, clearSessionPolishes, addSavedPhrase, markTrialDone } from '@/lib/storage'
import type { SessionPolish } from '@/lib/types'

const partLabel = (p: 1 | 2 | 3) => `Part ${p}` as 'Part 1' | 'Part 2' | 'Part 3'

export default function FeedbackPage() {
  const router = useRouter()
  const [cards, setCards]      = useState<SessionPolish[]>([])
  const [index, setIndex]      = useState(0)
  const [savedCount, setSaved] = useState(0)
  const [loaded, setLoaded]    = useState(false)

  // 滑动手势状态
  const [offset, setOffset]     = useState(0)
  const [animated, setAnimated] = useState(false)
  const startXRef  = useRef(0)
  const isDragging = useRef(false)

  // 进页面读本场暂存；同时标记「免费一圈走完」给试用墙用
  useEffect(() => { setCards(getSessionPolishes()); setLoaded(true); markTrialDone() }, [])

  const total   = cards.length
  const current = cards[index]
  const done    = loaded && total > 0 && index >= total
  const today   = (() => { const d = new Date(); return `${d.getMonth() + 1}/${d.getDate()}` })()

  // 收尾时清掉本场暂存（避免返回重复）
  useEffect(() => { if (done) clearSessionPolishes() }, [done])

  const collect = () => {
    if (!current) return
    addSavedPhrase({ ...current, id: `${Date.now()}-${index}`, createdAt: new Date().toISOString() })
    setSaved(c => c + 1)
    setIndex(i => i + 1)
  }
  const skip = () => setIndex(i => i + 1)

  const dragStart = (x: number) => { startXRef.current = x; isDragging.current = true; setAnimated(false) }
  const dragMove  = (x: number) => { if (isDragging.current) setOffset(x - startXRef.current) }
  const dragEnd = () => {
    if (!isDragging.current) return
    isDragging.current = false
    setAnimated(true)
    setOffset(cur => {
      if (cur > 60)  { setTimeout(() => { collect(); setAnimated(false); setOffset(0) }, 180); return 500 }
      if (cur < -60) { setTimeout(() => { skip();    setAnimated(false); setOffset(0) }, 180); return -500 }
      setTimeout(() => setAnimated(false), 180)
      return 0
    })
  }

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col pb-[56px]">
      <TopBar
        title="反馈卡片"
        right={loaded && total > 0 && !done
          ? <span className="text-[13px] text-v2-text-muted">{Math.min(index + 1, total)} / {total}</span>
          : undefined}
      />
      <StepBar currentStep="practice" />

      <div className="flex-1 overflow-y-auto px-10 pt-6 pb-10 relative z-10">

        {/* 空态：这场没点过 🔨 */}
        {loaded && total === 0 && (
          <div className="flex flex-col items-center text-center pt-16 gap-3">
            <div className="text-[34px]">🌿</div>
            <p className="text-[15px] font-semibold text-v2-text-primary">这次没有要回顾的句子</p>
            <p className="text-[13px] text-v2-text-muted leading-relaxed max-w-[240px]">
              练习时点句子左上角的 🔨，就能把更好的表达攒到这里。
            </p>
            <GradientButton onClick={() => router.push('/')} className="mt-3 px-6 py-2.5 rounded-full text-[14px] font-medium">回首页</GradientButton>
          </div>
        )}

        {/* 完成态 */}
        {done && (
          <div className="flex flex-col items-center text-center pt-16 gap-3">
            <div className="text-[34px]">✨</div>
            <p className="text-[15px] font-semibold text-v2-text-primary">这次回顾完成啦</p>
            <p className="text-[13px] text-v2-text-muted leading-relaxed max-w-[240px]">
              你留下了 {savedCount} 句更好的表达，慢慢就攒成你自己的表达库。
            </p>
            <GradientButton onClick={() => router.push('/')} className="mt-3 px-6 py-2.5 rounded-full text-[14px] font-medium">回首页</GradientButton>
          </div>
        )}

        {/* 卡片回顾 */}
        {loaded && total > 0 && !done && current && (
          <>
            <div
              className="relative mb-5 select-none"
              style={{ transform: `translateX(${offset}px)`, transition: animated ? 'transform 0.2s ease' : 'none', cursor: 'grab' }}
              onTouchStart={e => dragStart(e.touches[0].clientX)}
              onTouchMove={e => dragMove(e.touches[0].clientX)}
              onTouchEnd={dragEnd}
              onMouseDown={e => dragStart(e.clientX)}
              onMouseMove={e => dragMove(e.clientX)}
              onMouseUp={dragEnd}
              onMouseLeave={dragEnd}
            >
              {/* 背景叠卡（还有下一张时显示） */}
              {index + 1 < total && (
                <div
                  className="absolute inset-0 bg-white rounded-[16px] shadow-sm"
                  style={{ transform: 'rotate(2.5deg) scale(0.96) translateY(8px)', opacity: 0.5, zIndex: 0 }}
                />
              )}

              <FeedbackCard
                part={partLabel(current.part)}
                originalSentence={current.original}
                aiOptimized={current.optimized}
                keywords={[]}
                date={today}
                compact
                className="relative shadow-[0_2px_12px_rgba(0,0,0,0.06)] z-10"
              />
            </div>

            <div className="flex items-center justify-center gap-3 mb-3">
              <span className="text-[12px] text-[#CCCCCC]">← 跳过</span>
              <span className="text-[12px] text-[#CCCCCC]">—</span>
              <span className="text-[12px] text-v2-text-muted">收藏 →</span>
            </div>

            <div className="flex gap-3 mb-4">
              <button
                onClick={skip}
                aria-label="跳过"
                className="btn-ghost flex-1 h-[48px] active:scale-[0.97] transition-transform duration-150"
              >
                <X size={15} className="text-[#CCCCCC]" />
              </button>
              <GradientButton onClick={collect} className="flex-1 h-[48px] flex items-center justify-center gap-2 rounded-full">
                <Heart size={16} className="text-v2-text-secondary" />
                <span className="text-[13px] font-semibold text-v2-text-secondary">收藏</span>
              </GradientButton>
            </div>

            <p className="text-[12px] text-[#CCCCCC] text-center">还有 {total - index - 1} 张卡片</p>
          </>
        )}
      </div>

      <div className="flex-shrink-0"><TabBar /></div>
    </div>
  )
}
