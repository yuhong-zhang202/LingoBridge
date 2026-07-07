/**
 * @module   IconButton
 * @desc     圆形无边框图标按钮 —— 沿用通知铃 idiom（透明底，hover 才填 bg-muted）。
 *           供素材库 tab 栏右侧「搜索 / 选择」等小动作复用，避免多处手抄 className 造成视觉漂移。
 * @author   LingoBridge
 * @created  2026-07-07
 */
'use client'
import type { LucideIcon } from 'lucide-react'

interface IconButtonProps {
  /** lucide 图标组件（如 Search、Trash2） */
  icon: LucideIcon
  onClick?: () => void
  /** 同时用于 aria-label 与 title（鼠标悬停提示） */
  label: string
  disabled?: boolean
  /** 外部微调（如断点隔离类） */
  className?: string
}

/**
 * 圆形无边框图标按钮
 * @param icon       lucide 图标组件
 * @param onClick    点击回调
 * @param label      无障碍标签 + tooltip 文案
 * @param disabled   禁用态（半透明且不可点）
 * @param className  追加类名
 */
export default function IconButton({ icon: Icon, onClick, label, disabled = false, className = '' }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`w-9 h-9 rounded-full grid place-items-center text-v2-text-muted hover:bg-bg-muted hover:text-v2-text-primary transition-colors disabled:opacity-50 disabled:pointer-events-none ${className}`}
    >
      <Icon size={18} />
    </button>
  )
}
