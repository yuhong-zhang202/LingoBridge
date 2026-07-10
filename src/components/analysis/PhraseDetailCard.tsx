/**
 * @module   PhraseDetailCard
 * @desc     词组详情卡 —— analysis 页展开词组、素材库「词组收藏」tab 复用。渐变描边 + 释义/场景 + 收藏/加入记忆。
 * @author   LingoBridge
 * @created  2026-06-11
 */
'use client'
import { Star, Volume2, Layers, Check } from 'lucide-react'
import { GRADIENT_BORDER_STYLE, GRADIENT_BORDER_STYLE_FULL_OPAQUE } from '@/lib/constants'

function speak(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'en-US'
  window.speechSynthesis.speak(utt)
}

interface Props {
  text: string
  meaning: string
  scene: string
  /** 显示分组和水平胶囊（素材库里用） */
  group?: string
  level?: string
  isSaved?: boolean
  onToggleSave?: () => void
  /** 记忆卡片（仅词组收藏里传）：是否已加入 deck + 加入回调 */
  inDeck?: boolean
  onAddToMemory?: () => void
  /** 播放按钮内联紧跟词组（素材库桌面选择场景用，右上角让位给 checkbox）；默认 false = 绝对定位在右上，analysis 原样 */
  inlineSpeaker?: boolean
}

export default function PhraseDetailCard({ text, meaning, scene, group, level, isSaved, onToggleSave, inDeck, onAddToMemory, inlineSpeaker = false }: Props) {
  return (
    <div style={GRADIENT_BORDER_STYLE_FULL_OPAQUE} className="rounded-[14px] px-3.5 py-3">
      {inlineSpeaker ? (
        // 播放内联紧跟词组；pr-7 预留右上角给外壳 checkbox（避让）
        <div className="flex items-center gap-1.5 mb-2 pr-7">
          <p className="text-[13px] font-medium text-v2-text-primary">{text}</p>
          <button
            onClick={() => speak(text)}
            className="flex-shrink-0 active:opacity-50 transition-opacity"
            aria-label="播放"
          >
            <Volume2 size={13} className="text-v2-text-muted" />
          </button>
        </div>
      ) : (
      <div className="relative mb-2">
        <p className="text-[13px] font-medium text-v2-text-primary pr-7">{text}</p>
        <button
          onClick={() => speak(text)}
          className="absolute right-0 top-0 active:opacity-50 transition-opacity"
          aria-label="播放"
        >
          <Volume2 size={13} className="text-v2-text-muted" />
        </button>
      </div>
      )}
      <p className="text-[11px] text-v2-text-muted mb-0.5">释义</p>
      <p className="text-[12px] text-v2-text-secondary leading-relaxed mb-2.5">{meaning}</p>
      <p className="text-[11px] text-v2-text-muted mb-0.5">适用场景</p>
      <p className="text-[12px] text-v2-text-secondary leading-relaxed">{scene}</p>
      {(group ?? level) && (
        <div className="flex items-center gap-2 mt-2.5">
          {group && <span className="text-[10px] text-v2-text-secondary bg-bg-muted rounded-full px-2 py-[2px]">{group}</span>}
          {level && <span className="text-[10px] text-v2-text-secondary bg-bg-muted rounded-full px-2 py-[2px]">雅思 {level}</span>}
        </div>
      )}
      {onToggleSave && (
        <button
          onClick={onToggleSave}
          className={`mt-3 w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold rounded-full py-2 active:scale-[0.97] transition-transform duration-150 ${isSaved ? 'text-brand-primary' : 'text-v2-text-secondary'}`}
          style={GRADIENT_BORDER_STYLE}
        >
          <Star size={13} className={isSaved ? 'fill-brand-primary text-brand-primary' : ''} />
          {isSaved ? '已收藏' : '收藏到素材库'}
        </button>
      )}
      {onAddToMemory && (
        <button
          onClick={onAddToMemory}
          disabled={inDeck}
          className={`mt-2 w-full flex items-center justify-center gap-1.5 text-[12px] font-medium rounded-full py-2 ${
            inDeck
              ? 'text-brand-accent'
              : 'border border-black/[0.11] text-v2-text-secondary active:scale-[0.97] transition-transform duration-150'
          }`}
        >
          {inDeck ? <><Check size={13} />已加入记忆</> : <><Layers size={13} />加入记忆卡片</>}
        </button>
      )}
    </div>
  )
}
