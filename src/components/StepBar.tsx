export type StepKey = 'story' | 'restructure' | 'matching' | 'analysis' | 'practice'

interface StepBarProps {
  currentStep: StepKey
}

/** 核心链路 5 步（顺序即流程顺序）；桌面 FlowShellDesktop 顶部进度复用同一份数据与 key。 */
export const STEPS: { key: StepKey; label: string }[] = [
  { key: 'story',       label: '故事' },
  { key: 'restructure', label: '整理' },
  { key: 'matching',    label: '题目' },
  { key: 'analysis',    label: '分析' },
  { key: 'practice',    label: '练习' },
]

export function StepBar({ currentStep }: StepBarProps) {
  const currentIndex = STEPS.findIndex(s => s.key === currentStep)

  // 桌面端(lg:)收窄到与内容同宽并居中、放大圆点/文字；移动端保持原全宽紧凑样式不变。
  return (
    <div className="flex items-center px-4 py-3 lg:max-w-[1024px] lg:mx-auto lg:w-full lg:px-10 lg:pt-[30px] lg:pb-10">
      {STEPS.map((step, i) => {
        const isDone    = i < currentIndex
        const isCurrent = i === currentIndex
        const isLast    = i === STEPS.length - 1

        return (
          <div key={step.key} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
            {/* 桌面端：文字改绝对定位垂直脱离，圆点独占列高，连线自然与点心对齐 */}
            <div className="flex flex-col items-center gap-[3px] lg:relative">
              <div
                className={`
                  w-[8px] h-[8px] rounded-full transition-all duration-300 lg:w-[11px] lg:h-[11px]
                  ${isDone    ? 'bg-brand-primary' : ''}
                  ${isCurrent ? 'bg-brand-primary ring-2 ring-brand-primary/30 ring-offset-1 lg:ring-4' : ''}
                  ${!isDone && !isCurrent ? 'bg-[#DDDDDD]' : ''}
                `}
              />
              <span
                className={`
                  text-[10px] whitespace-nowrap lg:absolute lg:top-[16px] lg:left-1/2 lg:-translate-x-1/2 lg:text-[13px]
                  ${isCurrent ? 'text-brand-primary font-semibold' : isDone ? 'text-brand-primary' : 'text-text-4'}
                `}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={`
                  flex-1 h-[1.5px] mx-1 mb-[14px] rounded-full transition-all duration-300 lg:h-[2px] lg:mx-3 lg:mb-0
                  ${isDone ? 'bg-brand-primary' : 'bg-[#EEEEEE]'}
                `}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
