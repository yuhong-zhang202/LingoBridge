/**
 * @module   RephrasePopup
 * @desc     练习页"换个说法"弹窗 — 展示 🔨 优化后的句子 + 改进说明
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { type RefObject } from 'react'
import { X, Check } from 'lucide-react'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'
import type { PolishResult } from '@/lib/types'

interface RephrasePopupProps {
  loading: boolean
  result: PolishResult | null
  onClose: () => void
  popupRef: RefObject<HTMLDivElement>
}

export default function RephrasePopup({ loading, result, onClose, popupRef }: RephrasePopupProps): JSX.Element {
  return (
    <div
      ref={popupRef}
      className="fixed z-[40] rounded-[16px]"
      style={{ ...GRADIENT_BORDER_STYLE_FULL, left: 14, right: 14, bottom: 100, padding: '11px 13px 12px' }}
    >
      {/* 向下三角，指向左下角云团 */}
      <div
        className="absolute"
        style={{ bottom: -7, left: 18, width: 12, height: 12, background: '#FFFFFF', transform: 'rotate(45deg)', borderRight: '1px solid rgba(168,210,196,.80)', borderBottom: '1px solid rgba(188,210,168,.75)' }}
      />

      <div className="flex justify-between items-center mb-2">
        <span className="text-[13px] font-semibold text-v2-text-primary">换个说法</span>
        <button onClick={onClose} className="active:opacity-60 transition-opacity"><X size={14} color="#A89990" /></button>
      </div>

      {loading ? (
        <p className="text-[13px] text-v2-text-muted px-1 py-2">优化中…</p>
      ) : result ? (
        result.needsWork && result.optimized ? (
          <div className="flex flex-col gap-2">
            <div style={{ padding: '9px 11px', background: '#F8F7F5', border: '1px solid rgba(168,153,144,.14)', borderRadius: 11 }}>
              <p className="text-[11px] text-v2-text-muted mb-1">Do you wanna try:</p>
              <p className="text-[13.5px] leading-[1.5] text-v2-text-primary font-medium">{result.optimized}</p>
            </div>
            {result.note && <p className="text-[12px] text-v2-text-muted leading-[1.45] px-1">{result.note}</p>}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-1 py-1.5">
            <Check size={14} className="text-brand-accent flex-shrink-0" />
            <p className="text-[13px] text-v2-text-secondary">{result.note || '回答无需优化'}</p>
          </div>
        )
      ) : null}
    </div>
  )
}
