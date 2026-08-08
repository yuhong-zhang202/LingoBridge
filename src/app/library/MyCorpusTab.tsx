/**
 * @module   MyCorpusTab
 * @desc     素材库「我的语料」tab —— 一条语料一张卡（改版前是「语料匹配」，按对子铺卡）。
 *
 *           为什么换单位（2026-08-08 改版，产品方拍板）：
 *           1. 删除的目标本来就是「一条语料」。按对子铺卡时，同一条语料绑 3 道题会出现 3 张卡，
 *              而删任一张会按 corpusId 连带移除全部同源卡 —— 用户点了一张、消失了三张，事先毫无预告。
 *              改成语料单位后「删这张卡 = 删这条语料」变成字面真理。
 *           2. 未绑题的语料以前在此完全不可见、也删不了（用户反馈：「我录了故事，素材库里找不到」）。
 *              现在同样一张卡，只是少了题目 Chip 区、多一个「去匹配题目」入口。
 *
 *           数据：listMyCorpus()（全部语料）与 fetchAnkiCards(1|2,'answered')（对子）并发拉取，
 *           客户端按 corpusId 合并（mergeCorpusWithCards）。挂载即重拉，别处存完对子回本 tab 立刻可见。
 *
 *           删语料两条路（都真删、都走 deleteCorpus）：
 *           - 移动：卡右上角 44×44 删除入口 → ConfirmDialog 二次确认。
 *           - 桌面：tab 栏右侧多选工具栏 → ConfirmDialog 二次确认 → 5s 撤销 Toast 后真删。
 *             桌面这道确认框是本次新加的：deleteCorpus 会连用户手动编辑过的卡背一起清（0060 事务型 RPC），
 *             移动端早有确认框告知，桌面批量原先只有撤销窗口、没有任何「删了会连带清掉什么」的知情点。
 *
 *           口径：本 tab 的 onCountChange 上报的是【语料数】，与 hub 顶部「已攒下 N 条」同源。
 *           ⚠️ 别改回对子数 —— 那正是改版前 hub 说 12 条、tab 徽标显示 7 的来源，用户一眼就能看出对不上。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { useState, useEffect, useRef, useMemo, useCallback, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import { useNav } from '@/components/NavProgress'
import Card from '@/components/Card'
import Skeleton from '@/components/Skeleton'
import EmptyState from '@/components/EmptyState'
import OfflineState from '@/components/OfflineState'
import ConfirmDialog from '@/components/ConfirmDialog'
import Toast from '@/components/Toast'
import IconButton from '@/components/IconButton'
import UndoToast from '@/components/UndoToast'
import useSelectMode from '@/hooks/useSelectMode'
import { fetchAnkiCards } from '@/lib/anki/cards-client'
import { deleteCorpus, listMyCorpus } from '@/lib/db/corpus'
import { ensureSession } from '@/lib/supabase'
import { makeSearchFilter, searchEmptyTitle, type SearchCounts } from '@/lib/search'
import MyCorpusFilterBar from './MyCorpusFilterBar'
import MyCorpusList from './MyCorpusList'
import {
  mergeCorpusWithCards,
  itemSearchText,
  matchesFilter,
  countByFilter,
  resolveListState,
  deleteConfirmDescription,
  bulkDeleteConfirmDescription,
  type MyCorpusItem,
  type CorpusFilter,
} from './my-corpus-model'

/**
 * toolbarSlotRef：桌面端把「选择」/多选工具栏 Portal 到 tab 栏右侧槽（LibraryDesktop 提供）；移动端不传。
 * onSelectingChange：通知外层（LibraryDesktop）选择模式变化，用于禁用同排的搜索图标。
 * searchQuery：桌面搜索词（防抖后）/ 移动端常驻搜索条的词。
 * onSearchCountsChange：上报实时（匹配数, 总数）供桌面 tab 胶囊显示「匹配/总数」；移动端不传。
 * onCountChange：上报当前【语料】总数（不受搜索/筛选/待删影响），供素材库徽标即时回落。
 */
interface Props {
  toolbarSlotRef?: React.RefObject<HTMLDivElement | null>
  onSelectingChange?: (selecting: boolean) => void
  searchQuery?: string
  onSearchCountsChange?: (counts: SearchCounts) => void
  onCountChange?: (n: number) => void
}

/** 列表项 id = corpusId（删除目标同一个 id，两者对齐是本次改版的核心）。 */
function getItemId(item: MyCorpusItem): string {
  return item.id
}

export default function MyCorpusTab({
  toolbarSlotRef,
  onSelectingChange,
  searchQuery,
  onSearchCountsChange,
  onCountChange,
}: Props): JSX.Element {
  // 跳 /analysis、/matching、首页均走 navigate → 点击当帧亮顶部进度条，消跳转白屏
  const { navigate } = useNav()
  const [items, setItems] = useState<MyCorpusItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<CorpusFilter>('all')
  // 移动端卡角删除：待删语料（点删除按钮后置入 → 弹确认框）；deleting 锁按钮；toast 报结果
  const [pendingDelete, setPendingDelete] = useState<MyCorpusItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // 桌面批量删除的二次确认（确认后才进 useSelectMode 的 5s 撤销窗口）
  const [bulkConfirm, setBulkConfirm] = useState(false)

  // 挂载即拉：全部语料 + 当季已答对子，两者并发（串行会白等一整个往返）。失败置 error
  //（离线走 OfflineState，其余走可重试空态）。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        // 先确保会话 token 就位再拉（GET /api/anki/cards 对匿名放行但仍需 Bearer），与 library/page.tsx 同范式，
        // 防会话未建时 401 误判空态。
        await ensureSession()
        const [corpus, p1, p2] = await Promise.all([
          listMyCorpus(),
          fetchAnkiCards(1, 'answered'),
          fetchAnkiCards(2, 'answered'),
        ])
        if (cancelled) return
        setItems(mergeCorpusWithCards(corpus, [...p1, ...p2]))
      } catch (e) {
        if (cancelled) return
        console.warn('[MyCorpusTab] 加载语料失败', e)
        setError('语料没加载出来，请重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // 稳定回调内读最新 items（避免把 items 塞进 removeFn 依赖导致 useSelectMode 反复重建）
  const itemsRef = useRef<MyCorpusItem[]>(items)
  itemsRef.current = items

  // useSelectMode 真删回调：id 就是 corpusId，直接 deleteCorpus（单事务：清空绑定题卡的卡背 +
  // corpus_id 置空退回题目分析 + 删 corpus 行，links/matches 由 cascade 清）。
  // fire-and-forget（失败记日志），成功后从源 items 移除，列表与徽标随之收敛。
  const removeFn = useCallback((corpusId: string): void => {
    if (!itemsRef.current.some((it) => it.id === corpusId)) return
    void deleteCorpus(corpusId)
      .then(() => setItems((prev) => prev.filter((it) => it.id !== corpusId)))
      .catch((e) => console.warn('[MyCorpusTab] 删除语料失败', e))
  }, [])

  const searchFn = useMemo(() => makeSearchFilter(searchQuery ?? '', itemSearchText), [searchQuery])
  // 搜索 + 筛选一起进 filterFn：全选/删除只作用于「当前看得见的那批」，不会误伤被筛掉的语料
  const filterFn = useMemo(
    () => (item: MyCorpusItem): boolean => (searchFn ? searchFn(item) : true) && matchesFilter(item, filter),
    [searchFn, filter],
  )
  const sel = useSelectMode({
    initialItems: items,
    getId: getItemId,
    removeFn,
    onSelectingChange,
    filterFn,
  })
  const searching = (searchQuery ?? '').trim() !== ''

  // 未被待删挡住的工作副本（5s 撤销窗口内 pending 项在列表里已消失，派生计数必须同步扣掉）
  const liveItems = useMemo(
    () => sel.items.filter((it) => !sel.pendingIds.has(it.id)),
    [sel.items, sel.pendingIds],
  )
  // 筛选 Chip 的三档计数按「搜索过滤后」的集合算 —— 与用户此刻能看到的条数一致
  const counts = useMemo(
    () => countByFilter(searchFn ? liveItems.filter(searchFn) : liveItems),
    [liveItems, searchFn],
  )

  const listState = resolveListState({
    loading,
    error: error !== null,
    totalCount: liveItems.length,
    searching,
    filter,
    visibleCount: sel.visibleItems.length,
  })

  // 上报实时计数（匹配=可见项，总数=扣除待删）供桌面 tab 胶囊「匹配/总数」
  useEffect(() => {
    onSearchCountsChange?.({ matched: sel.visibleItems.length, total: sel.items.length - sel.pendingCount })
  }, [sel.visibleItems.length, sel.items.length, sel.pendingCount, onSearchCountsChange])

  // 上报语料总数（items.length，与 hub「已攒下 N 条」同口径，不随搜索/筛选/待删波动）供徽标即时回落
  useEffect(() => {
    onCountChange?.(items.length)
  }, [items.length, onCountChange])

  // Portal 落点在 LibraryDesktop 的 DOM 里，首帧 ref.current 尚未挂载；挂载后翻标志重渲染。移动端不传 ref → 恒 null → 无工具栏。
  const [slotReady, setSlotReady] = useState(false)
  useEffect(() => { setSlotReady(true) }, [])
  const toolbarSlot = slotReady ? toolbarSlotRef?.current ?? null : null

  // 移动端卡角删除确认：真删 + 从列表移除
  const handleConfirmDelete = async (): Promise<void> => {
    const target = pendingDelete
    if (!target) return
    setDeleting(true)
    try {
      await deleteCorpus(target.id)
      setItems((prev) => prev.filter((it) => it.id !== target.id))
      setToast(target.questions.length > 0
        ? '已删除语料，绑着的题卡已退回题目分析'
        : '已删除这条语料')
    } catch (e) {
      console.warn('[MyCorpusTab] 删除语料失败', e)
      setToast('删除失败，请重试')
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }

  // 桌面批量：被选中的语料里有几条正绑着题（决定确认文案后半句）
  const selectedBoundCount = liveItems.filter((it) => sel.selectedIds.has(it.id) && it.questions.length > 0).length
  const openQuestion = (corpusId: string, questionId: string): void => {
    // 与 useGotoPractice 复练同范式：storyId=corpusId、review=1，从分析页可进练习
    navigate(`/analysis?questionId=${encodeURIComponent(questionId)}&storyId=${encodeURIComponent(corpusId)}&review=1`)
  }
  // ⚠️ 落点不是静态查看：/matching 会跑一整条 AI 匹配（数十秒 + 可能撞 402/429），故 CTA 文案是「去匹配题目」、
  // 绝不能退回「查看」那类暗示「只是看一眼」的措辞
  const findQuestions = (corpusId: string): void => navigate(`/matching?corpusId=${encodeURIComponent(corpusId)}`)

  if (listState === 'loading') {
    return (
      <div className="flex flex-col gap-3 pt-3 lg:grid lg:grid-cols-2 lg:gap-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <Skeleton className="w-12 h-5 rounded-full" />
              <Skeleton className="w-16 h-5 rounded-full" />
            </div>
            <Skeleton className="w-full h-[14px]" />
            <Skeleton className="w-[70%] h-[14px] mt-2" />
            <Skeleton className="w-full h-[13px] mt-3.5" />
          </Card>
        ))}
      </div>
    )
  }

  if (listState === 'error') {
    return typeof navigator !== 'undefined' && !navigator.onLine
      ? <OfflineState onRetry={() => window.location.reload()} />
      : <EmptyState title="语料没加载出来" subtitle={error ?? undefined} ctaLabel="重试" onCta={() => window.location.reload()} orbSize={100} />
  }

  // 「一条语料都没有」：等加载完才可能到这一档（loading 已在上面拦下），不会闪
  if (listState === 'empty-no-corpus') {
    return (
      <EmptyState
        title="还没有你的语料"
        subtitle="讲一段你自己的经历，它会存在这里，随时能绑到题目上。"
        ctaLabel="去讲一段"
        onCta={() => navigate('/')}
      />
    )
  }

  return (
    <>
      {/* 桌面端多选删除工具栏：Portal 到 tab 栏右侧槽（搜索图标右边）。照「词组收藏」同款（未选择=「选择」；选择中=取消/已选N/全选/删除） */}
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
              onClick={() => setBulkConfirm(true)}
              disabled={sel.selectedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[0.8125rem] font-medium text-white bg-error active:scale-[0.97] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} />删除 ({sel.selectedCount})
            </button>
          </div>
        ),
        toolbarSlot
      )}

      <MyCorpusFilterBar value={filter} onChange={setFilter} counts={counts} />

      {listState === 'list' && (
        <MyCorpusList
          items={sel.visibleItems}
          selecting={sel.selecting}
          isSelected={sel.isSelected}
          onToggleSelect={sel.toggleSelect}
          onRequestDelete={setPendingDelete}
          onOpenQuestion={openQuestion}
          onFindQuestions={findQuestions}
        />
      )}

      {listState === 'empty-search' && (
        <div className="pt-3"><EmptyState title={searchEmptyTitle(searchQuery ?? '')} subtitle="换个关键词试试" /></div>
      )}

      {listState === 'empty-paired' && (
        <EmptyState
          title="还没有语料匹配"
          subtitle="刷题时遇到想练的题，把你的一段真实经历绑上去"
          ctaLabel="去刷题卡"
          onCta={() => navigate('/anki/review')}
        />
      )}

      {/* 「还没绑题目」为空是好消息、不是空手而归，故不上 Orb 大空态：
          筛选切换时整块跳动很晃，一行轻提示 + 一个回退按钮就够 */}
      {listState === 'empty-unpaired' && (
        <div className="flex flex-col items-center text-center pt-10">
          <p className="text-[0.8125rem] text-v2-text-secondary">你的语料都绑上题目了。</p>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="mt-1 min-h-[44px] inline-flex items-center justify-center px-3 text-[0.8125rem] font-medium text-v2-text-secondary active:opacity-60"
          >
            看全部
          </button>
        </div>
      )}

      {/* 移动端删语料二次确认（不可撤销）*/}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条语料？"
        description={deleteConfirmDescription(pendingDelete?.questions.length ?? 0)}
        danger
        loading={deleting}
        loadingText="删除中…"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {/* 桌面批量删语料二次确认：确认后才进 5s 撤销窗口（撤销窗口只给「点错了」留后路，
          不承担告知「会连手动编辑过的卡背一起清」的职责） */}
      <ConfirmDialog
        open={bulkConfirm}
        title={`删除选中的 ${sel.selectedCount} 条语料？`}
        description={bulkDeleteConfirmDescription(sel.selectedCount, selectedBoundCount)}
        danger
        onConfirm={() => { setBulkConfirm(false); sel.deleteSelected() }}
        onCancel={() => setBulkConfirm(false)}
      />

      {/* 桌面多选删除撤销 Toast（5s 内撤销、到期真删；key 变化重置计时） */}
      {sel.pendingCount > 0 && (
        <UndoToast
          key={sel.pendingKey}
          message={`已删除 ${sel.pendingCount} 条语料`}
          onUndo={sel.undoDelete}
          onDismiss={sel.commitPending}
        />
      )}

      {/* 删除结果提示（移动端卡角删除用，底部居中）*/}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  )
}
