'use client'
import { Bookmark, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import Tag from '@/components/Tag'
import PolishNote from '@/components/PolishNote'
import { GRADIENT_BORDER_STYLE_FULL, BRAND_GRADIENT_SOFT } from '@/lib/constants'

interface FeedbackCardProps {
  part: 'Part 1' | 'Part 2' | 'Part 3'
  originalSentence: string
  aiOptimized: string
  keywords: string[]
  date: string
  /** 「换个说法」两段式解释（语法/词组）；有内容才在优化句下方渲染。空串/空白由本组件拦掉不渲染 */
  note?: string
  onCollect?: () => void
  onSkip?: () => void
  collected?: boolean
  compact?: boolean
  className?: string
  /** 下边是否圆角。false 时只圆上两角（下边留直角），用于与紧贴其下的入口行严丝合缝拼接 */
  roundedBottom?: boolean
  /** 极简白卡样式（对齐设计稿 .fb-card/.fb-tag/.fb-quote）：纯白底、实色标签、灰底句子框。
   *  默认 false 保持渐变描边旧样式，不影响练习反馈页等其他调用方；外层容器负责边框/阴影。 */
  plain?: boolean
}

/** 用浏览器 TTS 读一句英文（与词组卡同一实现） */
function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'en-US'
  window.speechSynthesis.speak(utt)
}

/** 渐变描边小标签（旧样式，非 plain 模式用） */
function InfoTag({ text, letterSpacing }: { text: string; letterSpacing?: number }) {
  return (
    <div
      className="flex-shrink-0"
      style={{ width: 56, height: 24, background: BRAND_GRADIENT_SOFT, borderRadius: 9999, padding: 1 }}
    >
      <div
        className="w-full h-full flex items-center justify-center bg-white"
        style={{ borderRadius: 9999 }}
      >
        <span className="text-brand-primary-dark" style={{ fontSize: '0.6875rem', fontWeight: 500, lineHeight: 1, letterSpacing }}>
          {text}
        </span>
      </div>
    </div>
  )
}

function SentenceBlock({ text, variant, plain }: { text: string; variant: 'original' | 'ai'; plain?: boolean }) {
  const isAi = variant === 'ai'
  // plain：两句都用灰底(.fb-quote)、无边框；优化句文字加粗加深。旧样式：原句白底/优化绿底。
  const box = plain
    ? 'bg-bg-muted'
    : (isAi ? 'bg-tag-success-bg border border-tag-success-border' : 'bg-white border border-black/[0.07]')
  return (
    <div className={`relative rounded-[14px] px-3 py-2.5 ${box}`}>
      <p className={`text-[0.875rem] leading-relaxed pr-7 ${isAi ? 'text-v2-text-primary' : 'text-v2-text-secondary'} ${plain && isAi ? 'font-medium' : ''}`}>
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
  const { originalSentence, aiOptimized, keywords, date, note, collected, compact, className, roundedBottom = true, plain } = props

  return (
    <div
      className={cn(
        plain
          ? 'bg-white px-[18px] pt-4 pb-5'
          : (compact ? 'px-[16px] pt-[14px] pb-[18px]' : 'px-[14px] pt-[14px] pb-[16px]'),
        className,
      )}
      // plain 模式不用渐变描边（边框/阴影由外层容器负责）；旧模式保留渐变描边内联样式
      style={plain ? undefined : { ...GRADIENT_BORDER_STYLE_FULL, borderRadius: roundedBottom ? 16 : '16px 16px 0 0' }}
    >
      <div className={`flex items-center justify-between ${plain ? 'mb-2' : 'mb-1.5'}`}>
        {plain ? (
          <span className="inline-flex items-center rounded-full text-[0.6875rem] font-medium px-[10px] py-[5px] bg-brand-primary-light text-brand-primary-dark">原句</span>
        ) : (
          <InfoTag text="原句" letterSpacing={2} />
        )}
        {collected && <Bookmark size={14} className="text-brand-primary" />}
      </div>

      <SentenceBlock text={originalSentence} variant="original" plain={plain} />

      <div className={`mt-5 ${plain ? 'mb-2' : 'mb-1.5'}`}>
        {plain ? <Tag variant="green" label="优化" /> : <InfoTag text="优化" letterSpacing={5} />}
      </div>

      <SentenceBlock text={aiOptimized} variant="ai" plain={plain} />

      {/* 「换个说法」解释区：全宽内联常显；空 note 连分隔线一起不渲染（宿主层拦空——parseNote('') 会渲染空 <p>） */}
      {note && note.trim() && (
        <div className="mt-4 pt-4 border-t border-black/[0.06]">
          <PolishNote note={note} />
        </div>
      )}

      {/* 关键词 + 日期行：两者皆空时整行(连同 mt-3)不渲染，不占空间——避免收藏卡(date='')留一截空白 */}
      {(keywords.length > 0 || date) && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-[0.75rem] text-v2-text-muted">{keywords.join(' · ')}</span>
          <span className="text-[0.75rem] text-v2-text-muted">{date}</span>
        </div>
      )}
    </div>
  )
}
