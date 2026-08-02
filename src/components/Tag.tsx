/**
 * @module   Tag
 * @desc     展示型标签组件 — 不可点击，支持 green / gradient / gray 三种样式
 * @author   LingoBridge
 * @created  2026-05-29
 */
'use client'
import type { ReactNode, CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { BRAND_GRADIENT_SOFT } from '@/lib/constants'

interface TagProps {
  label: string
  variant?: 'green' | 'gradient' | 'gray'
  icon?: ReactNode
  className?: string
}

const GRAD_TEXT: CSSProperties = {
  background: 'linear-gradient(135deg, #D4875A, #7BA699)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
}

/**
 * 展示型标签
 * @param label    标签文字
 * @param variant  样式变体，默认 green
 * @param icon     可选前置图标
 * @param className 额外 class
 */
export default function Tag({ label, variant = 'green', icon, className }: TagProps) {
  if (variant === 'gradient') {
    return (
      <div
        className={cn('inline-flex', className)}
        style={{ background: BRAND_GRADIENT_SOFT, padding: 1, borderRadius: 999 }}
      >
        <div
          className="inline-flex items-center gap-1.5 bg-white"
          style={{ borderRadius: 999, padding: '5px 10px' }}
        >
          {icon}
          <span className="text-[0.6875rem] font-medium leading-none" style={GRAD_TEXT}>{label}</span>
        </div>
      </div>
    )
  }

  const variantClass = variant === 'gray'
    ? 'bg-transparent border border-neutral-border text-v2-text-muted'
    : 'bg-tag-success-bg border border-tag-success-border text-tag-success-text'

  return (
    <span className={cn(
      'text-[0.6875rem] font-medium rounded-full inline-flex items-center gap-1.5 px-[10px] py-[5px]',
      variantClass,
      className,
    )}>
      {icon}
      {label}
    </span>
  )
}
