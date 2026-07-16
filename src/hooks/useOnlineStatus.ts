/**
 * @module   useOnlineStatus
 * @desc     在线/离线状态 hook — 监听 window 的 online/offline 事件；SSR/初始默认在线，
 *           挂载后用 navigator.onLine 校准，卸载时移除监听。
 * @author   LingoBridge
 * @created  2026-06-22
 */
'use client'
import { useEffect, useState } from 'react'

export function useOnlineStatus(): boolean {
  // SSR 与首帧默认在线，避免水合不一致；挂载后立刻校准真实状态
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    setIsOnline(navigator.onLine)
    const goOnline  = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return isOnline
}
