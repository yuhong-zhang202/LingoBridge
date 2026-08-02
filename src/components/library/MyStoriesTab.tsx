/**
 * @module   MyStoriesTab
 * @desc     素材库「我的语料」tab —— Supabase 语料卡列表。移动端左滑单删（乐观，走父级 onDelete）；
 *           桌面端复用 useSelectMode 多选，但删除走独立流程：ConfirmDialog 二次确认 → 并行真删
 *           （deleteCorpus，allSettled）→ 父级 onRefresh 重拉 → 结果 Toast。不走 5s 撤销（DB 真删不可逆）。
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNav } from '@/components/NavProgress'
import { Mic2, Keyboard, ChevronRight, Trash2 } from 'lucide-react'
import { BRAND_GRADIENT_SOFT, GRADIENT_BORDER_STYLE_FULL_OPAQUE } from '@/lib/constants'
import type { MyStory } from '@/lib/types'
import Tag from '@/components/Tag'
import EmptyState from '@/components/EmptyState'
import SwipeToDelete from '@/components/library/SwipeToDelete'
import SelectableCardWrapper from '@/components/library/SelectableCardWrapper'
import IconButton from '@/components/IconButton'
import Toast from '@/components/Toast'
import ConfirmDialog from '@/components/ConfirmDialog'
import useSelectMode from '@/hooks/useSelectMode'
import { makeSearchFilter, searchEmptyTitle, type SearchCounts } from '@/lib/search'
import { deleteCorpus } from '@/lib/db/corpus'

/**
 * onDelete：移动端左滑单删（乐观移除，由 page.tsx 提供）。
 * onRefresh：桌面批量删除后静默重拉列表。
 * toolbarSlotRef / onSelectingChange：桌面选择模式的 Portal 槽与状态通知（移动端不传）。
 * searchQuery：桌面搜索词（防抖后）；移动端不传 → 恒不过滤。
 * onSearchCountsChange：上报实时（匹配数, 总数）供 tab 胶囊显示「匹配/总数」；移动端不传。
 */
interface Props {
  stories: MyStory[]
  onDelete?: (id: string) => void
  onRefresh?: () => void
  toolbarSlotRef?: React.RefObject<HTMLDivElement | null>
  onSelectingChange?: (selecting: boolean) => void
  searchQuery?: string
  onSearchCountsChange?: (counts: SearchCounts) => void
}

const getStoryId = (s: MyStory): string => s.id
/** 可搜文本：内容 + 输入方式 + 主维度 */
const getStoryText = (s: MyStory): string => [s.content, s.inputType, s.dimension ?? ''].join(' ')
/** stories 不走 5s 延迟真删，hook 的 removeFn 用不到；给个稳定空函数避免 effect 抖动 */
const NOOP = (): void => {}

export default function MyStoriesTab({ stories, onDelete, onRefresh, toolbarSlotRef, onSelectingChange, searchQuery, onSearchCountsChange }: Props) {
  // 「查看」跳 /matching、空态「去录制」跳首页均走 navigate → 点击当帧亮顶部进度条（消冷缓存空窗）
  const { navigate } = useNav()

  const filterFn = useMemo(() => makeSearchFilter(searchQuery ?? '', getStoryText), [searchQuery])
  const sel = useSelectMode({
    initialItems: stories,
    getId: getStoryId,
    removeFn: NOOP,
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

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resultHint, setResultHint] = useState<string | null>(null)

  // 确认框「确认删除」：并行真删，收集成功/失败，刷新并报告结果
  const handleConfirmDelete = async (): Promise<void> => {
    setBusy(true)
    const ids = Array.from(sel.selectedIds)
    const results = await Promise.allSettled(ids.map(id => deleteCorpus(id)))
    const failed = results.filter(r => r.status === 'rejected').length
    const succeeded = ids.length - failed
    setBusy(false)
    setConfirmOpen(false)
    sel.exitSelecting()
    onRefresh?.()
    setResultHint(failed === 0
      ? `已删除 ${succeeded} 条素材`
      : `${succeeded} 条已删除，${failed} 条删除失败`)
  }

  if (sel.items.length === 0) {
    return (
      <EmptyState
        title="还没有语料"
        subtitle="去首页录一条故事，它会自动出现在这里"
        ctaLabel="去录制"
        onCta={() => navigate('/')}
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
            <button onClick={sel.exitSelecting} className="text-[0.8125rem] text-v2-text-muted hover:text-v2-text-primary transition-colors">取消</button>
            <span className="text-[0.8125rem] text-v2-text-muted">已选 {sel.selectedCount} 项</span>
            <button onClick={sel.toggleSelectAll} className="text-[0.8125rem] text-v2-text-secondary hover:text-v2-text-primary transition-colors">
              {sel.allSelected ? '取消全选' : '全选'}
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={sel.selectedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[0.8125rem] font-medium text-white bg-error active:scale-[0.97] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
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
      // 桌面 items-stretch：同行两卡等高，消除参差（移动端单列不受影响）
      <div className="flex flex-col gap-3 pt-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-stretch">
        {sel.visibleItems.map(story => (
          <SelectableCardWrapper
            key={story.id}
            selecting={sel.selecting}
            selected={sel.isSelected(story.id)}
            onToggle={() => sel.toggleSelect(story.id)}
            radius={16}
            checkboxSide="right"
          >
            <SwipeToDelete borderRadius={16} onDelete={() => onDelete?.(story.id)}>
              <div style={GRADIENT_BORDER_STYLE_FULL_OPAQUE} className="rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 lg:h-full">
                <div className="flex items-center gap-2 mb-2.5">
                  {story.inputType === 'voice' ? (
                    <div className="flex-shrink-0 inline-flex" style={{ background: BRAND_GRADIENT_SOFT, borderRadius: 9999, padding: 1 }}>
                      <div className="flex items-center gap-1 bg-white" style={{ borderRadius: 9999, padding: '2px 8px' }}>
                        <Mic2 size={11} className="text-brand-primary-dark" />
                        <span className="text-[0.6875rem] font-medium text-brand-primary-dark">{story.duration}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-shrink-0 inline-flex" style={{ background: BRAND_GRADIENT_SOFT, borderRadius: 9999, padding: 1 }}>
                      <div className="flex items-center gap-1 bg-white" style={{ borderRadius: 9999, padding: '2px 8px' }}>
                        <Keyboard size={11} className="text-brand-primary-dark" />
                        <span className="text-[0.6875rem] font-medium text-brand-primary-dark">文本</span>
                      </div>
                    </div>
                  )}
                  <span className="text-[0.75rem] text-v2-text-muted">{story.createdAt}</span>
                </div>
                {/* lg:min-h 4.8em = 3 × leading-[1.6]，恰为三行文本盒高，短语料也占满三行（随字号自适应，不写死 px） */}
                <p className="text-[0.875rem] text-v2-text-primary leading-[1.6] line-clamp-3 mb-2.5 lg:min-h-[4.8em]">
                  {story.content}
                </p>
                {/* 元信息行容器恒渲染、内容仍条件渲染：桌面留出定高一行保证卡片等高；移动端无 min-h 时空行高度为 0 */}
                <div className="flex items-center gap-2 lg:min-h-[21px]">
                  {story.dimension && <Tag variant="green" label={story.dimension} />}
                  {story.matchedCount > 0 && (
                    <>
                      <span className="text-[0.75rem] text-v2-text-muted">已匹配 {story.matchedCount} 道题</span>
                      <button
                        onClick={() => navigate(`/matching?corpusId=${story.id}`)}
                        className="flex items-center gap-0.5 text-[0.75rem] font-medium text-brand-primary"
                      >
                        查看<ChevronRight size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </SwipeToDelete>
          </SelectableCardWrapper>
        ))}
      </div>
      )}

      {/* 批量删除二次确认（不可撤销）*/}
      <ConfirmDialog
        open={confirmOpen}
        title="确认删除"
        description={`确认删除 ${sel.selectedCount} 条素材？此操作不可撤销。`}
        danger
        loading={busy}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmOpen(false)}
      />

      {/* 结果提示（底部居中，与左滑等无冲突）*/}
      <Toast message={resultHint} onDismiss={() => setResultHint(null)} />
    </>
  )
}
