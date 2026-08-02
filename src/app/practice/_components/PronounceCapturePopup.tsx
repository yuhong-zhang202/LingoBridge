/**
 * @module   PronounceCapturePopup
 * @desc     练习页"发音纠错"卡片 — 挂在被点气泡下方，填入真正想说的词并收藏；
 *           按「配对」intended__heard 去重，命中已收藏配对时按钮变禁用「已收藏」
 * @author   LingoBridge
 * @created  2026-06-11
 */
'use client'
import { type JSX, useState } from 'react'
import { Bookmark, X } from 'lucide-react'
import { GRADIENT_BORDER_STYLE, GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'

interface PronounceCapturePopupProps {
  heard: string
  /** 全局已收藏的纠错 id 快照（intended__heard 小写），用于「同一配对去重」判定 */
  savedIds: string[]
  onSave: (intended: string) => void
  onClose: () => void
}

export default function PronounceCapturePopup({ heard, savedIds, onSave, onClose }: PronounceCapturePopupProps): JSX.Element {
  const [value, setValue] = useState('')

  const trimmed = value.trim()
  // 命中已收藏配对（与 storage 的 id 规则一致：intended 小写 + '__' + heard 小写）
  const already = trimmed.length > 0 && savedIds.includes(`${trimmed.toLowerCase()}__${heard.toLowerCase()}`)

  function submit(): void {
    if (trimmed && !already) onSave(trimmed)
  }

  return (
    <div
      className="relative ml-auto max-w-[88%] -mt-2 mb-4 rounded-[16px]"
      style={{ ...GRADIENT_BORDER_STYLE_FULL, padding: '12px 13px' }}
    >
      {/* 朝上小三角，指向上方气泡 */}
      <div
        className="absolute bg-white"
        style={{ top: -7, right: 24, width: 12, height: 12, transform: 'rotate(45deg)', borderLeft: '1px solid rgba(240,188,160,.85)', borderTop: '1px solid rgba(240,188,160,.85)' }}
      />

      <div className="flex justify-between items-center mb-2">
        <span className="text-[0.8125rem] font-semibold text-v2-text-primary">发音纠错</span>
        <button onClick={onClose} aria-label="关闭" className="active:opacity-60 transition-opacity">
          <X size={14} color="#A89990" />
        </button>
      </div>

      <p className="text-[0.75rem] text-v2-text-muted mb-2.5">
        听成了：<span className="text-brand-primary-dark font-medium">{heard}</span>
      </p>
      <p className="text-[0.6875rem] text-v2-text-secondary mb-1.5">你真正想说的词是</p>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder="输入正确的词"
          className="flex-1 min-w-0 border border-black/[0.12] rounded-[9px] bg-cream-subtle px-2.5 py-1.5 text-[1rem] lg:text-[0.8125rem] text-v2-text-primary outline-none focus:border-brand-primary/40"
        />
        <button
          onClick={submit}
          disabled={!trimmed || already}
          className={`flex-shrink-0 flex items-center gap-1 px-3.5 py-2 text-[0.75rem] font-medium active:scale-[0.97] transition-transform disabled:opacity-50 ${already ? 'text-brand-primary' : 'text-v2-text-secondary'}`}
          style={{ ...GRADIENT_BORDER_STYLE, borderRadius: 9999 }}
        >
          <Bookmark size={12} className={already ? 'fill-brand-primary text-brand-primary' : 'text-brand-primary'} />
          {already ? '已收藏' : '收藏'}
        </button>
      </div>
    </div>
  )
}
