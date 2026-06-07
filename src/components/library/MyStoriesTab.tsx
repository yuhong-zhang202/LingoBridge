'use client'
import { useRouter } from 'next/navigation'
import { Mic2, Keyboard, MoreHorizontal, ChevronRight } from 'lucide-react'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import type { MyStory } from '@/lib/types'
import EmptyState from '@/components/EmptyState'
import SwipeToDelete from '@/components/library/SwipeToDelete'

const PILL_GRAD = 'linear-gradient(135deg, rgba(232,136,58,0.45), rgba(123,191,116,0.45))'

interface Props { stories: MyStory[]; onDelete?: (id: string) => void }

export default function MyStoriesTab({ stories, onDelete }: Props) {
  const router = useRouter()

  if (stories.length === 0) {
    return (
      <EmptyState
        title="还没有语料"
        subtitle="去首页录一条故事，它会自动出现在这里"
        ctaLabel="去录制"
        onCta={() => router.push('/')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      {stories.map(story => (
        <SwipeToDelete key={story.id} borderRadius={16} onDelete={() => onDelete?.(story.id)}>
        <div className="bg-white rounded-[16px] p-4" style={GRADIENT_BORDER_STYLE}>
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              {story.inputType === 'voice' ? (
                <div className="flex-shrink-0 inline-flex" style={{ background: PILL_GRAD, borderRadius: 9999, padding: 1 }}>
                  <div className="flex items-center gap-1 bg-white" style={{ borderRadius: 9999, padding: '2px 8px' }}>
                    <Mic2 size={11} className="text-brand-primary-dark" />
                    <span className="text-[11px] font-medium text-brand-primary-dark">{story.duration}</span>
                  </div>
                </div>
              ) : (
                <div className="flex-shrink-0 inline-flex" style={{ background: PILL_GRAD, borderRadius: 9999, padding: 1 }}>
                  <div className="flex items-center gap-1 bg-white" style={{ borderRadius: 9999, padding: '2px 8px' }}>
                    <Keyboard size={11} className="text-brand-primary-dark" />
                    <span className="text-[11px] font-medium text-brand-primary-dark">文本</span>
                  </div>
                </div>
              )}
              <span className="text-[12px] text-v2-text-muted">{story.createdAt}</span>
            </div>
            <MoreHorizontal size={16} className="text-v2-text-muted" />
          </div>
          <p className="text-[14px] text-v2-text-primary leading-[1.6] line-clamp-3 mb-2.5">
            {story.content}
          </p>
          {(story.dimension || story.matchedCount > 0) && (
            <div className="flex items-center gap-2">
              {story.dimension && (
                <span className="text-[10px] font-medium bg-[#EDF6EB] border border-[#C0DDB9] text-[#3D7A38] px-[8px] py-[3px] rounded-full">
                  {story.dimension}
                </span>
              )}
              {story.matchedCount > 0 && (
                <>
                  <span className="text-[12px] text-v2-text-muted">已匹配 {story.matchedCount} 道题</span>
                  <button
                    onClick={() => router.push(`/matching?storyId=${story.id}`)}
                    className="flex items-center gap-0.5 text-[12px] font-medium text-brand-primary"
                  >
                    查看<ChevronRight size={13} />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        </SwipeToDelete>
      ))}
    </div>
  )
}
