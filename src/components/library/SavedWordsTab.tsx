/**
 * @module   SavedWordsTab
 * @desc     素材库「词组收藏」tab —— 记忆卡片入口 + 收藏词组列表（PhraseDetailCard）。
 *           移动端左滑删除（SwipeToDelete）；桌面端复用 useSelectMode 多选删除，选择态由 SelectableCardWrapper
 *           外壳叠加（不改 PhraseDetailCard）。删除延迟持久化：待删先隐藏，5s 内可撤销，到期/卸载才真删。
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useEffect, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Layers, ChevronRight, Trash2 } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import PhraseDetailCard from '@/components/analysis/PhraseDetailCard'
import SwipeToDelete from '@/components/library/SwipeToDelete'
import SelectableCardWrapper from '@/components/library/SelectableCardWrapper'
import UndoToast from '@/components/UndoToast'
import IconButton from '@/components/IconButton'
import useSelectMode from '@/hooks/useSelectMode'
import { makeSearchFilter, searchEmptyTitle, type SearchCounts } from '@/lib/search'
import { getSavedWords, removeSavedWord } from '@/lib/storage'
import { getDueCount, listDeckWordIds, addPhraseCard } from '@/lib/db/phrase-cards'
import type { SavedWord } from '@/lib/types'

/**
 * toolbarSlotRef：桌面端把「选择」/多选工具栏 Portal 到 tab 栏右侧槽（LibraryDesktop 提供）；移动端不传。
 * onSelectingChange：通知外层（LibraryDesktop）选择模式变化，用于禁用同排的搜索图标。
 * searchQuery：桌面搜索词（防抖后）；移动端不传 → 恒不过滤。
 * onSearchCountsChange：上报实时（匹配数, 总数）供 tab 胶囊显示「匹配/总数」；移动端不传。
 */
interface Props {
  toolbarSlotRef?: React.RefObject<HTMLDivElement | null>
  onSelectingChange?: (selecting: boolean) => void
  searchQuery?: string
  onSearchCountsChange?: (counts: SearchCounts) => void
}

const getWordId = (w: SavedWord): string => w.id
/** 可搜文本：词组 + 释义 + 场景 + 分组 */
const getWordText = (w: SavedWord): string => [w.text, w.meaning, w.scene, w.group].join(' ')

export default function SavedWordsTab({ toolbarSlotRef, onSelectingChange, searchQuery, onSearchCountsChange }: Props): JSX.Element | null {
  const [words, setWords] = useState<SavedWord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [deckIds, setDeckIds] = useState<Set<string>>(new Set())
  const [dueCount, setDueCount] = useState(0)

  const filterFn = useMemo(() => makeSearchFilter(searchQuery ?? '', getWordText), [searchQuery])
  const sel = useSelectMode({
    initialItems: words,
    getId: getWordId,
    removeFn: removeSavedWord,
    onSelectingChange,
    filterFn,
  })
  const searching = (searchQuery ?? '').trim() !== ''

  // 上报实时计数（匹配=可见项，总数=扣除待删）供 tab 胶囊显示「匹配/总数」
  useEffect(() => {
    onSearchCountsChange?.({ matched: sel.visibleItems.length, total: sel.items.length - sel.pendingCount })
  }, [sel.visibleItems.length, sel.items.length, sel.pendingCount, onSearchCountsChange])

  // Portal 落点在 LibraryDesktop 的 DOM 里，首帧 ref.current 尚未挂载；挂载后翻标志重渲染。移动端不传 ref → 恒 null → 无工具栏。
  const [slotReady, setSlotReady] = useState(false)
  useEffect(() => { setSlotReady(true) }, [])
  const toolbarSlot = slotReady ? toolbarSlotRef?.current ?? null : null

  useEffect(() => {
    setWords(getSavedWords())
    setLoaded(true)
  }, [])

  // 记忆卡片数据（Supabase）：异步加载，不阻塞词组列表浏览
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [ids, count] = await Promise.all([listDeckWordIds(), getDueCount()])
        if (cancelled) return
        setDeckIds(new Set(ids))
        setDueCount(count)
      } catch {
        // 拿不到也不影响收藏列表
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleAdd = async (w: SavedWord): Promise<void> => {
    try {
      await addPhraseCard({ text: w.text, meaning: w.meaning, scene: w.scene, group: w.group, sourceWordId: w.id })
      setDeckIds(prev => new Set(prev).add(w.id))
      setDueCount(c => c + 1)   // 新卡立即到期
    } catch {
      // 失败则不标记，用户可重试
    }
  }

  if (!loaded) return null
  if (sel.items.length === 0) {
    return (
      <EmptyState
        title="还没有收藏词组"
        subtitle="题目分析里点开任意词组，点收藏即可保存到这里"
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

      {searching && sel.visibleItems.length === 0 ? (
        <div className="pt-3"><EmptyState title={searchEmptyTitle(searchQuery ?? '')} subtitle="换个关键词试试" /></div>
      ) : (
      <div className="flex flex-col gap-3 pt-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start">
        {/* 记忆卡片入口（搜索中隐藏，保持结果纯净；选择模式下拦截点击，避免误导航） */}
        {!searching && (
          <Link
            href="/review"
            className={`flex items-center gap-2.5 bg-white rounded-[14px] border border-black/[0.05] px-4 py-3 active:scale-[0.99] transition-transform duration-150 lg:col-span-2 ${sel.selecting ? 'pointer-events-none' : ''}`}
          >
            <Layers size={16} className="text-brand-primary" />
            <span className="text-[13px] font-medium text-v2-text-primary">
              {dueCount > 0 ? `待复习 ${dueCount} 张` : '记忆卡片'}
            </span>
            <span className="ml-auto flex items-center gap-0.5 text-[12px] text-v2-text-muted">
              {dueCount > 0 ? '开始复习' : '暂无待复习'}
              <ChevronRight size={14} />
            </span>
          </Link>
        )}

        {/* wrapper 在外、SwipeToDelete 在内：选择模式的顶部留白落在页面底色上，不会露出 swipe 的红色删除背景 */}
        {sel.visibleItems.map(w => (
          <SelectableCardWrapper
            key={w.id}
            selecting={sel.selecting}
            selected={sel.isSelected(w.id)}
            onToggle={() => sel.toggleSelect(w.id)}
            radius={14}
            checkboxSide="right"
          >
            <SwipeToDelete
              borderRadius={14}
              onDelete={() => sel.removeImmediate(w.id)}
            >
              <PhraseDetailCard
                text={w.text}
                meaning={w.meaning}
                scene={w.scene}
                group={w.group}
                level={w.level}
                inDeck={deckIds.has(w.id)}
                onAddToMemory={() => void handleAdd(w)}
                /* 桌面实例（收到 toolbarSlotRef）：播放内联紧跟词组、右上角让位给 checkbox；移动实例不传 → 一像素不变 */
                inlineSpeaker={!!toolbarSlotRef}
              />
            </SwipeToDelete>
          </SelectableCardWrapper>
        ))}
      </div>
      )}

      {/* 撤销 Toast（桌面多选删除专用；key 变化重置 5s 计时） */}
      {sel.pendingCount > 0 && (
        <UndoToast
          key={sel.pendingKey}
          message={`已删除 ${sel.pendingCount} 个词组`}
          onUndo={sel.undoDelete}
          onDismiss={sel.commitPending}
        />
      )}
    </>
  )
}
