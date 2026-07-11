/**
 * @module   SwUpdatePrompt
 * @desc     检测到 waiting 中的新版 SW 时，底部弹常驻「有新版本，点此刷新」条；
 *           点击后通知 SW skipWaiting，controllerchange 时自动 reload（不打断当前操作）。
 * @author   LingoBridge
 * @created  2026-06-21
 */
'use client'
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

export default function SwUpdatePrompt() {
  // 检测到新版在 waiting 时存有其 registration，据此渲染提示条
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.getRegistration().then((r) => {
      if (!r) return
      if (r.waiting) setReg(r)                              // 已有新版在等待
      r.addEventListener('updatefound', () => {
        const nw = r.installing
        nw?.addEventListener('statechange', () => {
          // 新 SW 安装完成、且当前已有 controller（非首次安装）→ 说明是一次更新
          if (nw.state === 'installed' && navigator.serviceWorker.controller) setReg(r)
        })
      })
    })

    // 新 SW 接管后整页刷新一次，加载最新外壳
    let reloaded = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    })
  }, [])

  const handleRefresh = () => {
    reg?.waiting?.postMessage({ type: 'SKIP_WAITING' })
  }

  if (!reg) return null

  return (
    <button
      type="button"
      onClick={handleRefresh}
      className="toast-enter fixed bottom-6 left-1/2 z-50 w-[calc(100%-48px)] max-w-[380px] bg-surface-inverse text-white text-[13px] leading-snug rounded-[14px] px-4 py-3 shadow-lg cursor-pointer flex items-center justify-center gap-2"
    >
      <RefreshCw size={14} />
      有新版本，点此刷新
    </button>
  )
}
