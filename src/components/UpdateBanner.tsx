/**
 * @module   UpdateBanner
 * @desc     旧标签页检测 —— 构建时烘焙的 LATEST_VERSION 与 /api/version（线上部署版本）对比，
 *           线上更新时弹全站横幅「有新版本可用 · 刷新」。挂载 + window focus 时比对；
 *           可关闭，关闭后同一版本本会话不再弹，线上出现更新的版本可再现（不频繁 nag）。
 *           与 SwUpdatePrompt（SW 层检测，深色 toast）互补，位置错开避免重叠。
 * @author   LingoBridge
 * @created  2026-07-10
 */
'use client'
import { type JSX, useCallback, useEffect, useState } from 'react'
import { X, RefreshCw } from 'lucide-react'
import { LATEST_VERSION, isNewerVersion } from '@/lib/changelog'

export default function UpdateBanner(): JSX.Element | null {
  const [remote, setRemote] = useState<string | null>(null)
  // 记「关闭时的版本」而非布尔：同版本不再弹，更新的版本可再弹
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)

  const check = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { version?: unknown }
      if (typeof data.version === 'string') setRemote(data.version)
    } catch { /* 网络失败静默：横幅是增强，不打扰 */ }
  }, [])

  useEffect(() => {
    void check()
    const onFocus = () => { void check() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [check])

  const show =
    !!remote &&
    isNewerVersion(remote, LATEST_VERSION) &&
    (!dismissedFor || isNewerVersion(remote, dismissedFor))

  if (!show) return null

  return (
    // 移动端抬到 TabBar(56px) 之上；桌面 bottom-20 与 SwUpdatePrompt(bottom-6) 错开
    <div
      role="status"
      className="fixed bottom-[76px] lg:bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 pl-4 pr-1.5 py-1.5 bg-white border border-black/[0.08] rounded-full shadow-[0_6px_20px_rgba(0,0,0,0.10)] whitespace-nowrap"
    >
      <span className="text-[13px] text-v2-text-primary">有新版本可用</span>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-1 text-[13px] font-medium text-brand-primary-dark px-2 py-1 rounded-full hover:bg-bg-muted transition-colors"
      >
        <RefreshCw size={13} />刷新
      </button>
      <button
        onClick={() => setDismissedFor(remote)}
        aria-label="关闭"
        className="w-7 h-7 rounded-full grid place-items-center text-v2-text-muted hover:bg-bg-muted transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  )
}
