/**
 * @module   Toast
 * @desc     轻量浮层提示 — 底部弹出，3.5s 后自动消失（CSS 动效，无第三方动画库）
 * @author   LingoBridge
 * @created  2026-06-06
 */
'use client'
import { useEffect, useState } from 'react'

interface Props {
  message: string | null
  onDismiss: () => void
  /** 自动消失延迟，默认 3500ms */
  duration?: number
}

// 退出动画时长，与 globals.css 的 .toast-exit 一致
const EXIT_MS = 180

/**
 * 浮层提示组件，fixed 定位，不影响页面布局
 * @param message   消息文本；null 时隐藏
 * @param onDismiss 消失回调（自动触发或点击触发）
 * @param duration  自动消失延迟毫秒
 */
export default function Toast({ message, onDismiss, duration = 3500 }: Props) {
  // 本地保留正在退场的文本，等退出动画跑完再卸载（替代 framer-motion 的 AnimatePresence）
  const [shown, setShown] = useState<string | null>(message)
  const [exiting, setExiting] = useState(false)

  // message 出现 → 显示并复位；message 清空 → 触发退出动画
  useEffect(() => {
    if (message) {
      setShown(message)
      setExiting(false)
    } else if (shown) {
      setExiting(true)
      const t = setTimeout(() => setShown(null), EXIT_MS)
      return () => clearTimeout(t)
    }
  }, [message, shown])

  // 自动消失计时
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDismiss, duration)
    return () => clearTimeout(timer)
  }, [message, duration, onDismiss])

  if (!shown) return null

  return (
    <div
      role="alert"
      onClick={onDismiss}
      className={`fixed bottom-6 left-1/2 z-50 w-[calc(100%-48px)] max-w-[380px] bg-surface-inverse text-white text-[0.8125rem] leading-snug rounded-[14px] px-4 py-3 text-center shadow-lg cursor-pointer ${exiting ? 'toast-exit' : 'toast-enter'}`}
    >
      {shown}
    </div>
  )
}
