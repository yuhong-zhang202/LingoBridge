/**
 * @module   SearchBox
 * @desc     素材库桌面 tab 栏就地展开的搜索输入框 —— 前缀搜索图标 + 输入 + 清空(X)。
 *           Esc 清空并收起；点输入框外且内容为空时收起（非空保持，避免误关丢输入）。仅桌面用。
 * @author   LingoBridge
 * @created  2026-07-08
 */
'use client'
import { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'

interface SearchBoxProps {
  value: string
  onChange: (v: string) => void
  /** 收起搜索（Esc / 点外部且空）；由外层置 searchOpen=false + 清空 */
  onClose: () => void
}

export default function SearchBox({ value, onChange, onClose }: SearchBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null)

  // 点输入框外：内容为空 → 收起；非空 → 保持（避免误关丢输入）
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node) && value.trim() === '') {
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [value, onClose])

  // 焦点环画在容器上（input 自身 outline-none）：focus-within 让键盘聚焦输入框时整框可见
  return (
    <div
      ref={boxRef}
      className="flex items-center gap-1.5 h-9 w-[220px] rounded-full bg-bg-muted px-3 focus-within:ring-2 focus-within:ring-brand-primary focus-within:ring-offset-2"
    >
      <Search size={15} className="flex-shrink-0 text-v2-text-muted" />
      <input
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { onChange(''); onClose() } }}
        placeholder="搜索…"
        role="searchbox"
        aria-label="搜索当前分类"
        className="flex-1 min-w-0 bg-transparent text-[16px] lg:text-[13px] text-v2-text-primary placeholder:text-v2-text-muted outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="清空搜索"
          className="flex-shrink-0 active:opacity-60 transition-opacity"
        >
          <X size={14} className="text-v2-text-muted hover:text-v2-text-primary transition-colors" />
        </button>
      )}
    </div>
  )
}
