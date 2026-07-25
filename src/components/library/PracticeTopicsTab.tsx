'use client'
import { useState } from 'react'
import { useNav } from '@/components/NavProgress'
import PartTag from '@/components/PartTag'
import Chip from '@/components/Chip'
import Card from '@/components/Card'
import type { PracticedTopic } from '@/lib/types'

const PARTS = ['全部', 'Part 1', 'Part 2', 'Part 3'] as const
type PartFilter = typeof PARTS[number]

interface Props { topics: PracticedTopic[] }

export default function PracticeTopicsTab({ topics }: Props) {
  // 「练习」跳 /practice（会加载/AI 对话页）走 navigate 亮进度条，消除跳转白屏
  const { navigate } = useNav()
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
        <Card key={topic.id} variant="gradient" className="p-4">
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
            <Chip
              variant="gradient"
              onClick={() => navigate(`/practice?questionId=${topic.questionId}`)}
              className="font-medium"
            >
              练习
            </Chip>
          </div>
        </Card>
      ))}
    </div>
  )
}
