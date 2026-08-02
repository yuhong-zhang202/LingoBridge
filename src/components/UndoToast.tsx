/**
 * @module   UndoToast
 * @desc     可撤销浮层提示 —— 右下角深色条，含「撤销」按钮，duration(默认 5s) 后自动 onDismiss。
 *           用于批量删除后的撤销窗口；与全局 Toast（底部居中、无操作按钮）分开，不改后者。
 * @author   LingoBridge
 * @created  2026-07-05
 */
'use client'
import { type JSX, useEffect, useRef } from 'react'

interface UndoToastProps {
  /** 提示文案，如「已删除 3 张卡片」 */
  message: string
  /** 点「撤销」回调 */
  onUndo: () => void
  /** duration 到期或需要收起时回调 */
  onDismiss: () => void
  /** 自动消失延迟，默认 5000ms */
  duration?: number
}

export default function UndoToast({ message, onUndo, onDismiss, duration = 5000 }: UndoToastProps): JSX.Element {
  // 用 ref 持有最新 onDismiss，定时只起一次、不因父级重渲染而重置
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(), duration)
    return () => clearTimeout(t)
  }, [duration])

  // role=status + aria-live：删除结果与 5s 撤销窗口需被读屏播报，否则该操作对 SR 用户完全静默
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-[14px] shadow-lg bg-v2-text-primary text-white"
    >
      <span className="text-[0.8125rem]">{message}</span>
      <button
        onClick={onUndo}
        className="text-[0.8125rem] font-medium text-brand-primary hover:opacity-80 transition-opacity"
      >
        撤销
      </button>
    </div>
  )
}
