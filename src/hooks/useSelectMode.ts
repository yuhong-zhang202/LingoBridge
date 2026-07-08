/**
 * @module   useSelectMode
 * @desc     通用「多选删除」编排 hook —— 与数据字段、存储、UI 全解耦。持有列表工作副本，
 *           管理选择态 / 全选 / 待删缓冲（5s 撤销窗口）/ Esc 退出 / 卸载提交待删 / 移动端立即删。
 *           数据差异全靠 getId + removeFn 注入；文案由调用方按 pendingCount 自行拼（hook 不产 UI）。
 * @author   LingoBridge
 * @created  2026-07-07
 */
'use client'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'

interface UseSelectModeOptions<T> {
  /** 初始列表；async 首载时引用变化会被 reseed 采纳（见下方守卫） */
  initialItems: T[]
  /** 从一条数据取唯一 id —— hook 不认字段名 */
  getId: (item: T) => string
  /** 幂等持久化删除（localStorage 同步 / 未来 API）；对不存在 id 必须安全 */
  removeFn: (id: string) => void
  /** 选择模式变化通知（供外层禁用同排搜索图标等） */
  onSelectingChange?: (selecting: boolean) => void
  /**
   * 可见性过滤（如搜索）——只影响 visibleItems / allSelected / toggleSelectAll，让全选/删除只作用于过滤结果。
   * 不传（默认）时 visibleItems 仅按 pending 过滤，行为与不带搜索时完全一致。
   */
  filterFn?: (item: T) => boolean
}

interface UseSelectMode<T> {
  items: T[]
  visibleItems: T[]
  selecting: boolean
  selectedIds: Set<string>
  isSelected: (id: string) => boolean
  selectedCount: number
  allSelected: boolean
  pendingCount: number
  pendingKey: number
  enterSelecting: () => void
  exitSelecting: () => void
  toggleSelect: (id: string) => void
  toggleSelectAll: () => void
  deleteSelected: () => void
  undoDelete: () => void
  commitPending: () => void
  removeImmediate: (id: string) => void
}

/** 一次删除批次：ids + key（key 变化用于让 UndoToast 重挂载、重置 5s 计时） */
interface DeleteBatch { ids: string[]; key: number }

/**
 * 多选删除编排
 * @param options  initialItems / getId / removeFn / onSelectingChange
 * @returns        选择态与操作方法（不含任何 JSX 或文案）
 * @sideEffect     removeFn 写持久层；window keydown 监听（Esc）；卸载时提交未撤销的待删
 */
export default function useSelectMode<T>({ initialItems, getId, removeFn, onSelectingChange, filterFn }: UseSelectModeOptions<T>): UseSelectMode<T> {
  const [items, setItems]           = useState<T[]>(initialItems)
  const [selecting, setSelecting]   = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pending, setPending]       = useState<DeleteBatch | null>(null)
  const keyRef = useRef(0)

  // async 首载：initialItems 引用变化时采纳（如 []→loaded）。用「渲染期同步 state」模式（React 官方推荐），
  // 在同一帧内立即重渲染、无闪烁；守卫「非 pending 且非 selecting」避免中途重播冲掉乐观删除 / 选中态。
  // cards 场景引用稳定 → 播种一次后永不再触发，行为与重构前等价。
  const [seededFrom, setSeededFrom] = useState<T[]>(initialItems)
  if (initialItems !== seededFrom && !pending && !selecting) {
    setSeededFrom(initialItems)
    setItems(initialItems)
  }

  // 显示列表：先隐藏待删（不动 items 数组，撤销时原顺序天然恢复），再按 filterFn（如搜索）过滤。
  const visibleItems = useMemo(() => {
    const afterPending = pending ? items.filter(it => !pending.ids.includes(getId(it))) : items
    return filterFn ? afterPending.filter(filterFn) : afterPending
  }, [items, pending, getId, filterFn])
  const allSelected = visibleItems.length > 0 && selectedIds.size === visibleItems.length

  /** 真删一批：持久化 + 从 items 移除 */
  const commitBatch = useCallback((batch: DeleteBatch) => {
    batch.ids.forEach(removeFn)
    setItems(prev => prev.filter(it => !batch.ids.includes(getId(it))))
  }, [removeFn, getId])

  const exitSelecting = useCallback(() => { setSelecting(false); setSelectedIds(new Set()) }, [])
  const enterSelecting = useCallback(() => setSelecting(true), [])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }, [])
  const toggleSelectAll = useCallback(() => {
    setSelectedIds(allSelected ? new Set() : new Set(visibleItems.map(getId)))
  }, [allSelected, visibleItems, getId])

  const deleteSelected = useCallback(() => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    if (pending) commitBatch(pending)   // 并发：新批次前先把上一批真删（策略：新弹 Toast 即提交旧批）
    setPending({ ids, key: keyRef.current++ })
    exitSelecting()
  }, [selectedIds, pending, commitBatch, exitSelecting])

  const undoDelete = useCallback(() => setPending(null), [])   // items 未动，待删项按原顺序重现
  const commitPending = useCallback(() => {
    setPending(prev => { if (prev) commitBatch(prev); return null })
  }, [commitBatch])

  // 移动端左滑：立即真删（无撤销窗口）
  const removeImmediate = useCallback((id: string) => {
    removeFn(id)
    setItems(prev => prev.filter(it => getId(it) !== id))
  }, [removeFn, getId])

  // 通知外层选择模式变化
  useEffect(() => { onSelectingChange?.(selecting) }, [selecting, onSelectingChange])

  // 选择模式下按 Esc 退出
  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitSelecting() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting, exitSelecting])

  // 卸载（切 tab / 离开页面）时把未提交的待删真删掉，避免半删。
  // 用 ref 读最新 pending；removeFn 幂等，StrictMode 双卸载无害。
  const pendingRef = useRef<DeleteBatch | null>(pending)
  pendingRef.current = pending
  useEffect(() => () => { if (pendingRef.current) pendingRef.current.ids.forEach(removeFn) }, [removeFn])

  return {
    items,
    visibleItems,
    selecting,
    selectedIds,
    isSelected: (id: string) => selectedIds.has(id),
    selectedCount: selectedIds.size,
    allSelected,
    pendingCount: pending?.ids.length ?? 0,
    pendingKey: pending?.key ?? 0,
    enterSelecting,
    exitSelecting,
    toggleSelect,
    toggleSelectAll,
    deleteSelected,
    undoDelete,
    commitPending,
    removeImmediate,
  }
}
