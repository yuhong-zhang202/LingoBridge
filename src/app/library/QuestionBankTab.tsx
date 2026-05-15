'use client'
import { useState } from 'react'
import { CheckCircle, Circle, ChevronRight, ChevronDown, Plus } from 'lucide-react'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import { QUESTIONS_BY_PART } from '@/data/library'

interface Props {
  onNavigate: (path: string) => void
}

export default function QuestionBankTab({ onNavigate }: Props) {
  const [openParts, setOpenParts] = useState<string[]>(['Part 1'])
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(
    QUESTIONS_BY_PART['Part 1'][0]?.id ?? null
  )

  const togglePart = (part: string) => {
    setOpenParts(prev =>
      prev.includes(part)
        ? prev.filter(p => p !== part)
        : [...prev, part]
    )
  }

  const partCounts: Record<string, number> = {
    'Part 1': QUESTIONS_BY_PART['Part 1'].length,
    'Part 2': QUESTIONS_BY_PART['Part 2'].length,
    'Part 3': QUESTIONS_BY_PART['Part 3'].length,
  }

  const hasStoryCount = (part: string) =>
    QUESTIONS_BY_PART[part].filter(q => q.hasStory).length

  const totalCount = Object.values(partCounts).reduce((a, b) => a + b, 0)

  return (
    <div className="flex flex-col pb-8">

      {/* 季度说明 */}
      <div className="px-6 mb-4">
        <p className="text-[13px] text-[#888]">
          2026年1–4月 · 共 {totalCount} 道真题
        </p>
      </div>

      {/* Part 分组 */}
      {(['Part 1', 'Part 2', 'Part 3'] as const).map(part => {
        const isOpen = openParts.includes(part)
        const questions = QUESTIONS_BY_PART[part]
        const withStory = hasStoryCount(part)

        return (
          <div key={part} className="mb-1">

            {/* Part 标题行 */}
            <button
              onClick={() => togglePart(part)}
              className="w-full flex items-center justify-between px-6 py-3.5 bg-bg-page"
            >
              <div className="flex items-center gap-3">
                <span className="text-[15px] font-semibold text-[#111]">
                  {part}
                </span>
                <span className="text-[12px] text-[#AAAAAA]">
                  {withStory}/{partCounts[part]} 有素材
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#F4F4F4] text-[#888]">
                  {partCounts[part]} 题
                </span>
                <ChevronDown
                  size={15}
                  className={`text-[#AAAAAA] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                />
              </div>
            </button>

            {/* 题目列表 */}
            {isOpen && (
              <div className="px-6 flex flex-col gap-2 pb-3 animate-fade-up">
                {questions.map(q => {
                  const isTopicSelected = selectedTopicId === q.id
                  return (
                    <div
                      key={q.id}
                      onClick={() => setSelectedTopicId(isTopicSelected ? null : q.id)}
                      className="bg-white rounded-[16px] overflow-hidden border border-black/[0.05] flex cursor-pointer transition-shadow duration-200"
                      style={{
                        boxShadow: isTopicSelected
                          ? '0 2px 16px rgba(212,135,90,0.12)'
                          : '0 1px 6px rgba(0,0,0,0.04)',
                      }}
                    >
                      {/* 左侧竖条：选中渐变，未选中透明 */}
                      <div className="w-[4px] flex-shrink-0 self-stretch">
                        {isTopicSelected ? (
                          <div
                            className="w-full h-full"
                            style={{ background: 'linear-gradient(to bottom, rgba(212,135,90,0.45), rgba(119,166,153,0.45))' }}
                          />
                        ) : (
                          <div className="w-full h-full bg-transparent" />
                        )}
                      </div>

                      <div className="flex-1 p-4">
                        {/* 有无素材指示 */}
                        <div className="flex items-center gap-1.5 mb-2">
                          {q.hasStory ? (
                            <>
                              <CheckCircle size={12} className="text-brand-accent" />
                              <span className="text-[11px] text-brand-accent font-medium">
                                已有素材
                              </span>
                              {q.storyTitle && (
                                <span className="text-[11px] text-[#AAAAAA]">
                                  · {q.storyTitle}
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              <Circle size={12} className="text-[#CCCCCC]" />
                              <span className="text-[11px] text-[#CCCCCC]">
                                暂无素材
                              </span>
                            </>
                          )}
                        </div>

                        {/* 题目正文 */}
                        <p className="text-[14px] font-bold text-[#111] leading-snug mb-1">
                          {q.en}
                        </p>
                        <p className="text-[12px] text-[#AAAAAA] mb-3">
                          {q.zh}
                        </p>

                        {/* 操作 */}
                        {q.hasStory ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); onNavigate('/practice') }}
                            className="h-[34px] px-4 rounded-full text-[12px] font-semibold text-[#444] flex items-center gap-1"
                            style={GRADIENT_BORDER_STYLE}
                          >
                            用素材练习
                            <ChevronRight size={12} />
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); onNavigate('/recording') }}
                            className="h-[34px] px-4 rounded-full border border-black/[0.10] text-[12px] font-medium text-[#888] flex items-center gap-1"
                          >
                            <Plus size={12} />
                            去录一个素材
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
