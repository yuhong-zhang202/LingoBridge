import { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  bandColor?: string
}

export default function Card({ className, bandColor, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'relative bg-bg-surface rounded-[20px] border border-black/[0.05] shadow-[0_2px_12px_rgba(0,0,0,0.06)] overflow-hidden',
        className,
      )}
      {...props}
    >
      {bandColor && (
        <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ background: bandColor }} />
      )}
      {children}
    </div>
  )
}
