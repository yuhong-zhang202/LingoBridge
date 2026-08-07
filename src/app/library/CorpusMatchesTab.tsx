/**
 * @module   CorpusMatchesTab
 * @desc     素材库「语料匹配」tab —— 展示已确立的对子（anki_cards 里 corpusId 非空的当季卡）。
 *           挂载即拉 fetchAnkiCards(1|2,'answered') 后客户端 filter(corpusId!==null) 得当季所有对子
 *           （存完对子返回本 tab、重新挂载即见新对子）。点对子卡直达该题「题目分析」页
 *           （/analysis?questionId&storyId=corpusId&review=1，与 useGotoPractice 复练同范式），从分析页可进练习。
 *           删语料两条路（都真删、都走 deleteCorpus）：
 *           - 桌面：搜索图标右边的多选删除工具栏（复用 useSelectMode，照「词组收藏」同款：选择/全选/删除 + 5s 撤销 Toast）。
 *           - 移动：卡右上角删除入口（ConfirmDialog 二次确认，无 toolbar 槽）。
 *           删语料即解绑：绑定的 anki 卡 corpus_id 置空退回题目分析、卡背（generated_answer + edited_answer）
 *           一并清空，与删语料行在【同一个事务】里完成（0060 的 delete_corpus_and_clear_cards RPC，机制在 DB 层）。
 *           ⚠️ 别退回只靠外键：0030 的 on delete set null 只抹 corpus_id、不清卡背，那正是 2026-08-07
 *           修掉的「界面承诺卡背清空、实际答案还留着」的假承诺（详见 0060 顶注）。
 *           同一语料可绑多题（多个对子）——删任一对子即按 corpusId 移除其全部同源对子。
 *           注意：本 tab 只列已绑对子的语料（corpusId 非空）；未绑对子的语料在此看不到、也删不了。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Link2, Loader2, Trash2 } from 'lucide-react'
import { useNav } from '@/components/NavProgress'
import Card from '@/components/Card'
import Tag from '@/components/Tag'
import Skeleton from '@/components/Skeleton'
import EmptyState from '@/components/EmptyState'
import OfflineState from '@/components/OfflineState'
import ConfirmDialog from '@/components/ConfirmDialog'
import Toast from '@/components/Toast'
import IconButton from '@/components/IconButton'
import UndoToast from '@/components/UndoToast'
import SelectableCardWrapper from '@/components/library/SelectableCardWrapper'
import useSelectMode from '@/hooks/useSelectMode'
import { fetchAnkiCards } from '@/lib/anki/cards-client'
import { deleteCorpus } from '@/lib/db/corpus'
import { ensureSession } from '@/lib/supabase'
import { prettifyTopic } from '@/lib/topic'
import { makeSearchFilter, searchEmptyTitle, type SearchCounts } from '@/lib/search'
import type { AnkiCard } from '@/lib/anki/list'

/**
 * toolbarSlotRef：桌面端把「选择」/多选工具栏 Portal 到 tab 栏右侧槽（LibraryDesktop 提供）；移动端不传。
 * onSelectingChange：通知外层（LibraryDesktop）选择模式变化，用于禁用同排的搜索图标。
 * searchQuery：桌面搜索词（防抖后）；移动端不传 → 恒不过滤。
 * onSearchCountsChange：上报实时（匹配数, 总数）供桌面 tab 胶囊显示「匹配/总数」；移动端不传。
 * onCountChange：上报当前对子总数（pairs.length，不受搜索/待删影响），供素材库徽标（tab 胶囊 / 移动 hub）
 *   即时回落 —— 删对子后本 tab 更新 pairs → 上报 → 徽标同步，无需刷新。桌面/移动都传。
 */
interface Props {
  toolbarSlotRef?: React.RefObject<HTMLDivElement | null>
  onSelectingChange?: (selecting: boolean) => void
  searchQuery?: string
  onSearchCountsChange?: (counts: SearchCounts) => void
  onCountChange?: (n: number) => void
}

/** 对子题面：Part2 展示 cue card 标题（更贴合该题问法），其余用题面本身。 */
function pairTitle(card: AnkiCard): string {
  if (card.part === 2 && card.cueCardTitle) return card.cueCardTitle
  return card.questionText
}

/** 对子可搜文本：语料概括 + 题面 + 话题（大小写不敏感，交 makeSearchFilter）。 */
function pairSearchText(card: AnkiCard): string {
  return [card.corpusSummary ?? '', pairTitle(card), card.topic].join(' ')
}

/** 对子唯一 id：用 questionId（一题一对子行）；同源对子的批量移除按 corpusId 另行处理。 */
function getPairId(card: AnkiCard): string {
  return card.questionId
}

/** 卡背是否已就绪（可直接练/看）：生成完成或用户已编辑。其余（analysis）= 生成中。 */
function isBackReady(card: AnkiCard): boolean {
  return card.backKind === 'generated' || card.backKind === 'edited'
}

export default function CorpusMatchesTab({ toolbarSlotRef, onSelectingChange, searchQuery, onSearchCountsChange, onCountChange }: Props) {
  // 点对子卡跳 /analysis（AI 分析页）走 navigate 当帧亮顶部进度条，消跳转白屏
  const { navigate } = useNav()
  const [pairs, setPairs] = useState<AnkiCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 移动端卡角删除：待删语料（点卡角删除按钮后置入 → 弹确认框）；deleting 锁按钮；toast 报结果
  const [pendingDelete, setPendingDelete] = useState<AnkiCard | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // 挂载即拉当季对子：part1 + part2 已回答卡 → 客户端筛 corpusId 非空。每次进 tab 重挂载即重拉，
  // 故别处存完对子返回本 tab 能立刻看到新的。失败置 error（离线走 OfflineState，其余走可重试空态）。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        // 先确保会话 token 就位再拉（GET /api/anki/cards 对匿名放行但仍需 Bearer），与 library/page.tsx 同范式，
        // 防会话未建时 401 误判空态。
        await ensureSession()
        const [p1, p2] = await Promise.all([
          fetchAnkiCards(1, 'answered'),
          fetchAnkiCards(2, 'answered'),
        ])
        if (cancelled) return
        setPairs([...p1, ...p2].filter((c) => c.corpusId !== null))
      } catch (e) {
        if (cancelled) return
        console.warn('[CorpusMatchesTab] 加载对子失败', e)
        setError('对子没加载出来，请重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // 稳定回调内读最新 pairs（避免把 pairs 塞进 removeFn 依赖导致 useSelectMode 反复重建）
  const pairsRef = useRef<AnkiCard[]>(pairs)
  pairsRef.current = pairs

  // useSelectMode 真删回调：按 questionId 找对子 → deleteCorpus 真删（单事务：清空绑定题卡的卡背 +
  // corpus_id 置空退回题目分析 + 删 corpus 行，links/matches 由 cascade 清）。同一语料可绑多题（RPC 里
  // 一次清干净全部同源题卡），删成功后按 corpusId 从 pairs 移除全部同源对子
  //（pairs 引用变化触发 useSelectMode 在非 pending/selecting 帧 reseed，列表天然收敛）。fire-and-forget（失败记日志）。
  const removeFn = useCallback((questionId: string): void => {
    const corpusId = pairsRef.current.find((c) => c.questionId === questionId)?.corpusId
    if (!corpusId) return
    void deleteCorpus(corpusId)
      .then(() => setPairs((prev) => prev.filter((c) => c.corpusId !== corpusId)))
      .catch((e) => console.warn('[CorpusMatchesTab] 删除语料失败', e))
  }, [])

  const filterFn = useMemo(() => makeSearchFilter(searchQuery ?? '', pairSearchText), [searchQuery])
  const sel = useSelectMode({
    initialItems: pairs,
    getId: getPairId,
    removeFn,
    onSelectingChange,
    filterFn,
  })
  const searching = (searchQuery ?? '').trim() !== ''

  // 上报实时计数（匹配=可见项，总数=扣除待删）供桌面 tab 胶囊「匹配/总数」
  useEffect(() => {
    onSearchCountsChange?.({ matched: sel.visibleItems.length, total: sel.items.length - sel.pendingCount })
  }, [sel.visibleItems.length, sel.items.length, sel.pendingCount, onSearchCountsChange])

  // 上报对子总数（pairs.length，与徽标 answered 口径一致，不随搜索/待删波动）供素材库徽标即时回落。
  // 加载完 / 删除后 pairs 变化即触发，无需刷新。删除的 setPairs 已在真删成功后调用（fire-and-forget）。
  useEffect(() => {
    onCountChange?.(pairs.length)
  }, [pairs.length, onCountChange])

  // Portal 落点在 LibraryDesktop 的 DOM 里，首帧 ref.current 尚未挂载；挂载后翻标志重渲染。移动端不传 ref → 恒 null → 无工具栏。
  const [slotReady, setSlotReady] = useState(false)
  useEffect(() => { setSlotReady(true) }, [])
  const toolbarSlot = slotReady ? toolbarSlotRef?.current ?? null : null

  // 移动端卡角删除确认：真删 + 按 corpusId 移除全部同源对子（同一语料可绑多题）。
  const handleConfirmDelete = async (): Promise<void> => {
    const corpusId = pendingDelete?.corpusId
    if (!corpusId) return
    setDeleting(true)
    try {
      await deleteCorpus(corpusId)
      setPairs((prev) => prev.filter((c) => c.corpusId !== corpusId))
      setToast('已删除语料，绑定的题卡已退回题目分析')
    } catch (e) {
      console.warn('[CorpusMatchesTab] 删除语料失败', e)
      setToast('删除失败，请重试')
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }

  if (loading) {
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

  if (error) {
    return typeof navigator !== 'undefined' && !navigator.onLine
      ? <OfflineState onRetry={() => window.location.reload()} />
      : <EmptyState title="对子没加载出来" subtitle={error} ctaLabel="重试" onCta={() => window.location.reload()} orbSize={100} />
  }

  if (pairs.length === 0) {
    return (
      <EmptyState
        title="还没有语料匹配"
        subtitle="刷题时遇到想练的题，把你的一段真实经历绑上去"
        ctaLabel="去刷题卡"
        onCta={() => navigate('/anki/review')}
      />
    )
  }

  if (searching && sel.visibleItems.length === 0) {
    return <div className="pt-3"><EmptyState title={searchEmptyTitle(searchQuery ?? '')} subtitle="换个关键词试试" /></div>
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
              onClick={sel.deleteSelected}
              disabled={sel.selectedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[0.8125rem] font-medium text-white bg-error active:scale-[0.97] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} />删除 ({sel.selectedCount})
            </button>
          </div>
        ),
        toolbarSlot
      )}

      {/* 桌面 items-stretch：同行两卡等高（移动端单列不受影响） */}
      <div className="flex flex-col gap-3 pt-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-stretch">
        {sel.visibleItems.map((card) => {
          const topic = prettifyTopic(card.topic)
          const ready = isBackReady(card)
          return (
            // 选择态外壳（桌面多选）：selecting=false 时完全透明、卡片原样；移动端恒不 selecting → 透明穿透
            <SelectableCardWrapper
              key={card.questionId}
              selecting={sel.selecting}
              selected={sel.isSelected(card.questionId)}
              onToggle={() => sel.toggleSelect(card.questionId)}
              radius={16}
            >
              {/* relative 容器：主卡点击（跳分析）与移动端卡角删除是并列两个 button，不嵌套 */}
              <div className="relative lg:h-full">
                <button
                  type="button"
                  // 点卡直达该题分析页（storyId=corpusId，review=1 复练语义），从分析页可进练习
                  onClick={() => navigate(`/analysis?questionId=${encodeURIComponent(card.questionId)}&storyId=${encodeURIComponent(card.corpusId ?? '')}&review=1`)}
                  aria-label={`Part ${card.part} 对子，${topic ? topic + '，' : ''}${ready ? '卡背已就绪' : '卡背生成中'}，进入题目分析`}
                  className="block w-full text-left active:scale-[0.99] transition-transform lg:h-full focus-visible:outline-none rounded-[16px] focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
                >
                  <Card className="p-4 lg:h-full flex flex-col">
                    {/* 头部：Part 标 + 话题 Tag + 状态标签（状态带文字，不只靠色）。pr-9 给右上角删除按钮 / 选择框留位 */}
                    <div className="flex items-center gap-2 flex-wrap mb-2.5 pr-9">
                      <Tag variant="gray" label={`Part ${card.part}`} />
                      {topic && <Tag variant="green" label={topic} />}
                      {/* 已就绪不显标签（产品方定：整块删除）；仅生成中显暖橙状态标签。
                          Tag 无橙变体，按 DESIGN §次要元素「brand-primary-light 底 + 深色文字」手写；带 Loader 文字、a11y 不只靠色。 */}
                      {!ready && (
                        <span className="inline-flex items-center gap-1 text-[0.6875rem] font-medium rounded-full px-[10px] py-[5px] bg-brand-primary-light border border-brand-primary-light text-brand-primary-dark">
                          <Loader2 size={11} className="animate-spin" />
                          生成中…
                        </span>
                      )}
                    </div>

                    {/* 题面（Part2 用 cue card 标题），两行截断 */}
                    <p className="text-[0.875rem] font-medium text-v2-text-primary leading-[1.5] line-clamp-2">
                      {pairTitle(card)}
                    </p>

                    {/* 分隔 */}
                    <div className="border-t border-black/[0.06] my-3" />

                    {/* 你的故事 + 语料概括（两行截断）；桌面 mt-auto 贴底，卡片等高时视觉齐整 */}
                    <div className="flex items-start gap-1.5 lg:mt-auto">
                      <Link2 size={13} className="text-brand-primary-dark mt-[3px] flex-shrink-0" />
                      <div className="min-w-0">
                        <span className="text-[0.75rem] font-medium text-brand-primary-dark">你的故事</span>
                        <p className="text-[0.8125rem] text-v2-text-secondary leading-[1.5] line-clamp-2 mt-0.5">
                          {card.corpusSummary ?? '你绑定的一段真实经历'}
                        </p>
                      </div>
                    </div>
                  </Card>
                </button>

                {/* 移动端卡右上角删除入口（桌面 lg:hidden，改走顶部多选工具栏）：44×44 命中区，stopPropagation 不触发主卡跳转 */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPendingDelete(card) }}
                  aria-label={`删除语料：${card.corpusSummary ?? pairTitle(card)}`}
                  className="lg:hidden absolute top-1.5 right-1.5 w-11 h-11 flex items-center justify-center rounded-full text-v2-text-muted hover:text-error hover:bg-error/5 active:scale-[0.94] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-1"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </SelectableCardWrapper>
          )
        })}
      </div>

      {/* 移动端删语料二次确认（不可撤销）*/}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条语料？"
        // 「含你手动编辑过的内容」是 2026-08-07 补的：删语料同时清 generated_answer 与 edited_answer
        // （口径见 0060），后者是用户亲手写的、损失更重，不可逆操作的确认框必须让他知情后再点。
        description="删除后，绑定的题卡会退回题目分析，卡背清空（含你手动编辑过的内容）。此操作不可撤销。"
        danger
        loading={deleting}
        loadingText="删除中…"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {/* 桌面多选删除撤销 Toast（5s 内撤销、到期真删；key 变化重置计时） */}
      {sel.pendingCount > 0 && (
        <UndoToast
          key={sel.pendingKey}
          message={`已删除 ${sel.pendingCount} 条语料 · 绑定题卡退回分析`}
          onUndo={sel.undoDelete}
          onDismiss={sel.commitPending}
        />
      )}

      {/* 删除结果提示（移动端卡角删除用，底部居中）*/}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  )
}
