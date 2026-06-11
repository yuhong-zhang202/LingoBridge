/**
 * @module   PronounceCapturePopup
 * @desc     练习页"发音纠错"弹窗 — 点气泡里的词后，填入真正想说的词并收藏
 * @author   LingoBridge
 * @created  2026-06-11
 */
'use client'
import { useState } from 'react'
import { Bookmark } from 'lucide-react'
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
    <>
      <div className="fixed inset-0 z-[45]" onClick={onClose} />
      <div
        className="fixed left-1/2 top-[26%] -translate-x-1/2 z-[46] w-[300px] rounded-[16px]"
        style={{ ...GRADIENT_BORDER_STYLE_FULL, padding: '13px 14px' }}
      >
        <p className="text-[13px] font-semibold text-v2-text-primary mb-2">发音纠错</p>
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
    </>
  )
}
