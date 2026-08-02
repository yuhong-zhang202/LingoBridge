/**
 * @module   RephrasePopup
 * @desc     练习页"换个说法"弹窗 — 展示 🔨 优化后的句子 + 改进说明
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { type JSX, type RefObject } from 'react'
import { X, Check } from 'lucide-react'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'
import PolishNote from '@/components/PolishNote'
import type { PolishResult } from '@/lib/types'

interface RephrasePopupProps {
  loading: boolean
  result: PolishResult | null
  onClose: () => void
  popupRef: RefObject<HTMLDivElement | null>
  /** 定位变体：mobile = fixed 贴视口左右（默认，移动端原样）；desktop = absolute 收进 600px 对话列内，避免横跨全屏 */
  variant?: 'mobile' | 'desktop'
}

export default function RephrasePopup({ loading, result, onClose, popupRef, variant = 'mobile' }: RephrasePopupProps): JSX.Element {
  const desktop = variant === 'desktop'
  return (
    <div
      ref={popupRef}
      className={
        desktop
          ? 'absolute z-[40] rounded-[16px] left-0 right-0 bottom-[118px]'
          : 'fixed z-[40] rounded-[16px]'
      }
      style={
        desktop
          ? { ...GRADIENT_BORDER_STYLE_FULL, padding: '11px 13px 12px' }
          : { ...GRADIENT_BORDER_STYLE_FULL, left: 14, right: 14, bottom: 100, padding: '11px 13px 12px' }
      }
    >
      {/* 向下三角，指向左下角云团 */}
      <div
        className="absolute bg-white"
        style={{ bottom: -7, left: 18, width: 12, height: 12, transform: 'rotate(45deg)', borderRight: '1px solid rgba(168,210,196,.80)', borderBottom: '1px solid rgba(188,210,168,.75)' }}
      />

      <div className="flex justify-between items-center mb-2">
        <span className="text-[0.8125rem] font-semibold text-v2-text-primary">换个说法</span>
        {/* 触控目标 44px：负 margin 抵消视觉外扩，不改变原有留白观感 */}
        <button onClick={onClose} aria-label="关闭" className="w-11 h-11 -mr-3 -my-3 flex items-center justify-center active:opacity-60 transition-opacity"><X size={14} color="#A89990" /></button>
      </div>

      {loading ? (
        <p className="text-[0.8125rem] text-v2-text-muted px-1 py-2">优化中…</p>
      ) : result ? (
        result.needsWork && result.optimized ? (
          <div className="flex flex-col gap-2">
            <div className="bg-cream-soft" style={{ padding: '9px 11px', border: '1px solid rgba(168,153,144,.14)', borderRadius: 11 }}>
              <p className="text-[0.6875rem] text-v2-text-muted mb-1">Do you wanna try:</p>
              <p className="text-[0.8125rem] leading-[1.5] text-v2-text-primary font-medium">{result.optimized}</p>
            </div>
            {result.note && <PolishNote note={result.note} className="px-1" />}
          </div>
        ) : result.failed ? (
          // 失败/额度态（没能生成 / 额度已满 / 网络不稳）：note 是失败消息，绝不配成功勾。
          // 用中性提示色（同「优化中…」的 v2-text-muted），不新造样式 token。
          <div className="px-1 py-1.5">
            <p className="text-[0.8125rem] text-v2-text-muted">{result.note}</p>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-1 py-1.5">
            <Check size={14} className="text-brand-accent flex-shrink-0" />
            <p className="text-[0.8125rem] text-v2-text-secondary">{result.note || '回答无需优化'}</p>
          </div>
        )
      ) : null}
    </div>
  )
}
