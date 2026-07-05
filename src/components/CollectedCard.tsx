/**
 * @module   CollectedCard
 * @desc     素材库「收藏卡片」单卡 —— 手写复刻 feedback 桌面版卡片视觉（胶囊描边标签 + 白底原句框 +
 *           绿底优化框 + 播放按钮），并用一条 GRADIENT_BORDER_STYLE_FULL_OPAQUE 渐变描边一次裹住
 *           「卡内容 + 拼句练习行」，内部以中性虚线隔开。不复用 FeedbackCard（其描边只裹卡主体、
 *           且半透明描边在 SwipeToDelete 红底上会透棕，故本卡自画不透明描边）。
 *           enableSwipe=true 时外层包 SwipeToDelete 支持移动端左滑删除；false 时裸渲染（桌面端）。
 * @author   LingoBridge
 * @created  2026-07-05
 */
'use client'
import Link from 'next/link'
import { Shuffle, Volume2 } from 'lucide-react'
import Chip from '@/components/Chip'
import SwipeToDelete from '@/components/library/SwipeToDelete'
import { chunkSentence } from '@/lib/phrase-chunk'
import { BRAND_GRADIENT_SOFT, GRADIENT_BORDER_STYLE_FULL_OPAQUE } from '@/lib/constants'
import type { CollectedCard as CollectedCardData } from '@/lib/types'

interface CollectedCardProps {
  /** 卡片数据 */
  card: CollectedCardData
  /** true=移动端（包 SwipeToDelete 支持左滑删除）；false=桌面端（裸渲染） */
  enableSwipe: boolean
  /** 删除回调 */
  onDelete: (id: string) => void
}

/** 用浏览器 TTS 读一句英文（与 FeedbackCard 同一实现） */
function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'en-US'
  window.speechSynthesis.speak(utt)
}

/** 胶囊描边标签（复刻 FeedbackCard 非 plain 的 InfoTag：软渐变描边 + 白底 + 深橙字） */
function InfoTag({ text, letterSpacing }: { text: string; letterSpacing: number }) {
  return (
    <div className="flex-shrink-0" style={{ width: 56, height: 24, background: BRAND_GRADIENT_SOFT, borderRadius: 9999, padding: 1 }}>
      <div className="w-full h-full flex items-center justify-center bg-white rounded-full">
        <span className="text-brand-primary-dark" style={{ fontSize: 11, fontWeight: 500, lineHeight: 1, letterSpacing }}>
          {text}
        </span>
      </div>
    </div>
  )
}

/** 句子框 + 播放按钮（复刻 FeedbackCard 非 plain：原句白底、优化绿底） */
function SentenceBlock({ text, variant }: { text: string; variant: 'original' | 'ai' }) {
  const isAi = variant === 'ai'
  const box = isAi ? 'bg-[#EDF6EB] border border-[#C0DDB9]' : 'bg-white border border-black/[0.07]'
  return (
    <div className={`relative rounded-[14px] px-3 py-2.5 ${box}`}>
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

export default function CollectedCard({ card, enableSwipe, onDelete }: CollectedCardProps): JSX.Element {
  // 优化句切不出至少 3 块（短句）时不显示拼句练习入口，玩着意义不大
  const canPlay = chunkSentence(card.aiOptimized).length >= 3

  // 整卡：一层渐变描边（_OPAQUE 垫白底挡红）+ 圆角 16 + overflow-hidden，一次裹住卡内容 + 拼句行
  const body = (
    <div className="rounded-[16px] overflow-hidden" style={GRADIENT_BORDER_STYLE_FULL_OPAQUE}>
      {/* 卡内容主体（复刻 feedback 非 plain 版式与间距） */}
      <div className="px-[16px] pt-[14px] pb-[18px]">
        <div className="mb-1.5">
          <InfoTag text="原句" letterSpacing={2} />
        </div>
        <SentenceBlock text={card.originalSentence} variant="original" />
        <div className="mt-5 mb-1.5">
          <InfoTag text="优化" letterSpacing={5} />
        </div>
        <SentenceBlock text={card.aiOptimized} variant="ai" />
        {/* 不可拼句时，卡尾显示日期（feedback 同款日期行） */}
        {!canPlay && (
          <div className="flex items-center justify-between mt-3">
            <span className="text-[12px] text-v2-text-muted">{(card.keywords ?? []).join(' · ')}</span>
            <span className="text-[12px] text-v2-text-muted">{card.collectedAt}</span>
          </div>
        )}
      </div>

      {/* 拼句练习入口行：中性虚线分隔 + 左日期右 Chip；与卡内容同在一条描边内 */}
      {canPlay && (
        <div className="px-[16px] pt-[11px] pb-[14px] bg-white border-t border-dashed border-black/[0.08] flex items-center justify-between">
          <span className="text-[11px] text-v2-text-muted">{card.collectedAt}</span>
          <Link href={`/library/collected/${card.id}/practice`}>
            <Chip variant="gradient" size="sm" className="text-[12px] px-[14px] py-[7px] gap-1.5">
              <Shuffle size={13} className="text-brand-accent" />拼句练习
            </Chip>
          </Link>
        </div>
      )}
    </div>
  )

  // 移动端：外层 rounded+shadow（阴影不被 SwipeToDelete 的 overflow-hidden 裁掉）→ SwipeToDelete 负责裁切 + 左滑删除
  if (enableSwipe) {
    return (
      <div className="rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
        <SwipeToDelete borderRadius={16} onDelete={() => onDelete(card.id)}>
          {body}
        </SwipeToDelete>
      </div>
    )
  }

  // 桌面端：裸渲染，外层 wrapper 提供圆角 + 阴影
  return (
    <div className="rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      {body}
    </div>
  )
}
