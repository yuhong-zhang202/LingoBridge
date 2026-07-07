/**
 * @module   PronunciationTab
 * @desc     素材库「发音」Tab — 收藏的发音正音，喇叭播放 + AI 音标/怎么念（首次打开缓存）。
 *           移动端左滑删除（SwipeToDelete）；桌面端复用 useSelectMode 多选删除（选择态由 SelectableCardWrapper 叠加）。
 * @author   LingoBridge
 * @created  2026-06-11
 */
'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Volume2, Trash2 } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import SwipeToDelete from '@/components/library/SwipeToDelete'
import SelectableCardWrapper from '@/components/library/SelectableCardWrapper'
import UndoToast from '@/components/UndoToast'
import IconButton from '@/components/IconButton'
import useSelectMode from '@/hooks/useSelectMode'
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
      <div className="flex items-center gap-1.5 mb-[11px]">
        <span className="text-[15px] text-v2-text-primary">
          <span className="font-medium">{word}</span>
          {ipa && <span className="ml-2 text-[12px] text-v2-text-secondary">{ipa}</span>}
        </span>
        <button
          onClick={() => speak(word)}
          aria-label="播放"
          className="flex-shrink-0 active:opacity-50 transition-opacity"
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

/**
 * toolbarSlotRef：桌面端把「选择」/多选工具栏 Portal 到 tab 栏右侧槽（LibraryDesktop 提供）；移动端不传。
 * onSelectingChange：通知外层（LibraryDesktop）选择模式变化，用于禁用同排的搜索图标。
 */
interface Props {
  toolbarSlotRef?: React.RefObject<HTMLDivElement | null>
  onSelectingChange?: (selecting: boolean) => void
}

const getPronId = (p: SavedPronunciation): string => p.id

export default function PronunciationTab({ toolbarSlotRef, onSelectingChange }: Props): JSX.Element | null {
  const [pronunciations, setPronunciations] = useState<SavedPronunciation[]>([])
  const [loaded, setLoaded] = useState(false)

  const sel = useSelectMode({
    initialItems: pronunciations,
    getId: getPronId,
    removeFn: removeSavedPronunciation,
    onSelectingChange,
  })

  // Portal 落点在 LibraryDesktop 的 DOM 里，首帧 ref.current 尚未挂载；挂载后翻标志重渲染。移动端不传 ref → 恒 null → 无工具栏。
  const [slotReady, setSlotReady] = useState(false)
  useEffect(() => { setSlotReady(true) }, [])
  const toolbarSlot = slotReady ? toolbarSlotRef?.current ?? null : null

  useEffect(() => {
    setPronunciations(getSavedPronunciations())
    setLoaded(true)
  }, [])

  if (!loaded) return null
  if (sel.items.length === 0) {
    return (
      <EmptyState
        title="还没有发音收藏"
        subtitle="练习时点气泡里发音被听错的词，填上正确的词即可收藏到这里"
      />
    )
  }

  return (
    <>
      {/* 桌面端工具栏：Portal 到 tab 栏右侧槽（未选择=「选择」；选择中=取消/已选N/全选/删除） */}
      {toolbarSlot && createPortal(
        !sel.selecting ? (
          <IconButton icon={Trash2} label="选择" onClick={sel.enterSelecting} />
        ) : (
          <div className="flex items-center gap-4">
            <button onClick={sel.exitSelecting} className="text-[13px] text-v2-text-muted hover:text-v2-text-primary transition-colors">取消</button>
            <span className="text-[13px] text-v2-text-muted">已选 {sel.selectedCount} 项</span>
            <button onClick={sel.toggleSelectAll} className="text-[13px] text-v2-text-secondary hover:text-v2-text-primary transition-colors">
              {sel.allSelected ? '取消全选' : '全选'}
            </button>
            <button
              onClick={sel.deleteSelected}
              disabled={sel.selectedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium text-white bg-error active:scale-[0.97] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} />删除 ({sel.selectedCount})
            </button>
          </div>
        ),
        toolbarSlot
      )}

      <div className="flex flex-col gap-3 pt-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start">
        {sel.visibleItems.map(it => (
          <SelectableCardWrapper
            key={it.id}
            selecting={sel.selecting}
            selected={sel.isSelected(it.id)}
            onToggle={() => sel.toggleSelect(it.id)}
            radius={16}
            checkboxSide="right"
          >
            <SwipeToDelete
              borderRadius={16}
              onDelete={() => sel.removeImmediate(it.id)}
            >
              <PronunciationCard item={it} />
            </SwipeToDelete>
          </SelectableCardWrapper>
        ))}
      </div>

      {/* 撤销 Toast（桌面多选删除专用；key 变化重置 5s 计时） */}
      {sel.pendingCount > 0 && (
        <UndoToast
          key={sel.pendingKey}
          message={`已删除 ${sel.pendingCount} 条发音`}
          onUndo={sel.undoDelete}
          onDismiss={sel.commitPending}
        />
      )}
    </>
  )
}
