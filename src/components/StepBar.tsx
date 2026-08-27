/**
 * @module   StepBar
 * @desc     移动端核心链路步骤条（纯展示、不可点）。步骤序列不再写死 5 步，改由 useFlowSteps
 *           按本次链路形态派生（语音/文字 × 故事流/雅思流，读不到标识则降级回全量 5 步）。
 *           步骤定义（STEPS / StepKey）与派生规则的真源在 `lib/flow-shape`。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useFlowSteps } from '@/hooks/useFlowSteps'
import type { StepKey } from '@/lib/flow-shape'

interface StepBarProps {
  currentStep: StepKey
}

export function StepBar({ currentStep }: StepBarProps) {
  const steps = useFlowSteps(currentStep)
  const currentIndex = steps.findIndex(s => s.key === currentStep)

  // 桌面端(lg:)收窄到与内容同宽并居中、放大圆点/文字；移动端保持原全宽紧凑样式不变。
  return (
    <div className="flex items-center px-4 py-3 lg:max-w-[1024px] lg:mx-auto lg:w-full lg:px-10 lg:pt-[30px] lg:pb-10">
      {steps.map((step, i) => {
        const isDone    = i < currentIndex
        const isCurrent = i === currentIndex
        const isLast    = i === steps.length - 1

        return (
          <div key={step.key} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
            {/* 桌面端：文字改绝对定位垂直脱离，圆点独占列高，连线自然与点心对齐 */}
            <div className="flex flex-col items-center gap-[3px] lg:relative">
              <div
                className={`
                  w-[8px] h-[8px] rounded-full transition-all duration-300 lg:w-[11px] lg:h-[11px]
                  ${isDone    ? 'bg-brand-primary' : ''}
                  ${isCurrent ? 'bg-brand-primary ring-2 ring-brand-primary/30 ring-offset-1 lg:ring-4' : ''}
                  ${!isDone && !isCurrent ? 'bg-neutral-track' : ''}
                `}
              />
              <span
                className={`
                  text-[0.625rem] whitespace-nowrap lg:absolute lg:top-[16px] lg:left-1/2 lg:-translate-x-1/2 lg:text-[0.8125rem]
                  ${isCurrent ? 'text-brand-primary font-semibold' : isDone ? 'text-brand-primary' : 'text-v2-text-muted'}
                `}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={`
                  flex-1 h-[1.5px] mx-1 mb-[14px] rounded-full transition-all duration-300 lg:h-[2px] lg:mx-3 lg:mb-0
                  ${isDone ? 'bg-brand-primary' : 'bg-neutral-line'}
                `}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
