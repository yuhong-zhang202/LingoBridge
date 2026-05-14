'use client'
import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'lg' | 'md' | 'sm'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
}

const variantStyles: Record<Variant, string> = {
  primary:   'bg-brand-primary text-white shadow-sm active:bg-brand-primary-dark',
  secondary: 'bg-brand-accent text-white shadow-sm active:opacity-90',
  ghost:     'bg-transparent border border-black/[0.12] text-v2-text-secondary active:opacity-60',
  danger:    'bg-[#C4605A] text-white active:opacity-90',
}

const sizeStyles: Record<Size, string> = {
  lg: 'h-[52px] px-6 text-[15px] font-semibold rounded-[14px]',
  md: 'h-[42px] px-5 text-[14px] font-semibold rounded-[12px]',
  sm: 'h-[32px] px-4 text-[12px] font-medium rounded-[9px]',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', fullWidth, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer select-none',
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    />
  )
)
Button.displayName = 'Button'
export default Button
