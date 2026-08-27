/**
 * @module   Chip
 * @desc     交互型胶囊按钮 — 可点击，gradient / ghost / default 三种样式，sm / md 两种尺寸。
 *           两个分支都显式 type="button"：默认 type 是 submit，放进 <form> 会误触发提交。
 * @author   LingoBridge
 * @created  2026-05-29
 */
'use client'
import type { ReactNode, MouseEventHandler } from 'react'
import { cn } from '@/lib/utils'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'

interface ChipProps {
  children: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
  active?: boolean
  variant?: 'gradient' | 'ghost' | 'default'
  size?: 'sm' | 'md'
  className?: string
  /** 透传给 button 的 aria-pressed（筛选/切换场景标注按压态）；不传 = undefined 不渲染该属性 */
  ariaPressed?: boolean
  /** 透传给 button 的 aria-label（同屏多颗同文字胶囊时用来区分，如「题目分析：<题面>」）；
   *  不传 = undefined 不渲染该属性，可访问名回落到 children 文本 */
  ariaLabel?: string
}

const SIZES = {
  sm: 'text-[0.6875rem] px-[10px] py-[3px]',
  md: 'text-[0.75rem] px-3.5 py-[5px]',
}
const BASE = 'rounded-full inline-flex items-center gap-1 transition-all duration-150 active:scale-[0.97]'

/**
 * 交互型胶囊按钮
 * @param children  按钮内容
 * @param onClick   点击回调（接收鼠标事件）
 * @param active    激活态（ghost 时切换为 gradient 样式）
 * @param variant   样式变体，默认 gradient
 * @param size      尺寸，默认 md（sm 用于紧凑动作 chip）
 * @param className 额外 class
 * @param ariaPressed 透传 aria-pressed（不传则不渲染该属性，对现有调用零影响）
 * @param ariaLabel 透传 aria-label（不传则不渲染该属性，对现有调用零影响）
 */
export default function Chip({ children, onClick, active, variant = 'gradient', size = 'md', className, ariaPressed, ariaLabel }: ChipProps) {
  const useGradient = variant === 'gradient' || (variant === 'ghost' && active)

  if (useGradient) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={ariaPressed}
        aria-label={ariaLabel}
        className={cn(BASE, SIZES[size], 'bg-white text-v2-text-secondary font-semibold', className)}
        style={GRADIENT_BORDER_STYLE}
      >
        {children}
      </button>
    )
  }

  const variantClass = variant === 'ghost'
    ? 'bg-transparent border border-neutral-border text-v2-text-muted'
    : 'bg-white border border-neutral-border text-v2-text-secondary'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ariaPressed}
      className={cn(BASE, SIZES[size], variantClass, className)}
    >
      {children}
    </button>
  )
}
