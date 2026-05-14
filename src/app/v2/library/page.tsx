'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, CheckCircle, Circle, ChevronDown, ChevronUp } from 'lucide-react'
import Badge from '@/components/ui-v2/Badge'
import BottomNav from '@/components/ui-v2/BottomNav'

const BAND_COLORS: Record<string, string> = {
  '5.5': '#AAAAAA',
  '6.0': '#7BA699',
  '6.5': '#D4875A',
  '7.0': '#9A7DB8',
}

const MY_STORIES = [
  { id: 1, title: '公园的周末',     date: '2024-01-08', band: '6.0', questions: 3 },
  { id: 2, title: '第一次骑行体验', date: '2024-01-05', band: '6.5', questions: 2 },
  { id: 3, title: '家乡的传统节日', date: '2023-12-28', band: '6.0', questions: 5 },
]

const QUESTIONS_BY_PART: Record<string, { en: string; hasStory: boolean }[]> = {
  'Part 1': [
    { en: 'Do you often go to parks?',                    hasStory: true  },
    { en: 'What do you do on weekends?',                  hasStory: true  },
    { en: 'Do you prefer cities or the countryside?',     hasStory: false },
  ],
  'Part 2': [
    { en: 'Describe a place in nature you love.',         hasStory: true  },
    { en: 'Talk about a memorable journey.',              hasStory: false },
  ],
  'Part 3': [
    { en: 'How has urbanization affected nature?',        hasStory: false },
    { en: 'What can governments do to protect the environment?', hasStory: false },
  ],
}

type Tab = 'stories' | 'questions'

export default function V2LibraryPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('stories')
  const [openParts, setOpenParts] = useState<string[]>(['Part 1'])

  const togglePart = (p: string) =>
    setOpenParts(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])

  const allQ = Object.values(QUESTIONS_BY_PART).flat()
  const coveredQ = allQ.filter(q => q.hasStory).length
  const coverPct = Math.round((coveredQ / allQ.length) * 100)
  const circumference = 2 * Math.PI * 26

  return (
    <div className="min-h-screen bg-bg-base flex flex-col pb-[60px]">
      <div className="w-full flex items-center justify-between h-[56px] px-5">
        <span className="text-[17px] font-bold text-v2-text-primary">素材库</span>
        <div className="w-[36px]" />
      </div>

      {/* Stats card with ring */}
      <div className="px-5 mb-5">
        <div className="bg-bg-surface rounded-[18px] border border-black/[0.05] p-4 flex items-center gap-4 shadow-sm">
          <div className="relative w-[64px] h-[64px] flex-shrink-0">
            <svg width="64" height="64" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="26" fill="none" stroke="#EEEBE6" strokeWidth="6" />
              <circle
                cx="32" cy="32" r="26"
                fill="none"
                stroke="#D4875A"
                strokeWidth="6"
                strokeDasharray={`${circumference}`}
                strokeDashoffset={`${circumference * (1 - coveredQ / allQ.length)}`}
                strokeLinecap="round"
                transform="rotate(-90 32 32)"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[13px] font-bold text-v2-text-primary">{coverPct}%</span>
            </div>
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-v2-text-primary">
              已覆盖 {coveredQ}/{allQ.length} 道题
            </p>
            <p className="text-[11px] text-v2-text-muted mt-0.5">
              共 {MY_STORIES.length} 篇故事素材
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex px-5 mb-4 border-b border-black/[0.06]">
        {(['stories', 'questions'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 pb-2.5 text-[13px] font-semibold transition-all border-b-2 -mb-px ${
              activeTab === tab
                ? 'text-brand-primary border-brand-primary'
                : 'text-v2-text-muted border-transparent'
            }`}
          >
            {tab === 'stories' ? '我的故事' : '题库'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5">
        {activeTab === 'stories' && (
          <div className="flex flex-col gap-3">
            {MY_STORIES.map(story => (
              <div
                key={story.id}
                className="relative bg-bg-surface rounded-[18px] border border-black/[0.05] shadow-sm overflow-hidden"
              >
                <div
                  className="absolute left-0 top-0 bottom-0 w-[4px]"
                  style={{ background: BAND_COLORS[story.band] }}
                />
                <div className="pl-5 pr-4 py-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[14px] font-semibold text-v2-text-primary">
                      {story.title}
                    </span>
                    <Badge variant="band" label={`Band ${story.band}`} />
                  </div>
                  <p className="text-[11px] text-v2-text-muted">
                    {story.date} · {story.questions} 道题已匹配
                  </p>
                  <button
                    onClick={() => router.push('/v2/practice-dialog')}
                    className="mt-3 text-[12px] font-semibold text-brand-primary"
                  >
                    继续练习 →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'questions' && (
          <div className="flex flex-col gap-3">
            {Object.entries(QUESTIONS_BY_PART).map(([part, qs]) => {
              const open = openParts.includes(part)
              const covered = qs.filter(q => q.hasStory).length
              return (
                <div
                  key={part}
                  className="bg-bg-surface rounded-[18px] border border-black/[0.05] shadow-sm overflow-hidden"
                >
                  <button
                    onClick={() => togglePart(part)}
                    className="w-full flex items-center justify-between px-4 py-3.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-v2-text-primary">{part}</span>
                      <span className="text-[11px] text-v2-text-muted">
                        {covered}/{qs.length} 已覆盖
                      </span>
                    </div>
                    {open
                      ? <ChevronUp size={14} className="text-v2-text-muted" />
                      : <ChevronDown size={14} className="text-v2-text-muted" />}
                  </button>
                  {open && (
                    <div className="border-t border-black/[0.05] accordion-open">
                      {qs.map((q, i) => (
                        <div
                          key={i}
                          className={`flex items-center gap-3 px-4 py-3 border-b border-black/[0.04] last:border-0 ${
                            q.hasStory ? 'border-l-4 border-l-brand-accent' : ''
                          }`}
                        >
                          {q.hasStory
                            ? <CheckCircle size={14} className="text-brand-accent flex-shrink-0" />
                            : <Circle size={14} className="text-[#CCCCCC] flex-shrink-0" />}
                          <p className="text-[13px] text-v2-text-primary leading-snug">{q.en}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div className="h-8" />
      </div>

      {/* FAB */}
      <button
        onClick={() => router.push('/v2/record')}
        className="fixed right-5 bottom-[76px] w-[52px] h-[52px] rounded-full bg-brand-primary shadow-lg flex items-center justify-center active:scale-95 transition-transform z-10"
      >
        <Plus size={22} className="text-white" />
      </button>

      <BottomNav />
    </div>
  )
}
