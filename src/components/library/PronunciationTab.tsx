/**
 * @module   PronunciationTab
 * @desc     素材库「发音」Tab — 列出练习页收藏的发音正音，喇叭播放正确/错误词，左滑删除
 * @author   LingoBridge
 * @created  2026-06-11
 */
'use client'
import { useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import SwipeToDelete from '@/components/library/SwipeToDelete'
import { getSavedPronunciations, removeSavedPronunciation } from '@/lib/storage'
import type { SavedPronunciation } from '@/lib/types'

/** 用浏览器 TTS 读一个英文词（与词组卡同一实现） */
function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'en-US'
  window.speechSynthesis.speak(utt)
}

export default function PronunciationTab(): JSX.Element | null {
  const [items, setItems] = useState<SavedPronunciation[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setItems(getSavedPronunciations())
    setLoaded(true)
  }, [])

  if (!loaded) return null
  if (items.length === 0) {
    return (
      <EmptyState
        title="还没有发音收藏"
        subtitle="练习时点气泡里发音被听错的词，填上正确的词即可收藏到这里"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      {items.map(it => (
        <SwipeToDelete
          key={it.id}
          borderRadius={16}
          onDelete={() => {
            removeSavedPronunciation(it.id)
            setItems(prev => prev.filter(x => x.id !== it.id))
          }}
        >
          <div className="bg-white rounded-[16px] border border-black/[0.06] px-[14px] py-[13px]">
            <p className="text-[11px] text-v2-text-muted mb-[5px]">想说的词</p>
            <div className="flex items-center justify-between mb-[11px]">
              <span className="text-[15px] font-medium text-v2-text-primary">{it.intended}</span>
              <button
                onClick={() => speak(it.intended)}
                aria-label="播放"
                className="active:opacity-50 transition-opacity"
              >
                <Volume2 size={14} className="text-v2-text-muted" />
              </button>
            </div>

            <p className="text-[11px] text-v2-text-muted mb-[5px]">被听成</p>
            <div className="flex items-center justify-between mb-[11px]">
              <span className="text-[15px] font-medium text-v2-text-primary">{it.heard}</span>
              <button
                onClick={() => speak(it.heard)}
                aria-label="播放"
                className="active:opacity-50 transition-opacity"
              >
                <Volume2 size={14} className="text-v2-text-muted" />
              </button>
            </div>

            <p className="text-[11.5px] text-v2-text-muted leading-[1.5]">出处：{it.context}</p>
          </div>
        </SwipeToDelete>
      ))}
    </div>
  )
}
