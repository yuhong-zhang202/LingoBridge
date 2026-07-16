'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ---------------- GradientButton ---------------- */
interface GradientButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'soft' | 'ghost'
  size?: 'lg' | 'md' | 'sm'
}

export function GradientButton({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: GradientButtonProps) {
  const sizes = {
    lg: 'h-13 px-8 text-[15px]',
    md: 'h-11 px-6 text-sm',
    sm: 'h-9 px-4 text-[13px]',
  }
  return (
    <button
      className={cn(
        'relative inline-flex items-center justify-center gap-2 rounded-full font-semibold',
        'transition-all duration-150 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100',
        sizes[size],
        variant === 'ghost'
          ? 'text-ink2 hover:bg-fill'
          : 'grad-border bg-surface text-ink shadow-card hover:shadow-float',
        variant === 'soft' && 'grad-border-soft',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/* ---------------- Card ---------------- */
interface CardProps {
  gradient?: boolean
  className?: string
  children: ReactNode
}

export function Card({ gradient = false, className, children }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[16px] bg-surface shadow-card',
        gradient ? 'grad-border' : 'border border-border',
        className,
      )}
    >
      {children}
    </div>
  )
}

/* ---------------- Tag (non-clickable) ---------------- */
export function Tag({
  children,
  variant = 'green',
  className,
}: {
  children: ReactNode
  variant?: 'green' | 'gradient' | 'neutral'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium',
        variant === 'green' && 'border border-tag-border bg-tag-bg text-tag-text',
        variant === 'gradient' && 'grad-border bg-surface grad-text',
        variant === 'neutral' && 'bg-fill text-ink2',
        className,
      )}
    >
      {children}
    </span>
  )
}

/* ---------------- Chip (clickable) ---------------- */
export function Chip({
  children,
  active = false,
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  size?: 'md' | 'sm'
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium transition-all active:scale-[0.97]',
        size === 'md' ? 'h-9 px-4 text-xs' : 'h-7 px-3 text-[11px]',
        active
          ? 'grad-border bg-surface text-ink shadow-card'
          : 'border border-border bg-surface text-ink2 hover:border-brand-light hover:text-ink',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/* ---------------- StepBar ---------------- */
const STEPS = ['故事', '整理', '匹配', '分析', '练习'] as const
export type StepName = (typeof STEPS)[number]

export function StepBar({ current, className }: { current: StepName; className?: string }) {
  const idx = STEPS.indexOf(current)
  return (
    <div className={cn('flex items-center', className)}>
      {STEPS.map((step, i) => {
        const done = i < idx
        const active = i === idx
        return (
          <div key={step} className="flex items-center">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                  done && 'bg-brand text-surface',
                  active && 'bg-brand text-surface ring-4 ring-brand-light',
                  !done && !active && 'bg-fill text-ink3',
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  'text-[13px] font-medium',
                  done || active ? 'text-brand-dark' : 'text-ink3',
                )}
              >
                {step}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span
                className={cn('mx-3 h-px w-8 lg:w-12', i < idx ? 'bg-brand' : 'bg-border')}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
