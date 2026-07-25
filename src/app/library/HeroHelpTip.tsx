/**
 * @module   HeroHelpTip
 * @desc     素材库「题库速览」Hero 的「怎么结对」说明气泡 —— 默认一个小问号（lucide HelpCircle），
 *           悬停 / 键盘聚焦 / 点按（移动端）均可展开 tooltip，解释在匹配页、雅思题模式下如何把题目与
 *           语料结对。两点工程要害：① Hero 外层是 <Link>，问号的点击必须阻断冒泡与默认行为，否则会误跳转；
 *           ② 移动端 Hero 容器带 overflow-hidden，直接绝对定位的气泡会被裁掉，故气泡走 portal 挂 body、
 *           fixed 定位并夹在视口内。a11y：button 有 aria-label + aria-expanded，气泡 role="tooltip"，
 *           hover/focus/tap 三路可达，Esc 关闭。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { type JSX, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle } from 'lucide-react'

/** 气泡宽度（px），portal 定位夹视口内时用。 */
const TIP_WIDTH = 240

/**
 * Hero 说明问号 + 展开气泡。
 * @param text  气泡正文
 * @returns     内联问号触发器 + 条件 portal 渲染的 tooltip
 */
export default function HeroHelpTip({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  // 悬停延迟关闭：让鼠标能从问号移到气泡上而不被立刻收起（气泡是 portal、不在同一 DOM 子树，
  // 否则移入气泡会触发问号容器的 mouseleave）。
  const closeTimer = useRef<number | null>(null)

  /** 计算气泡落点：问号正下方、左缘对齐问号，但左右各留 12px 夹在视口内。 */
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.min(Math.max(12, r.left), window.innerWidth - TIP_WIDTH - 12)
    setPos({ top: r.bottom + 8, left })
  }, [])

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }, [])
  const openTip = useCallback(() => { cancelClose(); place(); setOpen(true) }, [cancelClose, place])
  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setOpen(false), 150)
  }, [cancelClose])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    // 滚动/缩放后 fixed 落点会失准：气泡是轻提示，直接收起（重开成本极低），不做实时跟随。
    const onShift = () => setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onShift, true)
    window.addEventListener('resize', onShift)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onShift, true)
      window.removeEventListener('resize', onShift)
    }
  }, [open])

  useEffect(() => () => cancelClose(), [cancelClose])

  return (
    <span className="inline-flex items-center" onMouseEnter={openTip} onMouseLeave={scheduleClose}>
      <button
        ref={btnRef}
        type="button"
        aria-label="题库速览怎么用"
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (open) setOpen(false); else openTip() }}
        onFocus={openTip}
        onBlur={scheduleClose}
        className="grid place-items-center w-5 h-5 rounded-full text-v2-text-muted hover:text-v2-text-secondary transition-colors focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:outline-offset-1"
      >
        <HelpCircle size={14} />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <span
          role="tooltip"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
          className="fixed z-[60] rounded-[12px] bg-bg-surface border border-black/[0.06] shadow-[0_6px_20px_rgba(0,0,0,0.10)] px-3 py-2.5 text-[12px] leading-relaxed text-v2-text-secondary text-left font-normal"
          style={{ top: pos.top, left: pos.left, width: TIP_WIDTH }}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  )
}
