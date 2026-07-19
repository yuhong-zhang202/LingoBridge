/**
 * @module   EmptyState
 * @desc     通用空状态组件 — Orb + 标题 + 可选副文本 + 可选 CTA 按钮
 * @author   LingoBridge
 * @created  2026-06-04
 */
'use client'
import { type JSX } from 'react'
import Orb from '@/components/Orb'
import GradientButton from '@/components/GradientButton'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title: string
  subtitle?: string
  ctaLabel?: string
  onCta?: () => void
  orbSize?: number
  className?: string
  /** 是否作为即时播报（role="alert"）。仅用于「操作被拒」类反馈（如配额用尽）；
   *  普通空列表不要传，否则读屏会在页面加载时无端播报「暂无内容」。 */
  alert?: boolean
}

/**
 * 空状态展示组件
 * @param title      主提示文案
 * @param subtitle   副提示文案（可选）
 * @param ctaLabel   行动按钮文案（可选，需与 onCta 配合）
 * @param onCta      行动按钮点击回调（可选）
 * @param orbSize    Orb 直径，默认 120
 * @param className  附加 class（如外部间距）
 * @param alert      true 时挂 role="alert" 即时播报（配额用尽等操作被拒场景）
 */
export default function EmptyState({
  title,
  subtitle,
  ctaLabel,
  onCta,
  orbSize = 120,
  className,
  alert,
}: EmptyStateProps): JSX.Element {
  return (
    <div role={alert ? 'alert' : undefined} className={cn('flex flex-col items-center text-center pt-16', className)}>
      <Orb size={orbSize} pulse={false} />
      <p className="text-[15px] font-medium text-v2-text-primary mt-5">{title}</p>
      {subtitle && (
        <p className="text-[13px] text-v2-text-secondary mt-2 max-w-[260px] leading-relaxed">
          {subtitle}
        </p>
      )}
      {ctaLabel && onCta && (
        <GradientButton onClick={onCta} className="mt-5 px-6 py-2.5 rounded-full text-[14px] font-medium">
          {ctaLabel}
        </GradientButton>
      )}
    </div>
  )
}
