/**
 * @module   FlowShellDesktop
 * @desc     桌面端核心链路统一外壳 —— 全沉浸版式：顶部极简进度栏（品牌左 · 5 点进度+当前步名居中 · 退出右）
 *           + 下方居中舞台区。无左侧面板、无边框分隔，整页同底色，让柔和的 Orb 舞台成为唯一主角。
 *           6 个流程页的桌面视图统一包在此壳内，进度由 activeStep 驱动。
 *           进度点的【条数】不再写死 5：与移动端 StepBar 同源，按本次链路形态派生（useFlowSteps），
 *           读不到形态标识时降级回全量 5 步。
 * @author   LingoBridge
 * @created  2026-07-04
 */
'use client'
import type { JSX, ReactNode } from 'react'
import ProgressLink from '@/components/ProgressLink'
import { Mic, X, ChevronLeft } from 'lucide-react'
import { useFlowSteps } from '@/hooks/useFlowSteps'
import type { StepKey } from '@/lib/flow-shape'
import FeedbackButton from '@/components/FeedbackButton'

interface FlowShellDesktopProps {
  /** 当前激活步骤 */
  activeStep: StepKey
  /** 点击退出（顶栏 ✕） */
  onExit: () => void
  /** 可选：返回上一步回调。提供时在品牌后显示「返回上一步」按钮；write 步无上一步、不传即不显示。 */
  onBack?: () => void
  /** 返回按钮文案与无障碍标签（如「返回整理」「返回题目」），随流向指向具体目标 */
  backLabel?: string
  /** 是否在退出 ✕ 左侧显示反馈药丸；默认 false 维持沉浸。仅 matching/analysis 传 true 补情境反馈缺口。 */
  showFeedback?: boolean
  /** 舞台内容 */
  children: ReactNode
}

export default function FlowShellDesktop({
  activeStep,
  onExit,
  onBack,
  backLabel = '返回上一步',
  showFeedback = false,
  children,
}: FlowShellDesktopProps): JSX.Element {
  const steps = useFlowSteps(activeStep)
  const activeIndex = steps.findIndex(s => s.key === activeStep)
  const current = steps[activeIndex]

  return (
    <div className="min-h-screen bg-bg-page flex flex-col">
      {/* 顶部极简进度栏（无边框，与舞台同底色，沉浸无缝） */}
      <header className="relative h-[72px] shrink-0 flex items-center justify-between px-8">
        {/* 左侧：品牌（点击回首页）+ 可选「返回上一步」 */}
        <div className="flex items-center gap-3">
          <ProgressLink href="/" className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-[10px] bg-brand-primary grid place-items-center text-white">
              <Mic size={18} />
            </span>
            <span className="text-[1.0625rem] font-bold tracking-tight text-v2-text-primary">LingoBridge</span>
          </ProgressLink>
          {onBack && (
            <button
              onClick={onBack}
              aria-label={backLabel}
              className="inline-flex items-center gap-1 h-11 px-2.5 rounded-lg text-[0.8125rem] font-medium text-v2-text-secondary hover:text-v2-text-primary hover:bg-bg-muted transition-colors"
            >
              <ChevronLeft size={16} />
              <span>{backLabel}</span>
            </button>
          )}
        </div>

        {/* 进度：本次链路的各步（当前为拉长胶囊）+ 当前步名，绝对居中 */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-5">
          <div className="flex items-center gap-[14px]" aria-hidden="true">
            {steps.map((s, i) => {
              const isActive = i === activeIndex
              const isDone   = i < activeIndex
              return (
                <span
                  key={s.key}
                  className={
                    `h-[7px] rounded-full transition-[width,background-color] duration-300 ` +
                    (isActive
                      ? 'w-[26px] bg-brand-primary'
                      : isDone
                        ? 'w-[7px] bg-brand-primary'
                        : 'w-[7px] bg-neutral-track')
                  }
                />
              )
            })}
          </div>
          <span className="text-[0.8125rem] font-semibold text-v2-text-primary">
            <span className="sr-only">第 {activeIndex + 1} 步，共 {steps.length} 步：</span>
            {current?.label}
          </span>
        </div>

        {/* 右端：可选反馈药丸（matching/analysis）+ 退出 ✕ */}
        <div className="flex items-center gap-3">
          {showFeedback && <FeedbackButton />}
          <button
            onClick={onExit}
            aria-label="退出练习"
            className="w-9 h-9 rounded-full grid place-items-center text-v2-text-secondary hover:bg-bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* 舞台内容区 */}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}
