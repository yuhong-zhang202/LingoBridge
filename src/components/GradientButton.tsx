/**
 * @module   GradientButton
 * @desc     渐变描边操作按钮（CTA 级）— 统一渐变描边皮肤 + 文字色 + 按下回弹 + 禁用态；尺寸/形状/宽度由 className 决定
 * @author   LingoBridge
 * @created  2026-06-17
 */
'use client'
import type { ReactNode, MouseEventHandler } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'

interface GradientButtonProps {
  children: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  loading?: boolean
  className?: string
  /** 传了就渲染成 Next <Link>（支持 Cmd+click 新开），共用同一套皮肤；disabled/loading/onClick 属 button 语义，链接形态不适用 */
  href?: string
}

/**
 * 渐变描边操作按钮（CTA 级）
 * @param children  按钮内容（图标 + 文字）
 * @param onClick   点击回调（button 形态）
 * @param disabled  禁用态（自动降透明度，button 形态）
 * @param loading   请求中：自动禁用 + 显示 spinner + 吞掉重复 onClick（不传时行为与原来完全一致，button 形态）
 * @param className 尺寸/形状/宽度/字号/布局等（如 w-full px-6 py-3 rounded-full text-[0.875rem] font-medium）
 * @param href      传入则渲染为 <Link>（如「回首页」需 Cmd+click 新开），皮肤/文字色/active 回弹与 button 形态一致
 */
export default function GradientButton({ children, onClick, disabled, loading = false, className, href }: GradientButtonProps) {
  // button 与 link 两形态共用：皮肤 className + 内容（loading 时套 spinner）
  const classes = cn(
    'text-v2-text-secondary transition-transform duration-150 active:scale-[0.97] disabled:opacity-50',
    className,
  )
  const content = loading ? (
    // spinner 用 currentColor（text-v2-text-secondary），不内联色值
    <span className="inline-flex items-center justify-center gap-1.5">
      <Loader2 size={15} className="animate-spin" />
      {children}
    </span>
  ) : children

  // 链接形态：渲染 Next <Link>，支持 Cmd+click 新开；不承载 button 的 disabled/loading/onClick 语义
  if (href) {
    return (
      <Link href={href} style={GRADIENT_BORDER_STYLE} className={classes}>
        {content}
      </Link>
    )
  }

  return (
    <button
      onClick={loading ? undefined : onClick}
      disabled={disabled || loading}
      aria-busy={loading}
      style={GRADIENT_BORDER_STYLE}
      className={classes}
    >
      {content}
    </button>
  )
}
