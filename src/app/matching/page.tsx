/**
 * @module   MatchingPage
 * @desc     题目匹配页 — 对用户故事做真实反向匹配，展示匹配到的真题
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
import type { MatchResult } from '@/lib/types'

const STORY_ID = '1' // 暂硬编码，多故事导航后续实现

type PartTab = '全部' | 'Part 1' | 'Part 2'

function MatchingContent() {
  const router = useRouter()
  const story = useSearchParams().get('story') ?? ''
  const [result, setResult] = useState<MatchResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<PartTab>('全部')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!story) { setLoading(false); setError('没有收到故事内容'); return }
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const res = await fetch('/api/matching', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cleanedText: story }),
        })
        if (!res.ok) throw new Error('匹配失败')
        const data = (await res.json()) as MatchResult
        if (!cancelled) { setResult(data); setSelectedId(data.questions[0]?.id ?? null) }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '匹配失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [story])

  // 动态 Part 标签：只显示有结果的 Part
  const availableTabs = useMemo<PartTab[]>(() => {
    if (!result) return ['全部']
    const parts = new Set(result.questions.map((q) => q.part))
    const tabs: PartTab[] = ['全部']
    if (parts.has(1)) tabs.push('Part 1')
    if (parts.has(2)) tabs.push('Part 2')
    return tabs
  }, [result])

  const filtered = useMemo(() => {
    if (!result) return []
    if (activeTab === '全部') return result.questions
    const n = activeTab === 'Part 1' ? 1 : 2
    return result.questions.filter((q) => q.part === n)
  }, [result, activeTab])

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <TopBar title="题目匹配" />
      <StepBar currentStep="matching" />

      <div className="flex-1 overflow-y-auto px-6 pb-[72px] relative z-10">

        {/* 故事预览 */}
        <div className="surface px-3.5 py-2.5 mb-5 flex items-center gap-2">
          <Sparkles size={13} className="text-[#AAAAAA] flex-shrink-0" />
          <span className="text-[12px] text-[#888] italic truncate">
            「{story ? story.slice(0, 24) + (story.length > 24 ? '…' : '') : '未收到故事'}」
          </span>
        </div>

        {loading && (
          <div className="text-center text-[14px] text-v2-text-muted py-20">正在匹配题目…</div>
        )}

        {!loading && error && (
          <div className="text-center text-[14px] text-v2-text-muted py-20">{error}</div>
        )}

        {!loading && !error && result && (
          <>
            {/* 匹配标题 + 识别出的维度 */}
            <div className="mb-4">
              <h2 className="text-[20px] font-bold text-[#111]">匹配到 {result.count} 道当季真题</h2>
              {result.primary && (
                <p className="text-[12px] text-[#888] mt-1">
                  识别维度：{result.primary.dimension} · {result.primary.pointName}
                  {result.secondary && ` ／ ${result.secondary.dimension} · ${result.secondary.pointName}`}
                </p>
              )}
            </div>

            {/* Part 筛选（动态，只出现有结果的 Part） */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {availableTabs.map((p) => (
                <Chip key={p} onClick={() => setActiveTab(p)} variant="ghost" active={activeTab === p}>
                  {p}
                </Chip>
              ))}
            </div>

            {/* 题目卡片 */}
            <div className="flex flex-col gap-3 mb-6">
              {filtered.map((q) => (
                <MatchedQuestionCard
                  key={q.id}
                  question={q}
                  selected={selectedId === q.id}
                  onToggle={() => setSelectedId(selectedId === q.id ? null : q.id)}
                  onPractice={() => router.push(`/analysis?questionId=${q.id}&storyId=${STORY_ID}`)}
                />
              ))}
              {filtered.length === 0 && (
                <div className="text-center text-[13px] text-v2-text-muted py-10">该 Part 暂无匹配题目</div>
              )}
            </div>
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
