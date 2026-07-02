/**
 * @module   PronunciationTab
 * @desc     素材库「发音」Tab — 收藏的发音正音，喇叭播放 + AI 音标/怎么念（首次打开缓存）+ 左滑删除
 * @author   LingoBridge
 * @created  2026-06-11
 */
'use client'
import { useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import SwipeToDelete from '@/components/library/SwipeToDelete'
import { getSavedPronunciations, removeSavedPronunciation, updateSavedPronunciation } from '@/lib/storage'
import { GRADIENT_BORDER_STYLE_FULL_OPAQUE } from '@/lib/constants'
import type { SavedPronunciation, PronunciationTip } from '@/lib/types'

/** 用浏览器 TTS 读一个英文词 */
function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'en-US'
  window.speechSynthesis.speak(utt)
}

/** 一行：标签 + 词 + 音标 + 喇叭 */
function WordRow({ label, word, ipa }: { label: string; word: string; ipa?: string }): JSX.Element {
  return (
    <>
      <p className="text-[11px] text-v2-text-muted mb-[5px]">{label}</p>
      <div className="flex items-center justify-between mb-[11px]">
        <span className="text-[15px] text-v2-text-primary">
          <span className="font-medium">{word}</span>
          {ipa && <span className="ml-2 text-[12px] text-v2-text-secondary">{ipa}</span>}
        </span>
        <button
          onClick={() => speak(word)}
          aria-label="播放"
          className="active:opacity-50 transition-opacity"
        >
          <Volume2 size={14} className="text-v2-text-muted" />
        </button>
      </div>
    </>
  )
}

/** 单张发音卡：首次展示时若没缓存音标/提示，请求 AI 并写回 storage */
function PronunciationCard({ item }: { item: SavedPronunciation }): JSX.Element {
  const cached: PronunciationTip | null = item.tip
    ? { ipaIntended: item.ipaIntended ?? '', ipaHeard: item.ipaHeard ?? '', tip: item.tip }
    : null
  const [data, setData] = useState<PronunciationTip | null>(cached)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (data) return
    let cancelled = false
    const ac = new AbortController()
    setLoading(true)
    fetch('/api/pronounce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intended: item.intended, heard: item.heard, context: item.context }),
      signal: ac.signal,
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('请求失败'))))
      .then((tip: PronunciationTip) => {
        if (cancelled) return
        setData(tip)
        updateSavedPronunciation(item.id, {
          ipaIntended: tip.ipaIntended,
          ipaHeard: tip.ipaHeard,
          tip: tip.tip,
        })
      })
      .catch(() => { /* 失败静默（含中断），下次打开再试 */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; ac.abort() }
  }, [data, item])

  return (
    <div style={GRADIENT_BORDER_STYLE_FULL_OPAQUE} className="rounded-[16px] px-[14px] py-[13px]">
      <WordRow label="想说的词" word={item.intended} ipa={data?.ipaIntended} />
      <WordRow label="被听成" word={item.heard} ipa={data?.ipaHeard} />

      <div className="rounded-[12px] bg-bg-page px-3 py-2.5 mb-[11px]">
        <p className="text-[11px] text-v2-text-muted mb-1">怎么念</p>
        {data
          ? <p className="text-[12px] text-v2-text-primary leading-[1.6]">{data.tip}</p>
          : <p className="text-[12px] text-v2-text-muted leading-[1.6]">{loading ? '发音提示生成中…' : '稍后再试'}</p>}
      </div>

      <p className="text-[11px] text-v2-text-muted leading-[1.5]">出处：{item.context}</p>
    </div>
  )
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
    <div className="flex flex-col gap-3 pt-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start">
      {items.map(it => (
        <SwipeToDelete
          key={it.id}
          borderRadius={16}
          onDelete={() => {
            removeSavedPronunciation(it.id)
            setItems(prev => prev.filter(x => x.id !== it.id))
          }}
        >
          <PronunciationCard item={it} />
        </SwipeToDelete>
      ))}
    </div>
  )
}
