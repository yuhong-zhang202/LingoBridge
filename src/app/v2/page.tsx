'use client'
import Link from 'next/link'
import { Mic2, ChevronRight, BookOpen } from 'lucide-react'
import Button from '@/components/ui-v2/Button'
import StreakBadge from '@/components/ui-v2/StreakBadge'
import BottomNav from '@/components/ui-v2/BottomNav'

const DAILY_TOPICS = [
  { en: 'Do you enjoy outdoor activities?', zh: '你喜欢户外活动吗？', part: 'Part 1' },
  { en: 'Describe a place in nature you love.', zh: '描述你喜欢的自然场所。', part: 'Part 2' },
]

export default function V2HomePage() {
  return (
    <div className="min-h-screen bg-bg-base flex flex-col pb-[60px]">
      <div className="ambient-light-warm" />

      {/* Header */}
      <div className="flex items-center justify-between h-[56px] px-5 relative z-10">
        <span className="text-[17px] font-bold text-v2-text-primary">LingoBridge</span>
        <div className="w-[32px] h-[32px] rounded-full bg-brand-primary-light flex items-center justify-center">
          <span className="text-[12px] font-bold text-brand-primary-dark">YZ</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-2 relative z-10">
        {/* Streak */}
        <div className="mb-5">
          <StreakBadge days={7} />
        </div>

        {/* Greeting */}
        <h1 className="text-[26px] font-bold text-v2-text-primary leading-tight mb-1">
          今天说点什么？
        </h1>
        <p className="text-[13px] text-v2-text-muted mb-6">
          把你的故事变成雅思口语素材
        </p>

        {/* Main CTA */}
        <Link href="/v2/record" className="block mb-3">
          <Button variant="primary" fullWidth size="lg">
            <Mic2 size={18} />
            开始今天的练习
          </Button>
        </Link>

        {/* Continue card */}
        <div className="bg-bg-surface rounded-[18px] border border-black/[0.05] p-4 mb-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] text-v2-text-muted mb-0.5">上次未完成</p>
              <p className="text-[14px] font-semibold text-v2-text-primary">户外活动 · Part 1</p>
              <p className="text-[12px] text-v2-text-muted mt-0.5">问题 2 / 3</p>
            </div>
            <Link href="/v2/practice-dialog">
              <div className="w-[40px] h-[40px] rounded-full bg-brand-primary flex items-center justify-center shadow-sm">
                <ChevronRight size={18} className="text-white" />
              </div>
            </Link>
          </div>
          <div className="mt-3 h-[4px] bg-bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-brand-primary rounded-full" style={{ width: '40%' }} />
          </div>
        </div>

        {/* Today's hot questions */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-bold text-v2-text-primary">今日推荐题目</h2>
            <Link href="/v2/match" className="text-[12px] text-brand-primary font-medium">
              查看全部
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {DAILY_TOPICS.map((t, i) => (
              <div
                key={i}
                className="bg-bg-surface rounded-[14px] border border-black/[0.05] px-4 py-3 flex items-center justify-between"
              >
                <div className="flex-1 min-w-0 mr-3">
                  <span className="text-[10px] font-medium text-brand-accent bg-brand-accent-light px-2 py-0.5 rounded-full">
                    {t.part}
                  </span>
                  <p className="text-[13px] font-semibold text-v2-text-primary mt-1.5 leading-snug">
                    {t.en}
                  </p>
                  <p className="text-[11px] text-v2-text-muted mt-0.5">{t.zh}</p>
                </div>
                <Link href="/v2/practice-dialog">
                  <button className="flex-shrink-0 bg-brand-primary text-white text-[12px] font-semibold px-3 py-1.5 rounded-full">
                    练习
                  </button>
                </Link>
              </div>
            ))}
          </div>
        </div>

        {/* Library shortcut */}
        <Link href="/v2/library">
          <div className="bg-bg-surface rounded-[14px] border border-black/[0.05] px-4 py-3 flex items-center gap-3 mb-2">
            <div className="w-[36px] h-[36px] rounded-[10px] bg-brand-accent-light flex items-center justify-center flex-shrink-0">
              <BookOpen size={16} className="text-brand-accent" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-v2-text-primary">我的素材库</p>
              <p className="text-[11px] text-v2-text-muted">3 篇故事 · 12 道题</p>
            </div>
            <ChevronRight size={14} className="text-v2-text-muted" />
          </div>
        </Link>

        <div className="h-6" />
      </div>

      <BottomNav />
    </div>
  )
}
