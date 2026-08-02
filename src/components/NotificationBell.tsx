/**
 * @module   NotificationBell
 * @desc     顶栏通知铃铛 —— 点击开合「更新日志」弹出面板（列出 CHANGELOG 各条）；
 *           有未读新版本时铃铛亮红点（localStorage lingobridge:last-seen-version 判断），
 *           打开面板即记为已读。Esc（捕获拦截）/点面板外关闭，焦点开入面板、关归还铃铛。
 * @author   LingoBridge
 * @created  2026-07-10
 */
'use client'
import { type JSX, useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { CHANGELOG, LATEST_VERSION, isNewerVersion } from '@/lib/changelog'

const SEEN_KEY = 'lingobridge:last-seen-version'

export default function NotificationBell(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const bellRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 红点初始化（localStorage 只能在客户端读，放 effect 避免 hydration 失配）：
  // 无存储值 = 新用户 → 不提示、写入当前版本；有存储值且当前版本更新 → 亮红点
  useEffect(() => {
    const seen = localStorage.getItem(SEEN_KEY)
    if (!seen) {
      localStorage.setItem(SEEN_KEY, LATEST_VERSION)
      return
    }
    if (isNewerVersion(LATEST_VERSION, seen)) setHasUnread(true)
  }, [])

  function toggle(): void {
    if (open) { setOpen(false); return }
    // 打开即记为已读
    localStorage.setItem(SEEN_KEY, LATEST_VERSION)
    setHasUnread(false)
    setOpen(true)
  }

  // 打开期间：焦点移入面板；Esc 关（捕获 + stopImmediatePropagation，先于页面级 Esc，对齐 ConfirmDialog）；
  // 点面板外关。关闭（含卸载）时焦点归还铃铛。
  useEffect(() => {
    if (!open) return
    // cleanup 执行时 bellRef.current 可能已变，effect 开头先拷贝（react-hooks/exhaustive-deps）
    const bell = bellRef.current
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      setOpen(false)
    }
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown)
      bell?.focus()
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={bellRef}
        onClick={toggle}
        aria-label={hasUnread ? '通知（有新更新）' : '通知'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative w-10 h-10 rounded-full grid place-items-center text-v2-text-secondary hover:bg-bg-muted transition-colors"
      >
        <Bell size={20} />
        {hasUnread && (
          <span aria-hidden="true" className="absolute top-2 right-2 w-2 h-2 rounded-full bg-error" />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="更新日志"
          tabIndex={-1}
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-[320px] max-h-[420px] overflow-y-auto overscroll-contain bg-white border border-black/[0.08] rounded-[16px] shadow-[0_6px_20px_rgba(0,0,0,0.10)] px-5 py-4 outline-none"
        >
          <p className="text-[0.875rem] font-semibold text-v2-text-primary">更新日志</p>
          {CHANGELOG.map((entry) => (
            <div key={entry.version} className="mt-3 pt-3 border-t border-black/[0.05]">
              <div className="flex items-baseline gap-2">
                <span className="text-[0.8125rem] font-semibold text-brand-primary-dark">{entry.version}</span>
                <span className="text-[0.6875rem] text-v2-text-muted">{entry.date}</span>
              </div>
              <p className="text-[0.8125rem] font-medium text-v2-text-primary mt-1">{entry.title}</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {entry.notes.map((note) => (
                  <li key={note} className="flex gap-1.5 text-[0.75rem] text-v2-text-secondary leading-relaxed">
                    <span aria-hidden="true" className="text-brand-accent">·</span>
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
