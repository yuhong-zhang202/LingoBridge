'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Mic, Type, Shuffle, ArrowRight, Sparkles } from 'lucide-react'
import { Orb } from './orb'
import { Card, Chip, GradientButton, Tag } from './primitives'
import { IELTS_QUESTIONS } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type Mode = 'story' | 'ielts'

const ELEMENTS = ['时间', '人物', '发生的事', '你的做法和感受']

export function HomeHero() {
  const [mode, setMode] = useState<Mode>('story')
  const [textMode, setTextMode] = useState(false)
  const [text, setText] = useState('')
  const [qIndex, setQIndex] = useState(0)

  const richness = Math.min(100, Math.round((text.length / 120) * 100))

  return (
    <div className="mx-auto max-w-5xl">
      {/* mode switcher */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-full border border-border bg-surface p-1 shadow-card">
          {(
            [
              { key: 'story', label: '我的故事' },
              { key: 'ielts', label: '雅思题' },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={cn(
                'rounded-full px-5 py-2 text-sm font-semibold transition-all',
                mode === m.key ? 'bg-fill text-ink shadow-card' : 'text-ink2 hover:text-ink',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid items-center gap-10 lg:mt-14 lg:grid-cols-2">
        {/* left: copy + action */}
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <Tag variant="green" className="mb-5">
            <Sparkles className="size-3" />
            不背模板，讲你自己的故事
          </Tag>
          {mode === 'story' ? (
            <>
              <h2 className="text-balance text-[28px] font-bold leading-tight text-ink lg:text-[34px]">
                讲一个属于你的<span className="grad-text">真实故事</span>
              </h2>
              <p className="mt-3 max-w-md text-pretty leading-relaxed text-ink2">
                用中文随便聊聊最近发生的事，我会帮你整理成素材，再反向匹配到当季雅思真题。说得越具体，匹配越准。
              </p>
            </>
          ) : (
            <>
              <h2 className="text-balance text-[28px] font-bold leading-tight text-ink lg:text-[34px]">
                没头绪？<span className="grad-text">抽一道真题</span>来练
              </h2>
              <p className="mt-3 max-w-md text-pretty leading-relaxed text-ink2">
                我会直接抛给你一道当季雅思口语真题，你只管开口讲，剩下的交给我。
              </p>
            </>
          )}

          {/* action panel grouped with copy */}
          <div className="mt-8 w-full max-w-md">
          {mode === 'story' ? (
            !textMode ? (
              <Card gradient className="flex flex-col items-center gap-6 p-8 lg:p-10">
                <button
                  className="group relative grid size-28 place-items-center rounded-full grad-border bg-surface shadow-float transition-transform active:scale-95"
                  aria-label="开始录音"
                >
                  <Mic className="size-10 text-brand transition-transform group-hover:scale-110" />
                </button>
                <Link href="/recording" className="contents">
                  <GradientButton size="lg" className="w-full">
                    <Mic className="size-4" />
                    开始录音
                  </GradientButton>
                </Link>
                <button
                  onClick={() => setTextMode(true)}
                  className="flex items-center gap-2 text-sm font-medium text-ink2 transition-colors hover:text-ink"
                >
                  <Type className="size-4" />
                  或用文字输入
                </button>
              </Card>
            ) : (
              <Card gradient className="flex flex-col gap-4 p-6 lg:p-8">
                <div className="rounded-[14px] bg-inset p-4">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={5}
                    placeholder="用中文讲讲那件事吧……比如上周末你做了什么、和谁、心情怎么样。"
                    className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink3"
                  />
                </div>

                {/* richness meter */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[12px]">
                    <span className="text-ink2">故事丰富度</span>
                    <span className="text-ink3">{richness}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-fill">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand to-teal transition-all"
                      style={{ width: `${richness}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {ELEMENTS.map((el) => (
                    <span
                      key={el}
                      className="rounded-full bg-fill px-3 py-1 text-[11px] font-medium text-ink2"
                    >
                      {el}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => setTextMode(false)}
                    className="flex items-center gap-2 text-sm font-medium text-ink2 transition-colors hover:text-ink"
                  >
                    <Mic className="size-4" />
                    改用录音
                  </button>
                  <Link href="/restructure">
                    <GradientButton disabled={text.length === 0}>
                      整理这段故事
                      <ArrowRight className="size-4" />
                    </GradientButton>
                  </Link>
                </div>
              </Card>
            )
          ) : (
            <Card gradient className="flex flex-col gap-6 p-8 lg:p-10">
              <Tag variant="gradient">当季真题</Tag>
              <p className="text-pretty text-[20px] font-semibold leading-relaxed text-ink lg:text-[22px]">
                {IELTS_QUESTIONS[qIndex]}
              </p>
              <div className="flex items-center justify-between pt-2">
                <Chip onClick={() => setQIndex((i) => (i + 1) % IELTS_QUESTIONS.length)}>
                  <Shuffle className="size-3.5" />
                  换一题
                </Chip>
                <Link href="/recording">
                  <GradientButton>
                    <Mic className="size-4" />
                    开始讲
                  </GradientButton>
                </Link>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
