/**
 * @module   CollectedCardsTab
 * @desc     素材库「收藏卡片」tab —— 卡片视觉两端对齐 feedback（见 CollectedCard）。按断点分两份渲染：
 *           移动端单列 flex + 左滑删除；桌面端两列 grid + 顶部工具栏「多选删除」（选择/全选/删除 + 撤销 Toast）。
 *           删除延迟持久化：待删卡先从 UI 隐藏，5s 内可撤销，到期/卸载才真删（removeSavedPhrase 幂等）。
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import CollectedCard from '@/components/CollectedCard'
import EmptyState from '@/components/EmptyState'
import UndoToast from '@/components/UndoToast'
import IconButton from '@/components/IconButton'
import { removeSavedPhrase } from '@/lib/storage'
import type { CollectedCard as CollectedCardData } from '@/lib/types'

/**
 * toolbarSlotRef：桌面端把「选择」/多选工具栏 Portal 到 tab 栏右侧槽（LibraryDesktop 提供）；移动端不传。
 * onSelectingChange：通知外层（LibraryDesktop）选择模式变化，用于禁用同排的搜索图标。
 */
interface Props {
  cards: CollectedCardData[]
  toolbarSlotRef?: React.RefObject<HTMLDivElement | null>
  onSelectingChange?: (selecting: boolean) => void
}

/** 一次删除批次：ids + key（key 变化用于让 UndoToast 重挂载、重置 5s 计时） */
interface DeleteBatch { ids: string[]; key: number }

export default function CollectedCardsTab({ cards: initialCards, toolbarSlotRef, onSelectingChange }: Props) {
  const [cards, setCards]               = useState(initialCards)
  const [selecting, setSelecting]       = useState(false)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [pending, setPending]           = useState<DeleteBatch | null>(null)
  const keyRef = useRef(0)
  // Portal 落点在父组件（LibraryDesktop）的 DOM 里，首次 render 时 ref.current 尚未挂载；
  // 挂载后翻此标志触发重渲染，届时 toolbarSlotRef.current 已就绪。移动端不传 ref → 恒为 null → 不渲染工具栏。
  const [slotReady, setSlotReady] = useState(false)
  useEffect(() => { setSlotReady(true) }, [])
  const toolbarSlot = slotReady ? toolbarSlotRef?.current ?? null : null

  // 显示列表：过滤掉待删的（用 filter 不动 cards 数组，撤销时原顺序天然恢复）
  const visible = pending ? cards.filter(c => !pending.ids.includes(c.id)) : cards
  const allSelected = visible.length > 0 && selectedIds.size === visible.length

  /** 仅持久化（写回 localStorage），不动 React state —— 供卸载 cleanup 用 */
  const persist = (ids: string[]) => ids.forEach(removeSavedPhrase)
  /** 真删一批：持久化 + 从 cards 移除 */
  const commitBatch = (batch: DeleteBatch) => {
    persist(batch.ids)
    setCards(prev => prev.filter(c => !batch.ids.includes(c.id)))
  }

  // 移动端左滑删除：立即真删（无撤销窗口，行为与原来一致）
  const handleDelete = (id: string) => {
    removeSavedPhrase(id)
    setCards(prev => prev.filter(c => c.id !== id))
  }

  const cancelSelect = () => { setSelecting(false); setSelectedIds(new Set()) }
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(visible.map(c => c.id)))
  }
  const deleteSelected = () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    if (pending) commitBatch(pending)   // 并发：新批次前先把上一批真删（策略：新弹 Toast 即提交旧批）
    setPending({ ids, key: keyRef.current++ })
    cancelSelect()
  }
  const undo = () => setPending(null)   // cards 未动，待删卡按原顺序重现

  // 通知外层（LibraryDesktop）选择模式变化：用于禁用同排的搜索图标
  useEffect(() => { onSelectingChange?.(selecting) }, [selecting, onSelectingChange])

  // 选择模式下按 Esc 退出
  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelSelect() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting])

  // 卸载（切 tab / 离开 /library）时把未提交的待删真删掉，避免半删。
  // 用 ref 读最新 pending；removeSavedPhrase 幂等，StrictMode 双卸载无害。
  const pendingRef = useRef<DeleteBatch | null>(pending)
  pendingRef.current = pending
  useEffect(() => () => { if (pendingRef.current) persist(pendingRef.current.ids) }, [])

  if (cards.length === 0) {
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
        {visible.map(card => (
          <CollectedCard key={card.id} card={card} enableSwipe onDelete={handleDelete} />
        ))}
      </div>

      {/* 桌面端工具栏：Portal 到 tab 栏右侧槽，与 tab 栏同一行右对齐（未选择=「选择」；选择中=取消/已选N/全选/删除） */}
      {toolbarSlot && createPortal(
        !selecting ? (
          <IconButton icon={Trash2} label="选择" onClick={() => setSelecting(true)} />
        ) : (
          <div className="flex items-center gap-4">
            <button onClick={cancelSelect} className="text-[13px] text-v2-text-muted hover:text-v2-text-primary transition-colors">取消</button>
            <span className="text-[13px] text-v2-text-muted">已选 {selectedIds.size} 项</span>
            <button onClick={toggleSelectAll} className="text-[13px] text-v2-text-secondary hover:text-v2-text-primary transition-colors">
              {allSelected ? '取消全选' : '全选'}
            </button>
            <button
              onClick={deleteSelected}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium text-white bg-error active:scale-[0.97] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} />删除 ({selectedIds.size})
            </button>
          </div>
        ),
        toolbarSlot
      )}

      {/* 桌面端：两列 grid（多选删除） */}
      <div className="hidden lg:block pt-3 px-1">
        <div className="grid grid-cols-2 gap-3 items-start">
          {visible.map(card => (
            <CollectedCard
              key={card.id}
              card={card}
              enableSwipe={false}
              onDelete={handleDelete}
              selecting={selecting}
              selected={selectedIds.has(card.id)}
              onSelectToggle={toggleSelect}
            />
          ))}
        </div>
      </div>

      {/* 撤销 Toast（桌面多选删除专用；key 变化重置 5s 计时） */}
      {pending && (
        <UndoToast
          key={pending.key}
          message={`已删除 ${pending.ids.length} 张卡片`}
          onUndo={undo}
          onDismiss={() => { commitBatch(pending); setPending(null) }}
        />
      )}
    </>
  )
}
