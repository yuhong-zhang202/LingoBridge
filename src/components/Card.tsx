/**
 * @module   Card
 * @desc     标准内容卡 — plain（白底+边框+阴影）/ gradient（渐变描边+阴影），圆角 16
 * @author   LingoBridge
 * @created  2026-06-16
 */
'use client'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'

interface CardProps {
  children: ReactNode
  variant?: 'plain' | 'gradient'
  className?: string
}

const SHADOW = 'shadow-[0_2px_12px_rgba(0,0,0,0.06)]'

/**
 * 标准内容卡
 * @param children  卡片内容
 * @param variant   plain（默认，描边卡）/ gradient（渐变描边强调卡）
 * @param className 额外 class（内边距、margin、布局等）
 */
export default function Card({ children, variant = 'plain', className }: CardProps) {
  if (variant === 'gradient') {
    return (
      <div className={cn('rounded-[16px]', SHADOW, className)} style={GRADIENT_BORDER_STYLE_FULL}>
        {children}
      </div>
    )
  }
  return (
    <div className={cn(
      'bg-white rounded-[16px] border border-black/[0.05]', SHADOW,
      className,
    )}>
      {children}
    </div>
  )
}
