/**
 * @module   EmptyState
 * @desc     通用空状态组件 — Orb + 标题 + 可选副文本 + 可选 CTA 按钮
 * @author   LingoBridge
 * @created  2026-06-04
 */
'use client'
import Orb from '@/components/Orb'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title: string
  subtitle?: string
  ctaLabel?: string
  onCta?: () => void
  orbSize?: number
  className?: string
}

/**
 * 空状态展示组件
 * @param title      主提示文案
 * @param subtitle   副提示文案（可选）
 * @param ctaLabel   行动按钮文案（可选，需与 onCta 配合）
 * @param onCta      行动按钮点击回调（可选）
 * @param orbSize    Orb 直径，默认 120
 * @param className  附加 class（如外部间距）
 */
export default function EmptyState({
  title,
  subtitle,
  ctaLabel,
  onCta,
  orbSize = 120,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <div className={cn('flex flex-col items-center text-center pt-16', className)}>
      <Orb size={orbSize} pulse={false} />
      <p className="text-[15px] font-medium text-v2-text-primary mt-5">{title}</p>
      {subtitle && (
        <p className="text-[13px] text-v2-text-secondary mt-2 max-w-[260px] leading-relaxed">
          {subtitle}
        </p>
      )}
      {ctaLabel && onCta && (
        <button
          onClick={onCta}
          className="mt-5 px-6 py-2.5 rounded-full text-[14px] font-medium text-v2-text-secondary active:scale-[0.97] transition-transform duration-150"
          style={GRADIENT_BORDER_STYLE}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  )
}
