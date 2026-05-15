'use client'
import { useState } from 'react'
import { Mic2, ChevronRight, Plus } from 'lucide-react'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import type { Story } from '@/lib/types'

interface Props {
  stories: Story[]
  onNavigate: (path: string) => void
}

export default function MyStoriesTab({ stories, onNavigate }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(stories[0]?.id ?? null)

  if (stories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
        <div
          className="w-[80px] h-[80px] rounded-full mb-6"
          style={{
            background: 'radial-gradient(circle, rgba(240,188,160,0.30) 0%, rgba(168,210,196,0.20) 50%, transparent 70%)',
            filter: 'blur(4px)',
          }}
        />
        <p className="text-[16px] font-semibold text-[#333] mb-2">
          还没有故事素材
        </p>
        <p className="text-[13px] text-[#888] leading-relaxed mb-6">
          说一个今天发生的小事，
          Lingo 帮你变成口语素材
        </p>
        <button
          onClick={() => onNavigate('/recording')}
          className="btn-gradient h-[44px] px-6 text-[14px]"
        >
          <Mic2 size={15} className="text-[#555]" />
          去录一个故事
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-6 pb-8">
      {stories.map(story => {
        const isSelected = selectedId === story.id
        return (
          <div
            key={story.id}
            onClick={() => setSelectedId(isSelected ? null : story.id)}
            className="bg-white rounded-[18px] overflow-hidden flex border border-black/[0.05] cursor-pointer transition-shadow duration-200"
            style={{
              boxShadow: isSelected
                ? '0 2px 16px rgba(212,135,90,0.12)'
                : '0 1px 8px rgba(0,0,0,0.05)',
            }}
          >
            {/* 左侧竖条：选中渐变，未选中透明 */}
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
              {/* 头部行 */}
              <div className="flex items-start justify-between mb-2">
                <p className="text-[15px] font-semibold text-[#111]">
                  {story.title}
                </p>
                <span className="text-[11px] text-[#BBBBBB] ml-2 mt-0.5 flex-shrink-0">
                  {story.date}
                </span>
              </div>

              {/* 预览文字 */}
              <p className="text-[13px] text-[#888] leading-relaxed mb-3 line-clamp-1">
                {story.preview}
              </p>

              {/* 元信息行 */}
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="text-[11px] font-semibold text-[#444] px-2 py-0.5 rounded-full"
                  style={GRADIENT_BORDER_STYLE}
                >
                  Band {story.band}
                </span>
                <span className="text-[11px] text-[#AAAAAA]">
                  匹配了 {story.matchCount} 道题
                </span>
              </div>

              {/* 操作行 */}
              <div className="flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onNavigate('/article-view') }}
                  className="flex-1 h-[36px] rounded-full border border-black/[0.10] text-[12px] font-medium text-[#666] flex items-center justify-center gap-1"
                >
                  查看文章
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onNavigate('/practice') }}
                  className="flex-1 h-[36px] rounded-full text-[12px] font-semibold text-[#444] flex items-center justify-center gap-1"
                  style={GRADIENT_BORDER_STYLE}
                >
                  开始练习
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {/* 新增素材入口 */}
      <button
        onClick={() => onNavigate('/')}
        className="w-full h-[50px] rounded-[16px] border border-dashed border-black/[0.12] flex items-center justify-center gap-2 text-[13px] text-[#AAAAAA]"
      >
        <Plus size={15} className="text-[#CCCCCC]" />
        录制新故事
      </button>
    </div>
  )
}
