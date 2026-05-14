interface StepProgressProps {
  steps: string[]
  current: number
}

export default function StepProgress({ steps, current }: StepProgressProps) {
  return (
    <div className="flex items-start px-6 py-3">
      {steps.map((label, i) => {
        const done = i < current
        const active = i === current
        const isLast = i === steps.length - 1
        return (
          <div key={i} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-[8px] h-[8px] rounded-full transition-all ${
                  done
                    ? 'bg-brand-primary'
                    : active
                    ? 'bg-brand-primary ring-2 ring-brand-primary-light ring-offset-1'
                    : 'bg-[#E0DADA]'
                }`}
              />
              <span
                className={`text-[9px] font-medium whitespace-nowrap ${
                  active ? 'text-brand-primary' : done ? 'text-v2-text-secondary' : 'text-v2-text-muted'
                }`}
              >
                {label}
              </span>
            </div>
            {!isLast && (
              <div
                className={`flex-1 h-[1px] mx-1 mb-4 ${done ? 'bg-brand-primary' : 'bg-[#E0DADA]'}`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
