/**
 * @module   Chip
 * @desc     交互型胶囊按钮 — 可点击，支持 gradient / ghost / default 三种样式
 * @author   LingoBridge
 * @created  2026-05-29
 */
'use client'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'

interface ChipProps {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  variant?: 'gradient' | 'ghost' | 'default'
  className?: string
}

const BASE = 'text-[12px] rounded-full inline-flex items-center gap-1 px-3.5 py-[5px] transition-all duration-150 active:scale-[0.97]'

/**
 * 交互型胶囊按钮
 * @param children  按钮内容
 * @param onClick   点击回调
 * @param active    激活态（ghost 时切换为 gradient 样式）
 * @param variant   样式变体，默认 gradient
 * @param className 额外 class
 */
export default function Chip({ children, onClick, active, variant = 'gradient', className }: ChipProps) {
  const useGradient = variant === 'gradient' || (variant === 'ghost' && active)

  if (useGradient) {
    return (
      <button
        onClick={onClick}
        className={cn(BASE, 'bg-white text-[#444] font-semibold', className)}
        style={GRADIENT_BORDER_STYLE}
      >
        {children}
      </button>
    )
  }

  const variantClass = variant === 'ghost'
    ? 'bg-transparent border border-[#E5E5E5] text-[#AAAAAA]'
    : 'bg-white border border-[#E5E5E5] text-[#444]'

  return (
    <button
      onClick={onClick}
      className={cn(BASE, variantClass, className)}
    >
      {children}
    </button>
  )
}
