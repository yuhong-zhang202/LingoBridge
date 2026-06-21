/**
 * @module   PracticeQuestionPage
 * @desc     练习题目页 — 展示一道雅思题 + 能匹配它的语料列表 + 添加语料；
 *           选中语料后出现「练习」按钮直达分析，「添加语料」复用雅思直达流（?qid=）。
 * @author   LingoBridge
 * @created  2026-06-21
 */
'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Plus, RefreshCw } from 'lucide-react'
import TopBar from '@/components/TopBar'
import PartTag from '@/components/PartTag'
import Tag from '@/components/Tag'
import Chip from '@/components/Chip'
import { getQuestionById } from '@/lib/db/questions'
import { listCorpusByQuestion, type CorpusMatch, type MatchLevel } from '@/lib/db/matches'
import { formatRelativeTime } from '@/lib/utils'
import type { QuestionWithLinks } from '@/lib/types'

// 选中态竖条渐变 —— 数值与 MatchedQuestionCard 完全一致
const SELECTED_BAR = 'linear-gradient(to bottom, rgba(240,188,160,0.85), rgba(168,210,196,0.80))'

/** 匹配档位 → 标签：high 绿标「高匹配」；mid/chosen 灰标「中匹配」；low 灰标「低匹配」 */
function levelTag(level: MatchLevel): JSX.Element {
  if (level === 'high') return <Tag variant="green" label="高匹配" />
  return <Tag variant="gray" label={level === 'low' ? '低匹配' : '中匹配'} />
}

/** 语料卡 —— 选中切换、渐变竖条、珊瑚阴影照搬 MatchedQuestionCard */
function CorpusMatchCard({ item, selected, onToggle, onPractice }: {
  item: CorpusMatch; selected: boolean; onToggle: () => void; onPractice: () => void
}): JSX.Element {
  return (
    <div
      onClick={onToggle}
      className={`bg-white rounded-[14px] overflow-hidden flex cursor-pointer border border-black/[0.05] transition-shadow duration-200 ${
        selected ? 'shadow-[0_2px_16px_rgba(212,135,90,0.12)]' : 'shadow-[0_1px_8px_rgba(0,0,0,0.06)]'
      }`}
    >
      {/* 左侧竖条 */}
      <div className="w-[4px] flex-shrink-0 self-stretch">
        {selected ? (
          <div className="w-full h-full" style={{ background: SELECTED_BAR }} />
        ) : (
          <div className="w-full h-full bg-transparent" />
        )}
      </div>

      <div className="flex-1 p-4">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          {levelTag(item.matchLevel)}
          <span className="text-[11px] text-v2-text-muted flex-shrink-0">
            {item.source === 'voice' ? '录音' : '文字'} · {formatRelativeTime(item.createdAt)}
          </span>
        </div>

        <p className="text-[13px] text-v2-text-secondary leading-relaxed line-clamp-2">{item.cleanedText ?? ''}</p>

        {selected && (
          <div className="flex items-center justify-end mt-3">
            <Chip
              variant="gradient"
              onClick={(e) => { e.stopPropagation(); onPractice() }}
              className="px-3 py-1.5 flex-shrink-0"
            >
              练习
              <ArrowRight size={12} />
            </Chip>
          </div>
        )}
      </div>
    </div>
  )
}

/** 添加语料：虚线珊瑚边卡（与「练习」按钮的白底渐变描边刻意区分） */
function AddCorpusCard({ onClick, prominent }: { onClick: () => void; prominent?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-[14px] border-2 border-dashed border-brand-primary/40 bg-brand-primary/[0.03] flex flex-col items-center justify-center text-center active:scale-[0.99] transition-transform ${
        prominent ? 'py-8' : 'py-5'
      }`}
    >
      <div className="flex items-center gap-1.5 text-brand-primary-dark">
        <Plus size={16} />
        <span className="text-[14px] font-semibold">添加语料</span>
      </div>
      <span className="text-[12px] text-v2-text-muted mt-1">录一段新故事来练习这道题</span>
    </button>
  )
}

function PracticeQuestionContent(): JSX.Element {
  const router = useRouter()
  const qId = useSearchParams().get('questionId') ?? ''

  const [question, setQuestion]   = useState<QuestionWithLinks | null>(null)
  const [items, setItems]         = useState<CorpusMatch[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const [q, list] = await Promise.all([getQuestionById(qId), listCorpusByQuestion(qId)])
        if (cancelled) return
        if (!q) { setError('题目不存在'); return }
        setQuestion(q)
        setItems(list)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败，请重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [qId, reloadKey])

  const enText = question
    ? (question.part === 2 ? (question.cue_card_title ?? question.question_text) : question.question_text)
    : ''
  const zhText = question
    ? (question.part === 2 ? (question.cue_card_title_zh ?? '') : (question.question_text_zh ?? ''))
    : ''

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <TopBar title="练习题目" />

      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-[72px] relative z-10 flex flex-col gap-4">
        {loading && (
          <p className="text-[13px] text-v2-text-muted text-center pt-16">加载中…</p>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center pt-16 gap-3">
            <p className="text-[13px] text-error text-center">{error}</p>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="flex items-center gap-1.5 text-[13px] text-v2-text-muted active:opacity-70"
            >
              <RefreshCw size={13} />重试
            </button>
          </div>
        )}

        {!loading && !error && question && (
          <>
            {/* 题目卡 */}
            <div className="bg-white rounded-[18px] border border-black/[0.05] shadow-[0_1px_8px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center gap-2 mb-2.5">
                <PartTag label={`Part ${question.part}`} />
                <Tag variant="green" label={question.topic} />
              </div>
              {zhText ? (
                <>
                  <p className="text-[16px] font-bold text-v2-text-primary leading-snug">{zhText}</p>
                  <p className="text-[13px] text-v2-text-muted mt-1">{enText}</p>
                </>
              ) : (
                <p className="text-[16px] font-bold text-v2-text-primary leading-snug">{enText}</p>
              )}
            </div>

            {/* 可匹配的语料 */}
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[12px] font-medium text-v2-text-secondary">可匹配的语料 · {items.length} 条</span>
            </div>

            {items.length === 0 ? (
              <>
                <p className="text-[13px] text-v2-text-muted text-center py-2">还没有能匹配这道题的语料</p>
                <AddCorpusCard prominent onClick={() => router.push(`/recording?qid=${qId}`)} />
              </>
            ) : (
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <CorpusMatchCard
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    onToggle={() => setSelectedId((id) => (id === item.id ? null : item.id))}
                    onPractice={() => router.push(`/analysis?questionId=${qId}&storyId=${item.id}`)}
                  />
                ))}
                <AddCorpusCard onClick={() => router.push(`/recording?qid=${qId}`)} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function PracticeQuestionPage(): JSX.Element {
  return <Suspense><PracticeQuestionContent /></Suspense>
}
