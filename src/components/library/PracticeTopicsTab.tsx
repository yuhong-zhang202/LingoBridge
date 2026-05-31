'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PartTag from '@/components/PartTag'
import Chip from '@/components/Chip'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import type { PracticedTopic } from '@/lib/types'

const PARTS = ['全部', 'Part 1', 'Part 2', 'Part 3'] as const
type PartFilter = typeof PARTS[number]

interface Props { topics: PracticedTopic[] }

export default function PracticeTopicsTab({ topics }: Props) {
  const router = useRouter()
  const [filter, setFilter] = useState<PartFilter>('全部')
  const filtered = filter === '全部' ? topics : topics.filter(t => t.part === filter)

  if (topics.length === 0) {
    return (
      <div className="flex items-center justify-center pt-20 px-4 text-center">
        <p className="text-[14px] text-v2-text-muted">还没有练习过的题目，从首页开始录音吧</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex gap-2 flex-wrap">
        {PARTS.map(p => (
          <Chip
            key={p}
            onClick={() => setFilter(p)}
            variant="ghost"
            active={filter === p}
          >
            {p}
          </Chip>
        ))}
      </div>
      {filtered.map(topic => (
        <div key={topic.id} className="bg-white rounded-[16px] p-4" style={GRADIENT_BORDER_STYLE}>
          <div className="flex items-center justify-between mb-2.5">
            <PartTag label={topic.part} />
            <span className="text-[12px] text-v2-text-muted">{topic.lastPracticedAt}</span>
          </div>
          <p className="text-[14px] font-medium text-v2-text-primary leading-[1.6] mb-3">
            {topic.topicEn}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-v2-text-muted">
              已练习 {topic.practiceCount} 次 · 收藏 {topic.collectedCount} 张
            </span>
            <button
              onClick={() => router.push(`/practice?questionId=${topic.questionId}`)}
              className="px-[14px] py-[5px] rounded-full text-[12px] font-medium text-v2-text-secondary"
              style={GRADIENT_BORDER_STYLE}
            >
              练习
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
