'use client'

interface Option {
  value: string
  label: string
}

interface ChipSelectProps {
  options: Option[]
  value: string
  onChange: (v: string) => void
}

export default function ChipSelect({ options, value, onChange }: ChipSelectProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-all duration-150 ${
            value === opt.value
              ? 'bg-brand-primary text-white shadow-sm'
              : 'bg-bg-muted text-v2-text-secondary border border-black/[0.07]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
