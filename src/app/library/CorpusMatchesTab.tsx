/**
 * @module   CorpusMatchesTab
 * @desc     素材库「语料匹配」tab —— 展示已确立的对子（anki_cards 里 corpusId 非空的当季卡）。
 *           挂载即拉 fetchAnkiCards(1|2,'answered') 后客户端 filter(corpusId!==null) 得当季所有对子
 *           （存完对子返回本 tab、重新挂载即见新对子）。点对子卡直达该题「题目分析」页
 *           （/analysis?questionId&storyId=corpusId&review=1，与 useGotoPractice 复练同范式），从分析页可进练习。
 *           卡角提供删语料入口（ConfirmDialog 二次确认 → deleteCorpus 真删）：删语料即解绑，
 *           绑定的 anki 卡 corpus_id 经 FK set null 退回题目分析（机制在 DB 层）。
 *           注意：本 tab 只列已绑对子的语料（corpusId 非空）；未绑对子的语料在此看不到、也删不了
 *           （删除口子待创始人确认，见交付说明）。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { useState, useEffect, useMemo } from 'react'
import { Link2, Loader2, Trash2 } from 'lucide-react'
import { useNav } from '@/components/NavProgress'
import Card from '@/components/Card'
import Tag from '@/components/Tag'
import Skeleton from '@/components/Skeleton'
import EmptyState from '@/components/EmptyState'
import OfflineState from '@/components/OfflineState'
import ConfirmDialog from '@/components/ConfirmDialog'
import Toast from '@/components/Toast'
import { fetchAnkiCards } from '@/lib/anki/cards-client'
import { deleteCorpus } from '@/lib/db/corpus'
import { ensureSession } from '@/lib/supabase'
import { prettifyTopic } from '@/lib/topic'
import { makeSearchFilter, searchEmptyTitle, type SearchCounts } from '@/lib/search'
import type { AnkiCard } from '@/lib/anki/list'

/**
 * searchQuery：桌面搜索词（防抖后）；移动端不传 → 恒不过滤。
 * onSearchCountsChange：上报实时（匹配数, 总数）供桌面 tab 胶囊显示「匹配/总数」；移动端不传。
 */
interface Props {
  searchQuery?: string
  onSearchCountsChange?: (counts: SearchCounts) => void
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

/** 卡背是否已就绪（可直接练/看）：生成完成或用户已编辑。其余（analysis）= 生成中。 */
function isBackReady(card: AnkiCard): boolean {
  return card.backKind === 'generated' || card.backKind === 'edited'
}

export default function CorpusMatchesTab({ searchQuery, onSearchCountsChange }: Props) {
  // 点对子卡跳 /analysis（AI 分析页）走 navigate 当帧亮顶部进度条，消跳转白屏
  const { navigate } = useNav()
  const [pairs, setPairs] = useState<AnkiCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 待删语料（点卡角删除按钮后置入 → 弹确认框）；deleting 锁按钮；toast 报结果
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

  const filterFn = useMemo(() => makeSearchFilter(searchQuery ?? '', pairSearchText), [searchQuery])
  const visible = useMemo(() => (filterFn ? pairs.filter(filterFn) : pairs), [pairs, filterFn])
  const searching = (searchQuery ?? '').trim() !== ''

  // 上报实时计数（匹配=可见, 总数=全部对子）供桌面 tab 胶囊「匹配/总数」
  useEffect(() => {
    onSearchCountsChange?.({ matched: visible.length, total: pairs.length })
  }, [visible.length, pairs.length, onSearchCountsChange])

  // 确认删语料：真删（deleteCorpus 清 corpus_point_links 后删 corpus 行；绑定的 anki 卡经 FK set null
  // 退回题目分析）。成功后把同一 corpusId 的对子全部从列表移除——同一语料可绑多题，删语料即全部解绑。
  const handleConfirmDelete = async (): Promise<void> => {
    const target = pendingDelete
    if (!target?.corpusId) return
    const corpusId = target.corpusId
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

  if (searching && visible.length === 0) {
    return <div className="pt-3"><EmptyState title={searchEmptyTitle(searchQuery ?? '')} subtitle="换个关键词试试" /></div>
  }

  return (
    // 桌面 items-stretch：同行两卡等高（移动端单列不受影响）
    <div className="flex flex-col gap-3 pt-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-stretch">
      {visible.map((card) => {
        const topic = prettifyTopic(card.topic)
        const ready = isBackReady(card)
        return (
          // relative 容器：主卡点击（跳分析）与删除按钮是并列的两个 button，不嵌套（HTML 不允许 button 套 button）
          <div key={card.questionId} className="relative lg:h-full">
          <button
            type="button"
            // 点卡直达该题分析页（storyId=corpusId，review=1 复练语义），从分析页可进练习
            onClick={() => navigate(`/analysis?questionId=${encodeURIComponent(card.questionId)}&storyId=${encodeURIComponent(card.corpusId ?? '')}&review=1`)}
            aria-label={`Part ${card.part} 对子，${topic ? topic + '，' : ''}${ready ? '卡背已就绪' : '卡背生成中'}，进入题目分析`}
            className="block w-full text-left active:scale-[0.99] transition-transform lg:h-full focus-visible:outline-none rounded-[16px] focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
          >
            <Card className="p-4 lg:h-full flex flex-col">
              {/* 头部：Part 标 + 话题 Tag + 状态标签（状态带文字，不只靠色）。pr-9 给右上角删除按钮留位，避免标签跑到按钮下 */}
              <div className="flex items-center gap-2 flex-wrap mb-2.5 pr-9">
                <Tag variant="gray" label={`Part ${card.part}`} />
                {topic && <Tag variant="green" label={topic} />}
                {ready ? (
                  <Tag variant="green" label="卡背已就绪" />
                ) : (
                  // 生成中 = 暖橙状态标签。Tag 组件只有 green/gradient/gray、无橙色状态变体，故按 DESIGN §次要元素
                  // 「小 badge：brand-primary-light 底 + 对应深色文字」手写；带 Loader 文字，a11y 不只靠色。
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-[10px] py-[5px] bg-brand-primary-light border border-brand-primary-light text-brand-primary-dark">
                    <Loader2 size={11} className="animate-spin" />
                    生成中…
                  </span>
                )}
              </div>

              {/* 题面（Part2 用 cue card 标题），两行截断 */}
              <p className="text-[14px] font-medium text-v2-text-primary leading-[1.5] line-clamp-2">
                {pairTitle(card)}
              </p>

              {/* 分隔 */}
              <div className="border-t border-black/[0.06] my-3" />

              {/* 你的故事 + 语料概括（两行截断）；桌面 mt-auto 贴底，卡片等高时视觉齐整 */}
              <div className="flex items-start gap-1.5 lg:mt-auto">
                <Link2 size={13} className="text-brand-primary-dark mt-[3px] flex-shrink-0" />
                <div className="min-w-0">
                  <span className="text-[12px] font-medium text-brand-primary-dark">你的故事</span>
                  <p className="text-[13px] text-v2-text-secondary leading-[1.5] line-clamp-2 mt-0.5">
                    {card.corpusSummary ?? '你绑定的一段真实经历'}
                  </p>
                </div>
              </div>
            </Card>
          </button>

          {/* 卡右上角删除入口：44×44 命中区（图标本身 15px），stopPropagation 不触发主卡跳转 */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPendingDelete(card) }}
            aria-label={`删除语料：${card.corpusSummary ?? pairTitle(card)}`}
            className="absolute top-1.5 right-1.5 w-11 h-11 flex items-center justify-center rounded-full text-v2-text-muted hover:text-error hover:bg-error/5 active:scale-[0.94] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-1"
          >
            <Trash2 size={15} />
          </button>
          </div>
        )
      })}

      {/* 删语料二次确认（不可撤销）*/}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条语料？"
        description="删除后，绑定的题卡会退回题目分析（卡背清空）。此操作不可撤销。"
        danger
        loading={deleting}
        loadingText="删除中…"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {/* 删除结果提示（底部居中）*/}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
