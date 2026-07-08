/**
 * @module   CollectedCardsTab
 * @desc     素材库「收藏卡片」tab —— 卡片视觉两端对齐 feedback（见 CollectedCard）。按断点分两份渲染：
 *           移动端单列 flex + 左滑删除；桌面端两列 grid + 顶部工具栏「多选删除」（选择/全选/删除 + 撤销 Toast）。
 *           多选删除编排统一走 useSelectMode（删除延迟持久化：待删先隐藏，5s 内可撤销，到期/卸载才真删）。
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import CollectedCard from '@/components/CollectedCard'
import EmptyState from '@/components/EmptyState'
import UndoToast from '@/components/UndoToast'
import IconButton from '@/components/IconButton'
import useSelectMode from '@/hooks/useSelectMode'
import { makeSearchFilter, searchEmptyTitle, type SearchCounts } from '@/lib/search'
import { removeSavedPhrase } from '@/lib/storage'
import type { CollectedCard as CollectedCardData } from '@/lib/types'

/**
 * toolbarSlotRef：桌面端把「选择」/多选工具栏 Portal 到 tab 栏右侧槽（LibraryDesktop 提供）；移动端不传。
 * onSelectingChange：通知外层（LibraryDesktop）选择模式变化，用于禁用同排的搜索图标。
 * searchQuery：桌面搜索词（防抖后）；移动端不传 → 恒不过滤。
 * onSearchCountsChange：上报实时（匹配数, 总数）供 tab 胶囊显示「匹配/总数」；移动端不传。
 */
interface Props {
  cards: CollectedCardData[]
  toolbarSlotRef?: React.RefObject<HTMLDivElement | null>
  onSelectingChange?: (selecting: boolean) => void
  searchQuery?: string
  onSearchCountsChange?: (counts: SearchCounts) => void
}

const getCardId = (c: CollectedCardData): string => c.id
/** 可搜文本：原句 + 优化句 + 题目 + 关键词 */
const getCardText = (c: CollectedCardData): string =>
  [c.originalSentence, c.aiOptimized, c.topicEn, (c.keywords ?? []).join(' ')].join(' ')

export default function CollectedCardsTab({ cards, toolbarSlotRef, onSelectingChange, searchQuery, onSearchCountsChange }: Props) {
  const filterFn = useMemo(() => makeSearchFilter(searchQuery ?? '', getCardText), [searchQuery])
  const sel = useSelectMode({
    initialItems: cards,
    getId: getCardId,
    removeFn: removeSavedPhrase,
    onSelectingChange,
    filterFn,
  })
  const searching = (searchQuery ?? '').trim() !== ''

  // 上报实时计数（匹配=可见项，总数=扣除待删）供 tab 胶囊显示「匹配/总数」
  useEffect(() => {
    onSearchCountsChange?.({ matched: sel.visibleItems.length, total: sel.items.length - sel.pendingCount })
  }, [sel.visibleItems.length, sel.items.length, sel.pendingCount, onSearchCountsChange])

  // Portal 落点在父组件（LibraryDesktop）的 DOM 里，首次 render 时 ref.current 尚未挂载；
  // 挂载后翻此标志触发重渲染，届时 toolbarSlotRef.current 已就绪。移动端不传 ref → 恒为 null → 不渲染工具栏。
  const [slotReady, setSlotReady] = useState(false)
  useEffect(() => { setSlotReady(true) }, [])
  const toolbarSlot = slotReady ? toolbarSlotRef?.current ?? null : null

  if (sel.items.length === 0) {
    return (
      <EmptyState
        title="还没有收藏卡片"
        subtitle="练习后左滑卡片即可收藏，随时复习"
      />
    )
  }

  return (
    <>
      {/* 移动端：单列 flex + 左滑删除（无选择模式） */}
      {/* px-1（4px/side）补偿 library px-5 与 feedback px-6 的宽度差，使卡片内文字换行一致 */}
      <div className="lg:hidden flex flex-col gap-3 pt-3 px-1">
        {searching && sel.visibleItems.length === 0 ? (
          <EmptyState title={searchEmptyTitle(searchQuery ?? '')} subtitle="换个关键词试试" />
        ) : (
          sel.visibleItems.map(card => (
            <CollectedCard key={card.id} card={card} enableSwipe onDelete={sel.removeImmediate} />
          ))
        )}
      </div>

      {/* 桌面端工具栏：Portal 到 tab 栏右侧槽，与 tab 栏同一行右对齐（未选择=「选择」；选择中=取消/已选N/全选/删除） */}
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

      {/* 桌面端：两列 grid（多选删除）；搜索无结果时回显空状态 */}
      <div className="hidden lg:block pt-3 px-1">
        {searching && sel.visibleItems.length === 0 ? (
          <EmptyState title={searchEmptyTitle(searchQuery ?? '')} subtitle="换个关键词试试" />
        ) : (
          <div className="grid grid-cols-2 gap-3 items-start">
            {sel.visibleItems.map(card => (
              <CollectedCard
                key={card.id}
                card={card}
                enableSwipe={false}
                onDelete={sel.removeImmediate}
                selecting={sel.selecting}
                selected={sel.isSelected(card.id)}
                onSelectToggle={sel.toggleSelect}
              />
            ))}
          </div>
        )}
      </div>

      {/* 撤销 Toast（桌面多选删除专用；key 变化重置 5s 计时） */}
      {sel.pendingCount > 0 && (
        <UndoToast
          key={sel.pendingKey}
          message={`已删除 ${sel.pendingCount} 张卡片`}
          onUndo={sel.undoDelete}
          onDismiss={sel.commitPending}
        />
      )}
    </>
  )
}
