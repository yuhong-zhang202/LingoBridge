'use client'
import { Bookmark, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GRADIENT_BORDER_STYLE_FULL, BRAND_GRADIENT_SOFT } from '@/lib/constants'

interface FeedbackCardProps {
  part: 'Part 1' | 'Part 2' | 'Part 3'
  originalSentence: string
  aiOptimized: string
  keywords: string[]
  date: string
  onCollect?: () => void
  onSkip?: () => void
  collected?: boolean
  compact?: boolean
  className?: string
}

/** 用浏览器 TTS 读一句英文（与词组卡同一实现） */
function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'en-US'
  window.speechSynthesis.speak(utt)
}

function InfoTag({ text, letterSpacing }: { text: string; letterSpacing?: number }) {
  return (
    <div
      className="flex-shrink-0"
      style={{ width: 56, height: 24, background: BRAND_GRADIENT_SOFT, borderRadius: 9999, padding: 1 }}
    >
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ background: '#FFF', borderRadius: 9999 }}
      >
        <span style={{ fontSize: 11, fontWeight: 500, color: '#B5663A', lineHeight: 1, letterSpacing }}>
          {text}
        </span>
      </div>
    </div>
  )
}

function SentenceBlock({ text, variant }: { text: string; variant: 'original' | 'ai' }) {
  const isAi = variant === 'ai'
  return (
    <div className={`relative rounded-[14px] px-3 py-2.5 ${isAi ? 'bg-[#EDF6EB] border border-[#C0DDB9]' : 'bg-white border border-black/[0.07]'}`}>
      <p className={`text-[14px] leading-relaxed pr-7 ${isAi ? 'text-v2-text-primary' : 'text-v2-text-secondary'}`}>
        {text}
      </p>
      <button
        onClick={() => speak(text)}
        aria-label="播放"
        className="absolute right-2.5 bottom-2.5 active:opacity-50 transition-opacity"
      >
        <Volume2 size={13} className="text-v2-text-muted" />
      </button>
    </div>
  )
}

export default function FeedbackCard(props: FeedbackCardProps) {
  const { originalSentence, aiOptimized, keywords, date, collected, compact, className } = props

  return (
    <div
      className={cn(compact ? 'px-[16px] pt-[14px] pb-[18px]' : 'px-[14px] pt-[14px] pb-[16px]', className)}
      style={{ ...GRADIENT_BORDER_STYLE_FULL, borderRadius: 20 }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <InfoTag text="原句" letterSpacing={2} />
        {collected && <Bookmark size={14} className="text-brand-primary" />}
      </div>

      <SentenceBlock text={originalSentence} variant="original" />

      <div className="mt-5 mb-1.5">
        <InfoTag text="优化" letterSpacing={5} />
      </div>

      <SentenceBlock text={aiOptimized} variant="ai" />

      <div className="flex items-center justify-between mt-3">
        <span className="text-[12px] text-v2-text-muted">{keywords.join(' · ')}</span>
        <span className="text-[12px] text-v2-text-muted">{date}</span>
      </div>
    </div>
  )
}
