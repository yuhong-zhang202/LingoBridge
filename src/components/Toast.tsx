/**
 * @module   Toast
 * @desc     轻量浮层提示 — 底部弹出，3.5s 后自动消失
 * @author   LingoBridge
 * @created  2026-06-06
 */
'use client'
import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface Props {
  message: string | null
  onDismiss: () => void
  /** 自动消失延迟，默认 3500ms */
  duration?: number
}

/**
 * 浮层提示组件，fixed 定位，不影响页面布局
 * @param message   消息文本；null 时隐藏
 * @param onDismiss 消失回调（自动触发或点击触发）
 * @param duration  自动消失延迟毫秒
 */
export default function Toast({ message, onDismiss, duration = 3500 }: Props) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDismiss, duration)
    return () => clearTimeout(timer)
  }, [message, duration, onDismiss])

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 14 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onClick={onDismiss}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-48px)] max-w-[380px] bg-[#1A1A1A] text-white text-[13px] leading-snug rounded-[14px] px-4 py-3 text-center shadow-lg cursor-pointer"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
