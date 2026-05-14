'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Star, ArrowRight, Sparkles } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'
import TabBar from '@/components/TabBar'

const PARTS = ['全部', 'Part 1', 'Part 2', 'Part 3']

const QUESTIONS = [
  {
    id: 'q1', part: 'Part 1', hot: true,
    en: 'Do you often go to parks or outdoor spaces?',
    zh: '你经常去公园吗？',
    reason: '与你的故事相关：公园、自然、放松',
  },
  {
    id: 'q2', part: 'Part 2', hot: true,
    en: 'Describe a place in nature you like to visit.',
    zh: '描述你喜欢的自然环境中的一个地方。',
    reason: '与你的故事相关：户外环境、情绪体验',
  },
  {
    id: 'q3', part: 'Part 1', hot: false,
    en: 'What do you do on weekends?',
    zh: '你周末都做些什么？',
    reason: '与你的故事相关：周末活动、休闲方式',
  },
]

const GRADIENT_BORDER_STYLE = {
  background: [
    'linear-gradient(white, white) padding-box',
    'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80)) border-box',
  ].join(','),
  border: '1.5px solid transparent',
} as React.CSSProperties

export default function MatchingPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'全部' | 'Part 1' | 'Part 2' | 'Part 3'>('全部')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filteredQuestions = QUESTIONS.filter(q =>
    activeTab === '全部' ? true : q.part === activeTab
  )

  const handleTabChange = (p: typeof activeTab) => {
    setActiveTab(p)
    setSelectedId(null)
  }

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col pb-[56px]">
      <div className="ambient-light" />
      <TopBar title="题目匹配" />
      <StepBar currentStep="topic" />

      <div className="flex-1 overflow-y-auto px-6 relative z-10">

        {/* 故事预览 */}
        <div className="surface px-3.5 py-2.5 mb-5 flex items-center gap-2">
          <Sparkles size={13} className="text-[#AAAAAA] flex-shrink-0" />
          <span className="text-[12px] text-[#888] italic truncate">
            「上周末我去了附近的公园...」
          </span>
        </div>

        {/* 匹配标题 */}
        <div className="mb-4">
          <h2 className="text-[20px] font-bold text-[#111]">
            匹配到 5 道当季真题
          </h2>
          <p className="text-[12px] text-[#888] mt-1">
            覆盖 Part 1 · Part 2 · Part 3
          </p>
        </div>

        {/* Part 筛选 */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {PARTS.map(p => {
            const active = activeTab === p
            return (
              <button
                key={p}
                onClick={() => handleTabChange(p as typeof activeTab)}
                className="px-3.5 py-[5px] rounded-full text-[12px] font-medium transition-all duration-150"
                style={active ? GRADIENT_BORDER_STYLE : {
                  background: 'transparent',
                  border: '1px solid #E5E5E5',
                  color: '#AAAAAA',
                }}
              >
                {p}
              </button>
            )
          })}
        </div>

        {/* 题目卡片 */}
        <div className="flex flex-col gap-3 mb-6">
          {filteredQuestions.map((item) => {
            const isSelected = selectedId === item.id
            return (
              <div
                key={item.id}
                onClick={() => setSelectedId(isSelected ? null : item.id)}
                className={`
                  bg-white rounded-[14px] overflow-hidden flex cursor-pointer
                  border border-black/[0.05] transition-shadow duration-200
                  ${isSelected
                    ? 'shadow-[0_2px_16px_rgba(212,135,90,0.12)]'
                    : 'shadow-[0_1px_8px_rgba(0,0,0,0.06)]'
                  }
                `}
              >
                {/* 左侧竖条 */}
                <div className="w-[4px] flex-shrink-0 self-stretch">
                  {isSelected ? (
                    <div
                      className="w-full h-full"
                      style={{ background: 'linear-gradient(to bottom, rgba(240,188,160,0.85), rgba(168,210,196,0.80))' }}
                    />
                  ) : (
                    <div className="w-full h-full bg-transparent" />
                  )}
                </div>

                <div className="flex-1 p-4">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[11px] font-medium text-[#888] bg-[#F4F4F4] px-2.5 py-1 rounded-full">
                      {item.part}
                    </span>
                    {item.hot && (
                      <span className="text-[10px] font-medium bg-[rgba(240,188,160,0.18)] text-[#D4875A] px-2 py-0.5 rounded-full">
                        当季热题
                      </span>
                    )}
                  </div>

                  <p className="text-[16px] font-bold text-[#111] leading-snug">
                    {item.en}
                  </p>
                  <p className="text-[12px] text-[#AAAAAA] mt-0.5">
                    {item.zh}
                  </p>

                  {/* 底部操作行：收藏图标 + 原因标签 + 练习按钮 */}
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2">
                      <button
                        className="p-1"
                        onClick={e => e.stopPropagation()}
                      >
                        <Star size={14} className="text-[#CCCCCC]" />
                      </button>
                      <span className="text-[11px] text-[#888888]">
                        {item.reason}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        router.push('/practice')
                      }}
                      className="flex items-center gap-1 text-[12px] font-semibold text-[#444] px-3 py-1.5 rounded-full flex-shrink-0"
                      style={GRADIENT_BORDER_STYLE}
                    >
                      练习
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <TabBar />
    </div>
  )
}
