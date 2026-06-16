/**
 * @module   MatchingPage
 * @desc     题目匹配页 — 对用户故事做真实反向匹配，按相关性三档分组展示真题
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'
import TabBar from '@/components/TabBar'
import Chip from '@/components/Chip'
import MatchedQuestionCard from '@/components/matching/MatchedQuestionCard'
import NoMatchView from '@/components/matching/NoMatchView'
import { saveExtraction } from '@/lib/db/corpus'
import { SCORE_HIGH, SCORE_MID, SCORE_LOW } from '@/lib/constants'
import type { MatchedPoint, DimensionLabel } from '@/lib/types'

// 本地类型：扩展 MatchedQuestion 加上漏斗信息 + 排名分
interface FunnelQuestion {
  id: string
  part: 1 | 2 | 3
  question_text: string
  question_text_zh: string | null
  cue_card_title: string | null
  cue_card_title_zh: string | null
  is_new: boolean
  topic_only: boolean
  matched_point: string
  dimension: DimensionLabel
  isPrimaryMatch: boolean
  relevanceScore?: number
  relevanceReason?: string
}

interface FunnelResult {
  primary: MatchedPoint | null
  secondary: MatchedPoint | null
  questions: FunnelQuestion[]
  count: number
  matchedViaSecondary: boolean
  noMatch: boolean
}

type PartTab = '全部' | 'Part 1' | 'Part 2'

/** 分组标题行：label + 横线 */
function GroupHeader({ label, count, variant }: {
  label: string
  count: number
  variant: 'high' | 'mid' | 'low'
}) {
  const textClass =
    variant === 'high' ? 'text-brand-accent font-semibold'
    : variant === 'mid' ? 'text-v2-text-secondary font-medium'
    : 'text-v2-text-muted font-medium'

  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={`text-[11px] ${textClass}`}>{label} · {count} 道</span>
      <div className="flex-1 h-px bg-black/[0.05]" />
    </div>
  )
}

function MatchingContent() {
  const router = useRouter()
  const params = useSearchParams()
  const story    = params.get('story')    ?? ''
  const corpusId = params.get('corpusId') ?? ''
  const [result, setResult] = useState<FunnelResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<PartTab>('全部')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  // 切换 Tab 时收起折叠
  useEffect(() => { setExpanded(false) }, [activeTab])

  useEffect(() => {
    if (!story) { setLoading(false); setError('没有收到故事内容'); return }
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const res = await fetch('/api/matching', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cleanedText: story, corpusId }),
        })
        if (!res.ok) throw new Error('匹配失败')
        const data = (await res.json()) as FunnelResult
        if (!cancelled) { setResult(data); setSelectedId(data.questions[0]?.id ?? null) }
        // 非阻断写库：把萃取观察点关联到真实语料（客户端调用，保证 RLS user session 一致）
        if (!cancelled && corpusId && data.primary) {
          saveExtraction(corpusId, data.primary.pointCode, data.secondary?.pointCode ?? null)
            .catch((err: unknown) => console.warn('[MatchingPage] saveExtraction 失败，跳过', err))
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '匹配失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [story, corpusId])

  // 动态 Part 标签：只显示有结果的 Part
  const availableTabs = useMemo<PartTab[]>(() => {
    if (!result) return ['全部']
    const parts = new Set(result.questions.map((q) => q.part))
    const tabs: PartTab[] = ['全部']
    if (parts.has(1)) tabs.push('Part 1')
    if (parts.has(2)) tabs.push('Part 2')
    return tabs
  }, [result])

  // 标题计数：≥ SCORE_LOW 的总量，跨所有 Part（不受 Tab 过滤影响）
  const totalVisible = useMemo(() => {
    if (!result) return 0
    return result.questions.filter((q) => (q.relevanceScore ?? 100) >= SCORE_LOW).length
  }, [result])

  // 当前 Tab 过滤后的题目
  const filtered = useMemo(() => {
    if (!result) return []
    if (activeTab === '全部') return result.questions
    const n = activeTab === 'Part 1' ? 1 : 2
    return result.questions.filter((q) => q.part === n)
  }, [result, activeTab])

  // 三档分组；无 score（排名服务降级）时默认归入高匹配，保持全量展示
  const highGroup = useMemo(
    () => filtered.filter((q) => (q.relevanceScore ?? 100) >= SCORE_HIGH),
    [filtered]
  )
  const midGroup = useMemo(
    () => filtered.filter((q) => {
      const s = q.relevanceScore ?? 100
      return s >= SCORE_MID && s < SCORE_HIGH
    }),
    [filtered]
  )
  const lowGroup = useMemo(
    () => filtered.filter((q) => {
      const s = q.relevanceScore ?? 100
      return s >= SCORE_LOW && s < SCORE_MID
    }),
    [filtered]
  )

  const foldedCount  = midGroup.length + lowGroup.length
  const hasMore      = foldedCount > 0
  const noneVisible  = highGroup.length === 0 && midGroup.length === 0 && lowGroup.length === 0

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <TopBar title="题目匹配" />
      <StepBar currentStep="matching" />

      <div className="flex-1 overflow-y-auto px-6 pb-[72px] relative z-10">

        {/* 故事预览 */}
        <div className="bg-bg-muted rounded-[14px] px-3.5 py-2.5 mb-5 flex items-center gap-2">
          <Sparkles size={13} className="text-v2-text-muted flex-shrink-0" />
          <span className="text-[12px] text-v2-text-muted italic truncate">
            「{story ? story.slice(0, 24) + (story.length > 24 ? '…' : '') : '未收到故事'}」
          </span>
        </div>

        {loading && (
          <div className="text-center text-[14px] text-v2-text-muted py-20">正在匹配题目…</div>
        )}

        {!loading && error && (
          <div className="text-center text-[14px] text-v2-text-muted py-20">{error}</div>
        )}

        {!loading && !error && result && result.noMatch && (
          <NoMatchView
            primaryDimension={result.primary?.dimension ?? ''}
            primaryPointName={result.primary?.pointName ?? ''}
          />
        )}

        {!loading && !error && result && !result.noMatch && (
          <>
            {/* 匹配标题 + 识别出的维度 */}
            <div className="mb-4">
              <h2 className="text-[20px] font-bold text-v2-text-primary">匹配到 {totalVisible} 道当季真题</h2>
              {result.primary && (
                <p className="text-[12px] text-v2-text-muted mt-1">
                  识别维度：{result.primary.dimension} · {result.primary.pointName}
                  {result.secondary && ` ／ ${result.secondary.dimension} · ${result.secondary.pointName}`}
                </p>
              )}
            </div>

            {/* 副维度降级说明 */}
            {result.matchedViaSecondary && result.secondary && (
              <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] px-4 py-3 mb-4 border border-black/[0.05]">
                <p className="text-[13px] text-v2-text-primary leading-snug mb-1">
                  暂时没匹配到完全契合的雅思真题
                </p>
                <p className="text-[12px] text-v2-text-secondary leading-relaxed">
                  不过把重点放在{' '}
                  <span className="text-brand-primary-dark font-medium">
                    {result.secondary.dimension} · {result.secondary.pointName}
                  </span>
                  {' '}这个方向上，这些题目同样值得练
                </p>
              </div>
            )}

            {/* Part 筛选（动态，只出现有结果的 Part） */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {availableTabs.map((p) => (
                <Chip key={p} onClick={() => setActiveTab(p)} variant="ghost" active={activeTab === p}>
                  {p}
                </Chip>
              ))}
            </div>

            {/* 三档分组展示 */}
            <div className="mb-6">

              {/* 高匹配组：默认展示 */}
              {highGroup.length > 0 && (
                <div>
                  <GroupHeader label="高匹配" count={highGroup.length} variant="high" />
                  <div className="flex flex-col gap-3">
                    {highGroup.map((q) => (
                      <MatchedQuestionCard
                        key={q.id}
                        question={q}
                        selected={selectedId === q.id}
                        onToggle={() => setSelectedId(selectedId === q.id ? null : q.id)}
                        onPractice={() => router.push(`/analysis?questionId=${q.id}&storyId=${corpusId}`)}
                        isPrimaryMatch={q.isPrimaryMatch}
                        isHighMatch={true}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 展开后：中匹配组 */}
              {expanded && midGroup.length > 0 && (
                <div className="mt-5">
                  <GroupHeader label="中匹配" count={midGroup.length} variant="mid" />
                  <div className="flex flex-col gap-3">
                    {midGroup.map((q) => (
                      <MatchedQuestionCard
                        key={q.id}
                        question={q}
                        selected={selectedId === q.id}
                        onToggle={() => setSelectedId(selectedId === q.id ? null : q.id)}
                        onPractice={() => router.push(`/analysis?questionId=${q.id}&storyId=${corpusId}`)}
                        isPrimaryMatch={q.isPrimaryMatch}
                        isHighMatch={false}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 展开后：低匹配组 */}
              {expanded && lowGroup.length > 0 && (
                <div className="mt-5">
                  <GroupHeader label="低匹配" count={lowGroup.length} variant="low" />
                  <div className="flex flex-col gap-3">
                    {lowGroup.map((q) => (
                      <MatchedQuestionCard
                        key={q.id}
                        question={q}
                        selected={selectedId === q.id}
                        onToggle={() => setSelectedId(selectedId === q.id ? null : q.id)}
                        onPractice={() => router.push(`/analysis?questionId=${q.id}&storyId=${corpusId}`)}
                        isPrimaryMatch={q.isPrimaryMatch}
                        isHighMatch={false}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 空态 */}
              {noneVisible && (
                <div className="text-center text-[13px] text-v2-text-muted py-10">该 Part 暂无匹配题目</div>
              )}
            </div>

            {/* 查看更多 / 收起 toggle（中 + 低匹配折叠区） */}
            {hasMore && (
              <div className="text-center mb-6">
                <button
                  onClick={() => setExpanded((prev) => !prev)}
                  className="text-[13px] font-medium text-brand-primary active:opacity-60"
                >
                  {expanded ? '收起 ↑' : `查看更多 ${foldedCount} 道 →`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="relative z-20 flex-shrink-0"><TabBar /></div>
    </div>
  )
}

export default function MatchingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-page" />}>
      <MatchingContent />
    </Suspense>
  )
}
