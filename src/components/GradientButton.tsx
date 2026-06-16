/**
 * @module   GradientButton
 * @desc     渐变描边操作按钮（CTA 级）— 统一渐变描边皮肤 + 文字色 + 按下回弹 + 禁用态；尺寸/形状/宽度由 className 决定
 * @author   LingoBridge
 * @created  2026-06-17
 */
'use client'
import type { ReactNode, MouseEventHandler } from 'react'
import { cn } from '@/lib/utils'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'

interface GradientButtonProps {
  children: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  className?: string
}

/**
 * 渐变描边操作按钮（CTA 级）
 * @param children  按钮内容（图标 + 文字）
 * @param onClick   点击回调
 * @param disabled  禁用态（自动降透明度）
 * @param className 尺寸/形状/宽度/字号/布局等（如 w-full px-6 py-3 rounded-full text-[14px] font-medium）
 */
export default function GradientButton({ children, onClick, disabled, className }: GradientButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={GRADIENT_BORDER_STYLE}
      className={cn(
        'text-v2-text-secondary transition-transform duration-150 active:scale-[0.97] disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  )
}
