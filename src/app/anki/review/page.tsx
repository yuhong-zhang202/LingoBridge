/**
 * @module   AnkiReviewPage
 * @desc     Anki 题卡 SRS 复习宿主页 —— 套用 /review 骨架（顶栏关闭 + 进度条/点、翻卡、左右滑评级、Leitner 排下次）。
 *           拉当季题卡 → QuestionFlashCard 逐张翻面/滑动/逐点编辑。
 *   牌堆构成（S3）：并行拉当季 part1 + part2 两份列表，按 RPC 返回顺序 concat 成一副牌（part1 段在前、
 *     part2 段在后）；part3 子卡由 get_anki_cards 随其 part2 父卡成组、已排好序（见 0034/0039），前端【不重排】、
 *     直接沿用返回顺序渲染，保成组不被打散。part3 卡背走静态 analysis.example（CardBack 已支持）。
 *   ⚠️ 本批只做卡片本身 + 交互：外围导航（素材库入口 / 全部|已回答 筛选 / 同批语料分组）尚未接，
 *      故 scope 暂用固定默认（全部），待下批筛选接入后由查询参数驱动。
 * @author   LingoBridge
 * @created  2026-07-24
 */
'use client'
import { type JSX, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import QuestionFlashCard from '@/components/anki/QuestionFlashCard'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { fetchAnkiCards, gradeAnkiCard, patchAnkiPoint } from '@/lib/anki/cards-client'
import { parseEditOverrides, applyEditOverride, serializeEditOverrides } from '@/lib/anki/answer-points'
import type { AnkiCard } from '@/lib/anki/list'

// 外围导航未接前的临时默认（下批筛选接入后改由查询参数驱动）
const DEFAULT_SCOPE = 'all' as const

export default function AnkiReviewPage(): JSX.Element {
  const router = useRouter()
  const [queue, setQueue] = useState<AnkiCard[]>([])
  const [current, setCurrent] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // part1 + part2 两副牌并行拉，按 RPC 返回顺序 concat（part1 在前、part2 在后）；
        // part3 子卡已随其 part2 父卡在 p2 内成组排好，不在前端重排、直接沿用顺序，保成组。
        const [p1, p2] = await Promise.all([
          fetchAnkiCards(1, DEFAULT_SCOPE),
          fetchAnkiCards(2, DEFAULT_SCOPE),
        ])
        if (cancelled) return
        const cards = [...p1, ...p2]
        setQueue(cards)
        setTotal(cards.length)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败，请重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleGrade = useCallback((remembered: boolean): void => {
    const card = queue[current]
    if (!card) return
    void gradeAnkiCard(card.questionId, remembered).catch(() => {}) // 静默失败，不打断复习
    if (!remembered) setQueue((q) => [...q, card]) // 没记住：排到队尾本轮再练
    setCurrent((c) => c + 1)
  }, [queue, current])
  const [gradeOne] = useAsyncAction(handleGrade)

  // 逐点编辑：写库成功后本地把该点覆盖并入当前卡 editedAnswer（稀疏覆盖），令卡背即时反映
  const handleEditPoint = useCallback(async (idx: number, en: string): Promise<void> => {
    const card = queue[current]
    if (!card) return
    await patchAnkiPoint(card.questionId, idx, en)
    const merged = applyEditOverride(parseEditOverrides(card.editedAnswer), idx, en)
    const next = serializeEditOverrides(merged)
    setQueue((q) => q.map((c, i) => (i === current ? { ...c, editedAnswer: next === '' ? null : next } : c)))
  }, [queue, current])

  // 空点态「补一句语料就能生成」（B3）：跳「给这道题补语料」的定向录音流 —— /recording?qid 会串起
  // 录音→转写→restructure（qid 走雅思流）→ upsertMatch 把新语料绑定到该题→分析，正是给该题补料的完整路径。
  const handleSupplement = useCallback((questionId: string): void => {
    router.push(`/recording?qid=${encodeURIComponent(questionId)}`)
  }, [router])

  const close = (): void => router.back()
  const done = !loading && !error && queue.length > 0 && current >= queue.length

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      {/* 顶栏：关闭 + 进度 */}
      <div className="relative z-10 lg:max-w-[760px] lg:w-full lg:mx-auto">
        <div className="flex items-center justify-between h-[52px] px-5">
          <button onClick={close} aria-label="关闭复习" className="w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center">
            <X size={15} className="text-v2-text-muted" />
          </button>
          {!loading && !error && queue.length > 0 && current < queue.length && (
            <span className="text-[13px] text-v2-text-muted">{current + 1} / {queue.length}</span>
          )}
        </div>
        {!loading && !error && queue.length > 0 && current < queue.length && (
          <div className="px-5">
            <div className="mt-1 h-1 rounded-full bg-bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-primary transition-[width] duration-300"
                style={{ width: `${(current / queue.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 lg:px-8 py-6 relative z-10 flex flex-col lg:max-w-[760px] lg:w-full lg:mx-auto">
        {loading ? (
          <div className="flex-1 flex items-center justify-center"><EmptyState title="加载中…" orbSize={100} /></div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center"><EmptyState title="加载失败" subtitle={error} ctaLabel="返回" onCta={close} /></div>
        ) : queue.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState title="当季没有题卡" subtitle="去题库把想练的题「存对子」，就会出现在这里" ctaLabel="返回" onCta={close} />
          </div>
        ) : done ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState title="复习完成 🎉" subtitle={`这轮过了 ${total} 张卡片`} ctaLabel="完成" onCta={close} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <QuestionFlashCard
              key={`${queue[current].questionId}-${current}`}
              card={queue[current]}
              onGrade={(r) => void gradeOne(r)}
              onEditPoint={handleEditPoint}
              onSupplement={handleSupplement}
            />
          </div>
        )}
      </div>
    </div>
  )
}
