'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ArrowRight, Leaf, RefreshCw, Sparkles } from 'lucide-react'
import { Card, Chip, GradientButton, Tag } from './primitives'
import { MATCHED_QUESTIONS, type Tier, type MatchedQuestion } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

const PART_FILTERS = ['全部', 'Part 1', 'Part 2'] as const

const TIER_META: Record<Tier, { label: string; bar: string; text: string }> = {
  high: { label: '高匹配', bar: 'bg-brand', text: 'text-brand-dark' },
  mid: { label: '中匹配', bar: 'bg-teal', text: 'text-teal' },
  low: { label: '低匹配', bar: 'bg-band-55', text: 'text-ink3' },
}

function QuestionCard({ q }: { q: MatchedQuestion }) {
  const meta = TIER_META[q.tier]
  return (
    <Card gradient={q.tier === 'high'} className="p-5 transition-shadow hover:shadow-float">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <Tag variant="neutral">{q.part}</Tag>
            <span className={cn('text-[12px] font-semibold', meta.text)}>{meta.label} · {q.score}</span>
          </div>
          <h4 className="text-pretty text-[15px] font-semibold text-ink">{q.title}</h4>
          <p className="mt-1.5 text-pretty text-[13px] leading-relaxed text-ink2">{q.prompt}</p>
        </div>
        <Link
          href="/analysis"
          className="grid size-9 shrink-0 place-items-center rounded-full grad-border bg-surface text-brand transition-transform active:scale-95"
          aria-label="开始分析这道题"
        >
          <ArrowRight className="size-4" />
        </Link>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-fill">
        <div className={cn('h-full rounded-full', meta.bar)} style={{ width: `${q.score}%` }} />
      </div>
    </Card>
  )
}

export function MatchingView() {
  const [part, setPart] = useState<(typeof PART_FILTERS)[number]>('全部')
  const [showMore, setShowMore] = useState(false)
  const [empty, setEmpty] = useState(false)

  const filtered = MATCHED_QUESTIONS.filter((q) => part === '全部' || q.part === part)
  const high = filtered.filter((q) => q.tier === 'high')
  const mid = filtered.filter((q) => q.tier === 'mid')
  const low = filtered.filter((q) => q.tier === 'low')

  if (empty) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center px-6 py-16 text-center">
        <div className="grid size-20 place-items-center rounded-full grad-border bg-surface shadow-card">
          <Leaf className="size-9 text-teal" />
        </div>
        <h2 className="mt-6 text-balance text-[26px] font-bold text-ink">题库还没有这道题</h2>
        <p className="mt-3 max-w-md text-pretty leading-relaxed text-ink2">
          你这段经历落在<span className="font-semibold text-brand-dark">「人际羁绊」</span>这个维度上，很温暖也很有分量。只是当季真题里暂时没有特别合适的题来承接它——这不是你的问题，是题库还没跟上你。
        </p>
        <p className="mt-2 text-[13px] text-ink3">这段故事我已经替你存进素材库，以后遇到合适的题会第一时间提醒你。</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/">
            <GradientButton>
              <RefreshCw className="size-4" />
              重新讲一个故事
            </GradientButton>
          </Link>
          <Link href="/recording">
            <GradientButton variant="soft">
              换一道雅思题来练
              <ArrowRight className="size-4" />
            </GradientButton>
          </Link>
        </div>
        <button
          onClick={() => setEmpty(false)}
          className="mt-8 text-[13px] text-ink3 underline-offset-4 hover:underline"
        >
          返回查看匹配结果
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 lg:px-10">
      {/* summary */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-ink2">
          <Sparkles className="size-4 text-teal" />
          根据你的故事，找到 <span className="font-semibold text-ink">{filtered.length}</span> 道相关真题
        </p>
        <button
          onClick={() => setEmpty(true)}
          className="text-[12px] text-ink3 underline-offset-4 hover:underline"
        >
          预览「无匹配」收尾态
        </button>
      </div>

      {/* part filter */}
      <div className="mb-7 flex gap-2">
        {PART_FILTERS.map((p) => (
          <Chip key={p} active={part === p} onClick={() => setPart(p)}>
            {p}
          </Chip>
        ))}
      </div>

      {/* high tier */}
      {high.length > 0 && (
        <section className="mb-7">
          <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-brand-dark">
            <span className="size-2 rounded-full bg-brand" />
            高匹配
          </h3>
          <div className="flex flex-col gap-3">
            {high.map((q) => (
              <QuestionCard key={q.id} q={q} />
            ))}
          </div>
        </section>
      )}

      {/* collapsible mid + low */}
      <button
        onClick={() => setShowMore((s) => !s)}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-surface py-3 text-sm font-medium text-ink2 transition-colors hover:text-ink"
      >
        {showMore ? '收起' : `查看更多（中 / 低匹配 ${mid.length + low.length} 道）`}
        <ChevronDown className={cn('size-4 transition-transform', showMore && 'rotate-180')} />
      </button>

      {showMore && (
        <div className="mt-6 flex flex-col gap-6">
          {mid.length > 0 && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-teal">
                <span className="size-2 rounded-full bg-teal" />
                中匹配
              </h3>
              <div className="flex flex-col gap-3">
                {mid.map((q) => (
                  <QuestionCard key={q.id} q={q} />
                ))}
              </div>
            </section>
          )}
          {low.length > 0 && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink3">
                <span className="size-2 rounded-full bg-band-55" />
                低匹配
              </h3>
              <div className="flex flex-col gap-3">
                {low.map((q) => (
                  <QuestionCard key={q.id} q={q} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
