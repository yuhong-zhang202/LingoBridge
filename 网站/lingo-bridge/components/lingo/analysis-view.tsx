'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Target, ListOrdered, Tag as TagIcon, ArrowRight, Sparkles } from 'lucide-react'
import { Card, Chip, GradientButton, Tag } from './primitives'
import { PHRASE_GROUPS, SENTENCE_FRAMES } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

const BANDS = ['5.0', '5.5', '6.0', '6.5', '7.0', '8.0'] as const

const PHRASE_STYLES = {
  orange: 'bg-[#F7EBE1] text-[#B5663A] border-[#F2D5C0]',
  green: 'bg-[#EDF6EB] text-[#3D7A38] border-[#C0DDB9]',
  blue: 'bg-[#E9EEF4] text-[#4A6178] border-[#CCD8E6]',
} as const

const FOCUS_POINTS = [
  '考官想听到一个具体的人和具体的情境，而不是泛泛而谈。',
  '重点在「你做了什么」——动词要清晰，过程要有顺序感。',
  '结尾的感受最能体现语言的细腻度，别只说 happy / good。',
]

export function AnalysisView() {
  const [band, setBand] = useState<(typeof BANDS)[number]>('6.5')

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 lg:px-10">
      {/* question recap + band selector */}
      <Card className="mb-6 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Tag variant="neutral">Part 2</Tag>
          <Tag variant="green">人际羁绊</Tag>
        </div>
        <h2 className="mt-3 text-pretty text-[18px] font-semibold leading-relaxed text-ink">
          Describe a time when you helped someone.
        </h2>
        <div className="mt-5">
          <p className="mb-2 text-[13px] font-medium text-ink2">目标分数段</p>
          <div className="flex flex-wrap gap-2">
            {BANDS.map((b) => (
              <Chip key={b} size="sm" active={band === b} onClick={() => setBand(b)}>
                Band {b}
              </Chip>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* focus points */}
        <Card gradient className="p-6">
          <h3 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Target className="size-[18px] text-brand" />
            考官侧重点
          </h3>
          <ul className="flex flex-col gap-3">
            {FOCUS_POINTS.map((p, i) => (
              <li key={i} className="flex gap-3 text-pretty text-[14px] leading-relaxed text-ink2">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-light text-[11px] font-bold text-brand-dark">
                  {i + 1}
                </span>
                {p}
              </li>
            ))}
          </ul>
        </Card>

        {/* sentence frames */}
        <Card gradient className="p-6">
          <h3 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <ListOrdered className="size-[18px] text-teal" />
            句式框架
          </h3>
          <ol className="flex flex-col gap-3">
            {SENTENCE_FRAMES.map((f, i) => (
              <li key={i} className="flex gap-3 rounded-[14px] bg-inset p-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface text-[12px] font-bold text-teal shadow-card">
                  {i + 1}
                </span>
                <span className="text-pretty text-[14px] leading-relaxed text-ink">{f}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* phrases */}
      <Card className="mt-6 p-6">
        <h3 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-ink">
          <TagIcon className="size-[18px] text-brand" />
          可用词组
        </h3>
        <div className="grid gap-5 sm:grid-cols-3">
          {PHRASE_GROUPS.map((group) => (
            <div key={group.theme}>
              <p className="mb-2 text-[12px] font-semibold text-ink2">{group.theme}</p>
              <div className="flex flex-wrap gap-2">
                {group.phrases.map((ph) => (
                  <span
                    key={ph}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[12px] font-medium',
                      PHRASE_STYLES[group.color],
                    )}
                  >
                    {ph}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-10 flex items-center justify-between">
        <p className="hidden items-center gap-2 text-[13px] text-ink3 sm:flex">
          <Sparkles className="size-4 text-teal" />
          准备好了就开口，练错也没关系
        </p>
        <Link href="/practice">
          <GradientButton size="lg">
            进入练习对话
            <ArrowRight className="size-4" />
          </GradientButton>
        </Link>
      </div>
    </div>
  )
}
