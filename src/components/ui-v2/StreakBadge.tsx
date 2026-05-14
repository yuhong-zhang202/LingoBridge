interface StreakBadgeProps {
  days: number
}

export default function StreakBadge({ days }: StreakBadgeProps) {
  return (
    <div className="inline-flex items-center gap-1.5 bg-brand-primary-light px-3 py-1.5 rounded-full">
      <span className="text-[15px]">🔥</span>
      <span className="text-[13px] font-bold text-brand-primary-dark">
        {days} 天连续练习
      </span>
    </div>
  )
}
