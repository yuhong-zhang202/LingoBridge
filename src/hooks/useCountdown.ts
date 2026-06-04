/**
 * @module   useCountdown
 * @desc     验证码倒计时 hook — useState + setInterval，卸载时自动清除定时器
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { useState, useRef, useCallback, useEffect } from 'react'

interface UseCountdownReturn {
  /** 剩余秒数（0 表示未启动或已结束） */
  count: number
  /** 是否正在倒计时 */
  running: boolean
  /** 启动倒计时 @param seconds 总秒数 */
  start: (seconds: number) => void
}

/**
 * 倒计时 hook
 * @returns  { count, running, start }
 * @sideEffect  卸载时自动 clearInterval
 */
export function useCountdown(): UseCountdownReturn {
  const [count, setCount] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const start = useCallback((seconds: number) => {
    stop()
    setCount(seconds)
    intervalRef.current = setInterval(() => {
      setCount(s => (s <= 1 ? 0 : s - 1))
    }, 1000)
  }, [stop])

  // count 归零时自动停止定时器
  useEffect(() => {
    if (count === 0) stop()
  }, [count, stop])

  // 卸载时清除定时器
  useEffect(() => () => { stop() }, [stop])

  return { count, running: count > 0, start }
}
