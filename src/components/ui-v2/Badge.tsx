import { cn } from '@/lib/utils'

type Variant = 'band' | 'hot' | 'success' | 'neutral'

interface BadgeProps {
  variant?: Variant
  label: string
  className?: string
}

const styles: Record<Variant, string> = {
  band:    'bg-brand-primary-light text-brand-primary-dark',
  hot:     'bg-brand-accent-light text-brand-accent',
  success: 'bg-[rgba(91,160,138,0.12)] text-[#5BA08A]',
  neutral: 'bg-bg-muted text-v2-text-muted',
}

export default function Badge({ variant = 'neutral', label, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium',
        styles[variant],
        className,
      )}
    >
      {label}
    </span>
  )
}
