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
  /** CTA 视觉层级。默认 'pill'（渐变描边胶囊，主要动作）；
   *  'text' 为纯文本按钮（次要动作），用于 429 日熔断这类「CTA 只是退路、不是主推」的场景。
   *  两者都是原生 <button>：可 Tab 聚焦（焦点环走全局 :focus-visible）、命中区均 ≥44px。 */
  ctaVariant?: 'pill' | 'text'
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
 * @param ctaVariant CTA 视觉层级：'pill' 胶囊（默认，主要动作）/ 'text' 文本按钮（次要动作）
 */
export default function EmptyState({
  title,
  subtitle,
  ctaLabel,
  onCta,
  orbSize = 120,
  className,
  alert,
  ctaVariant = 'pill',
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
        ctaVariant === 'text' ? (
          // 次要动作：纯文本按钮。样式沿用站内既有文本按钮规格（见 MatchingMobile 的「查看更多」toggle），
          // min-h-[44px] 保证触控命中区达 WCAG 2.5.5，原生 <button> 保留键盘可聚焦。
          <button
            onClick={onCta}
            className="mt-2 min-h-[44px] inline-flex items-center justify-center px-3 text-[13px] font-medium text-brand-primary-dark active:opacity-60"
          >
            {ctaLabel}
          </button>
        ) : (
          <GradientButton onClick={onCta} className="mt-5 px-6 py-2.5 rounded-full text-[14px] font-medium">
            {ctaLabel}
          </GradientButton>
        )
      )}
    </div>
  )
}
