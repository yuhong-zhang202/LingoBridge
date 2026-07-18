/**
 * @module   FeedbackMobile
 * @desc     反馈卡片页移动端视图 —— 与拆分前 feedback/page.tsx 的渲染完全一致，仅改为接收 props 展示。
 *           卡片数据与交互逻辑（读取暂存/收藏/跳过/拖拽）统一由 page.tsx 外壳持有，本组件不含副作用。
 * @author   LingoBridge
 * @created  2026-07-04
 */
'use client'
import { type JSX, useEffect } from 'react'
import { X, Heart, Sparkles } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import { StepBar } from '@/components/StepBar'
import FeedbackCard from '@/components/FeedbackCard'
import GradientButton from '@/components/GradientButton'
import type { FeedbackViewProps } from './types'

const partLabel = (p: 1 | 2 | 3) => `Part ${p}` as 'Part 1' | 'Part 2' | 'Part 3'

export default function FeedbackMobile({
  loaded,
  total,
  index,
  savedCount,
  done,
  current,
  today,
  offset,
  animated,
  onDragStart,
  onDragMove,
  onDragEnd,
  onCollect,
  onSkip,
  onAllDone,
  onBackHome,
}: FeedbackViewProps): JSX.Element {
  // 本视图（index 模型）回顾完 → 通知外壳清场（真正清场在外壳，ref 守卫只清一次）
  useEffect(() => { if (done) onAllDone() }, [done, onAllDone])

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col pb-[56px] lg:pb-0">
      <TopBar
        title="反馈卡片"
        right={loaded && total > 0 && !done
          ? <span className="text-[13px] text-v2-text-muted">{Math.min(index + 1, total)} / {total}</span>
          : undefined}
      />
      <StepBar currentStep="practice" />

      <div className="flex-1 flex flex-col overflow-y-auto px-10 pt-6 pb-10 relative z-10 lg:max-w-xl lg:mx-auto lg:w-full">

        {/* 空态：这场没点过 ✨ 星标 */}
        {loaded && total === 0 && (
          <div className="flex flex-col items-center justify-center text-center flex-1 gap-3">
            <Sparkles size={34} className="text-brand-primary" />
            <p className="text-[15px] font-semibold text-v2-text-primary">这次没有要回顾的句子</p>
            <p className="text-[13px] text-v2-text-muted leading-relaxed max-w-[240px]">
              练习时点句子左上角的 ✨ 星标，就能把更好的表达攒到这里。
            </p>
            <GradientButton onClick={onBackHome} className="mt-3 px-6 py-2.5 rounded-full text-[14px] font-medium">回首页</GradientButton>
          </div>
        )}

        {/* 完成态 */}
        {done && (
          <div className="flex flex-col items-center justify-center text-center flex-1 gap-3">
            <div className="text-[34px]">✨</div>
            <p className="text-[15px] font-semibold text-v2-text-primary">这次回顾完成啦</p>
            <p className="text-[13px] text-v2-text-muted leading-relaxed max-w-[240px]">
              你留下了 {savedCount} 句更好的表达，慢慢就攒成你自己的表达库。
            </p>
            <GradientButton onClick={onBackHome} className="mt-3 px-6 py-2.5 rounded-full text-[14px] font-medium">回首页</GradientButton>
          </div>
        )}

        {/* 卡片回顾 */}
        {loaded && total > 0 && !done && current && (
          <>
            <div
              className="relative mb-5 select-none"
              style={{ transform: `translateX(${offset}px)`, transition: animated ? 'transform 0.2s ease' : 'none', cursor: 'grab' }}
              onTouchStart={e => onDragStart(e.touches[0].clientX)}
              onTouchMove={e => onDragMove(e.touches[0].clientX)}
              onTouchEnd={onDragEnd}
              onMouseDown={e => onDragStart(e.clientX)}
              onMouseMove={e => onDragMove(e.clientX)}
              onMouseUp={onDragEnd}
              onMouseLeave={onDragEnd}
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
              <span className="text-[12px] text-neutral-mute">← 跳过</span>
              <span className="text-[12px] text-neutral-mute">—</span>
              <span className="text-[12px] text-v2-text-muted">收藏 →</span>
            </div>

            <div className="flex gap-3 mb-4">
              <button
                onClick={onSkip}
                aria-label="跳过"
                className="btn-ghost flex-1 h-[48px] active:scale-[0.97] transition-transform duration-150"
              >
                <X size={15} className="text-neutral-mute" />
              </button>
              {/* 收藏 = 收藏当前卡（共享真源 onCollect）+ 前进到下一张（移动端导航 onSkip），行为与拆分前一致 */}
              <GradientButton onClick={() => { onCollect(current); onSkip() }} className="flex-1 h-[48px] flex items-center justify-center gap-2 rounded-full">
                <Heart size={16} className="text-v2-text-secondary" />
                <span className="text-[13px] font-semibold text-v2-text-secondary">收藏</span>
              </GradientButton>
            </div>

            <p className="text-[12px] text-neutral-mute text-center">还有 {total - index - 1} 张卡片</p>
          </>
        )}
      </div>

      {/* 流程页桌面端沉浸：隐藏侧栏 */}
      <div className="flex-shrink-0 lg:hidden"><TabBar /></div>
    </div>
  )
}
