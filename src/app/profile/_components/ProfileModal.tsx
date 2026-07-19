/**
 * @module   ProfileModal
 * @desc     「我的」页弹窗统一外壳 — 半透明遮罩 + 居中 Card + 标题行 + 关闭按钮；点击遮罩关闭。
 *           无障碍（对齐 ConfirmDialog 的 dialog 实现）：role="dialog" + aria-modal + aria-labelledby、
 *           Esc 关闭（捕获阶段拦截）、Tab 焦点陷阱、打开焦点入弹窗 / 关闭归还触发元素、body 滚动锁。
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { type JSX, useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import Card from '@/components/Card'
import { cn } from '@/lib/utils'

/** 焦点陷阱的可聚焦元素选择器（弹窗内容无隐藏可聚焦项，不做可见性过滤） */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ProfileModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** 宽度约束 class，默认 max-w-[380px] */
  className?: string
}

/**
 * 弹窗外壳
 * @param title     弹窗标题（兼作 aria-labelledby 目标）
 * @param onClose   关闭回调（遮罩点击 / 关闭按钮 / Esc）
 * @param children  弹窗主体内容
 * @param className 宽度约束 class
 * @sideEffect      打开时监听 Esc/Tab、锁定 body 滚动、移入初始焦点；关闭时焦点归还触发元素
 */
export default function ProfileModal({ title, onClose, children, className }: ProfileModalProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  // 监听只订阅一次；用 ref 持最新 onClose，父组件传内联箭头函数也不会反复重挂监听/焦点
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Esc 关闭 + Tab 焦点陷阱 + 初始焦点/焦点归还。
  // Esc 用捕获阶段 + stopImmediatePropagation（对齐 ConfirmDialog）：先于并拦截外层页面级 Esc 监听。
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    // 记录触发元素；初始焦点移入弹窗容器（tabIndex=-1 程序聚焦，不触发键盘焦点环）
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      // Tab/Shift+Tab 在弹窗内循环；焦点意外落到弹窗外时也拉回环内
      const nodes = dialog.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (nodes.length === 0) { e.preventDefault(); dialog.focus(); return }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) { e.preventDefault(); last.focus() }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault(); first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      // 关闭时焦点归还触发元素（若已被卸载则跳过）
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])

  // 打开时锁定 body 滚动（对齐 ConfirmDialog；卸载恢复原值，嵌套弹窗按 LIFO 正确还原）
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn('w-full outline-none', className ?? 'max-w-[380px]')}
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="px-6 pt-5 pb-6 animate-fade-up">
          <div className="flex items-center justify-between mb-5">
            <h2 id={titleId} className="text-[16px] font-semibold text-v2-text-primary">{title}</h2>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="text-v2-text-muted hover:text-v2-text-primary transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          {children}
        </Card>
      </div>
    </div>
  )
}
