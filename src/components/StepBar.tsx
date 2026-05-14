interface StepBarProps {
  currentStep: 'story' | 'article' | 'topic' | 'practice' | 'feedback'
}

const STEPS = [
  { key: 'story',    label: '故事' },
  { key: 'article',  label: '文章' },
  { key: 'topic',    label: '题目' },
  { key: 'practice', label: '练习' },
  { key: 'feedback', label: '反馈' },
]

export function StepBar({ currentStep }: StepBarProps) {
  const currentIndex = STEPS.findIndex(s => s.key === currentStep)

  return (
    <div className="flex items-center px-4 py-3">
      {STEPS.map((step, i) => {
        const isDone    = i < currentIndex
        const isCurrent = i === currentIndex
        const isLast    = i === STEPS.length - 1

        return (
          <div key={step.key} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
            <div className="flex flex-col items-center gap-[3px]">
              <div
                className={`
                  w-[8px] h-[8px] rounded-full transition-all duration-300
                  ${isDone    ? 'bg-[#D4875A]' : ''}
                  ${isCurrent ? 'bg-[#D4875A] ring-2 ring-[#D4875A]/30 ring-offset-1' : ''}
                  ${!isDone && !isCurrent ? 'bg-[#DDDDDD]' : ''}
                `}
              />
              <span
                className={`
                  text-[10px] whitespace-nowrap
                  ${isCurrent ? 'text-[#D4875A] font-semibold' : isDone ? 'text-[#D4875A]' : 'text-[#BBBBBB]'}
                `}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={`
                  flex-1 h-[1.5px] mx-1 mb-[14px] rounded-full transition-all duration-300
                  ${isDone ? 'bg-[#D4875A]' : 'bg-[#EEEEEE]'}
                `}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
