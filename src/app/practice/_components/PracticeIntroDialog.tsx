/**
 * @module   PracticeIntroDialog
 * @desc     练习对话页首次进入的功能引导 —— 教「换个说法(✨)」与「发音纠错(点词)」两个核心动作。
 *           首次进入且教练开场白就绪（phase='idle'）时弹一次，localStorage 标记后不再自动弹。
 *           移动/桌面共用（page.tsx 外壳层单挂载）。真模态：role="dialog" + aria-modal +
 *           焦点移入主 CTA + Esc / 点遮罩关闭 + 打开时锁 body 滚动。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { type JSX, useEffect, useRef } from 'react'
import { Sparkles, AudioLines, X } from 'lucide-react'
import GradientButton from '@/components/GradientButton'

interface PracticeIntroDialogProps {
  open: boolean
  onClose: () => void
}

export default function PracticeIntroDialog({ open, onClose }: PracticeIntroDialogProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null)

  // 打开：焦点移入对话框面板（键盘/读屏用户否则停在被遮罩的背景页上）。
  // 聚焦面板而非 CTA —— GradientButton 是普通函数组件、不转发 ref，无法直接聚焦其内部 <button>。
  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  // Esc 关闭 + 打开时锁 body 滚动
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="practice-intro-title"
        tabIndex={-1}
        className="relative bg-white rounded-[16px] shadow-xl max-w-[360px] w-full px-6 py-6 animate-fade-up outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 关闭：触控目标 44px，负 margin 抵消视觉外扩 */}
        <button
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-2 top-2 w-11 h-11 flex items-center justify-center text-v2-text-muted active:opacity-60 transition-opacity"
        >
          <X size={16} />
        </button>

        <h2 id="practice-intro-title" className="text-[16px] font-semibold text-v2-text-primary pr-8">
          聊之前，先认识两个小帮手
        </h2>
        <p className="text-[13px] text-v2-text-secondary mt-1.5">
          都在你说过的话上操作，随时能用
        </p>

        <div className="flex flex-col gap-4 mt-5">
          {/* 功能一：换个说法 */}
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand-primary-light flex items-center justify-center">
              <Sparkles size={16} className="text-brand-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-v2-text-primary">换个说法</p>
              <p className="text-[12px] text-v2-text-secondary leading-relaxed mt-0.5">
                点你说过的那句话左上角的 ✨，教练给你一版更地道的说法。
              </p>
            </div>
          </div>

          {/* 功能二：发音纠错 */}
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand-accent-light flex items-center justify-center">
              <AudioLines size={16} className="text-brand-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-v2-text-primary">发音纠错</p>
              <p className="text-[12px] text-v2-text-secondary leading-relaxed mt-0.5">
                单词被听错了？点它，填上你真正想说的词，记下来专门练。
              </p>
            </div>
          </div>
        </div>

        {/* 两功能的联动提示：先纠发音、再换说法，优化时会用你真正想说的词，不误判成错误 */}
        <p className="text-[11px] text-v2-text-muted leading-relaxed mt-4 px-0.5">
          小技巧：先把听错的词纠正，再点 ✨ 换个说法——它会按你<span className="text-v2-text-secondary">真正想说的词</span>来优化，不会把听错的词当成语法或用词错误。
        </p>

        <GradientButton
          onClick={onClose}
          className="w-full mt-6 px-6 py-3 rounded-full text-[14px] font-medium"
        >
          开始练习
        </GradientButton>
      </div>
    </div>
  )
}
