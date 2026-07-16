'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bookmark, SkipForward, Sparkles, ArrowRight, RotateCcw, Volume2 } from 'lucide-react'
import { Orb } from './orb'
import { GradientButton, Tag } from './primitives'
import { FEEDBACK_CARDS } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export function FeedbackView() {
  const [index, setIndex] = useState(0)
  const [savedCount, setSavedCount] = useState(0)
  const [leaving, setLeaving] = useState<'skip' | 'save' | null>(null)

  const total = FEEDBACK_CARDS.length
  const card = FEEDBACK_CARDS[index]
  const done = index >= total

  function advance(action: 'skip' | 'save') {
    setLeaving(action)
    if (action === 'save') setSavedCount((c) => c + 1)
    setTimeout(() => {
      setIndex((i) => i + 1)
      setLeaving(null)
    }, 260)
  }

  if (done) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-16 text-center">
        <Orb size={140} active />
        <h2 className="mt-6 text-balance text-[26px] font-bold text-ink">回顾完成</h2>
        <p className="mt-3 max-w-sm text-pretty leading-relaxed text-ink2">
          这一场你收藏了 <span className="font-semibold text-brand-dark">{savedCount}</span> 句更地道的表达，它们已经进了你的表达库。下次讲类似的故事，就能更自然地用上了。
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/library">
            <GradientButton>
              去表达库看看
              <ArrowRight className="size-4" />
            </GradientButton>
          </Link>
          <Link href="/">
            <GradientButton variant="soft">
              <RotateCcw className="size-4" />
              再练一个故事
            </GradientButton>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-10">
      {/* progress dots */}
      <div className="mb-6 flex items-center gap-2">
        {FEEDBACK_CARDS.map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 rounded-full transition-all',
              i === index ? 'w-6 bg-brand' : i < index ? 'w-1.5 bg-brand-light' : 'w-1.5 bg-fill',
            )}
          />
        ))}
      </div>
      <p className="mb-6 text-[13px] text-ink3">
        第 {index + 1} / {total} 张 · 左侧跳过，右侧收藏进表达库
      </p>

      {/* card */}
      <div
        className={cn(
          'grad-border w-full rounded-[24px] bg-surface p-7 shadow-float transition-all duration-300',
          leaving === 'skip' && '-translate-x-12 -rotate-3 opacity-0',
          leaving === 'save' && 'translate-x-12 rotate-3 opacity-0',
        )}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag variant="neutral">{card.part}</Tag>
            <span className="text-[12px] text-ink3">{card.date}</span>
          </div>
          <button className="grid size-9 place-items-center rounded-full bg-inset text-teal active:scale-95" aria-label="播放发音">
            <Volume2 className="size-[18px]" />
          </button>
        </div>

        <div className="rounded-[14px] bg-inset p-4">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink3">你的原句</p>
          <p className="text-[15px] leading-relaxed text-ink2">{card.original}</p>
        </div>

        <div className="mt-3 rounded-[14px] border border-tag-border bg-tag-bg p-4">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-tag-text">
            <Sparkles className="size-3" />
            AI 优化句
          </p>
          <p className="text-[16px] leading-relaxed text-ink">{card.improved}</p>
        </div>
      </div>

      {/* actions */}
      <div className="mt-8 flex items-center gap-6">
        <button
          onClick={() => advance('skip')}
          className="flex size-16 flex-col items-center justify-center gap-0.5 rounded-full border border-border bg-surface text-ink3 shadow-card transition-transform active:scale-95"
          aria-label="跳过"
        >
          <SkipForward className="size-6" />
        </button>
        <button
          onClick={() => advance('save')}
          className="grid size-20 place-items-center rounded-full grad-border bg-surface text-brand shadow-float transition-transform active:scale-95"
          aria-label="收藏进表达库"
        >
          <Bookmark className="size-8" />
        </button>
      </div>
      <p className="mt-3 text-[12px] text-ink3">已收藏 {savedCount} 句</p>
    </div>
  )
}
