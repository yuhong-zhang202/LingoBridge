/**
 * @module   PronounceCapturePopup
 * @desc     练习页"发音纠错"卡片 — 挂在被点气泡下方，填入真正想说的词并收藏
 * @author   LingoBridge
 * @created  2026-06-11
 */
'use client'
import { useState } from 'react'
import { Bookmark, X } from 'lucide-react'
import { GRADIENT_BORDER_STYLE, GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'

interface PronounceCapturePopupProps {
  heard: string
  onSave: (intended: string) => void
  onClose: () => void
}

export default function PronounceCapturePopup({ heard, onSave, onClose }: PronounceCapturePopupProps): JSX.Element {
  const [value, setValue] = useState('')

  function submit(): void {
    const v = value.trim()
    if (v) onSave(v)
  }

  return (
    <div
      className="relative ml-auto max-w-[88%] -mt-2 mb-4 rounded-[16px]"
      style={{ ...GRADIENT_BORDER_STYLE_FULL, padding: '12px 13px' }}
    >
      {/* 朝上小三角，指向上方气泡 */}
      <div
        className="absolute"
        style={{ top: -7, right: 24, width: 12, height: 12, background: '#FFFFFF', transform: 'rotate(45deg)', borderLeft: '1px solid rgba(240,188,160,.85)', borderTop: '1px solid rgba(240,188,160,.85)' }}
      />

      <div className="flex justify-between items-center mb-2">
        <span className="text-[13px] font-semibold text-v2-text-primary">发音纠错</span>
        <button onClick={onClose} aria-label="关闭" className="active:opacity-60 transition-opacity">
          <X size={14} color="#A89990" />
        </button>
      </div>

      <p className="text-[12px] text-v2-text-muted mb-2.5">
        听成了：<span className="text-brand-primary-dark font-medium">{heard}</span>
      </p>
      <p className="text-[11.5px] text-v2-text-secondary mb-1.5">你真正想说的词是</p>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder="输入正确的词"
          className="flex-1 min-w-0 border border-black/[0.12] rounded-[9px] bg-[#FAFAF8] px-2.5 py-1.5 text-[13.5px] text-v2-text-primary outline-none focus:border-brand-primary/40"
        />
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="flex-shrink-0 flex items-center gap-1 px-3.5 py-2 text-[12px] font-medium text-[#444] active:scale-[0.96] transition-transform disabled:opacity-50"
          style={{ ...GRADIENT_BORDER_STYLE, borderRadius: 9999 }}
        >
          <Bookmark size={12} className="text-brand-primary" />收藏
        </button>
      </div>
    </div>
  )
}
