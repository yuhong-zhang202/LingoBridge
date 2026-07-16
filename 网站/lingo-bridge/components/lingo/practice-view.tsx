'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X, Mic, Hammer, Volume2, Sparkles, Bookmark, ArrowRight, Square } from 'lucide-react'
import { Orb } from './orb'
import { Card, GradientButton } from './primitives'
import { cn } from '@/lib/utils'

interface Turn {
  role: 'coach' | 'user'
  text: string
}

const SCRIPT: Turn[] = [
  { role: 'coach', text: "Hi, I'm Lior. Let's just chat — tell me about a time you helped someone. No pressure, take your time." },
  { role: 'user', text: 'Last weekend my friend feel very sad because of her work, so I help her.' },
  { role: 'coach', text: "That's lovely. What did you actually do to help her? Walk me through it." },
  { role: 'user', text: 'I ask her to drink coffee and we talk for long time, she feel better after.' },
  { role: 'coach', text: 'Nice — and how did that make you feel afterwards?' },
]

const REPHRASE = {
  original: 'Last weekend my friend feel very sad because of her work, so I help her.',
  improved:
    'Last weekend, a close friend of mine was feeling really down because of some setbacks at work, so I stepped in to support her.',
  notes: ['feel → was feeling（过去进行，更自然）', 'help her → stepped in to support her（更地道）'],
}

const PRONUNCIATION = {
  word: 'weekend',
  ipa: '/ˈwiːkˌend/',
  tip: '重音在第一个音节 WEEK，结尾 -end 别吞掉。',
}

export function PracticeView() {
  const [turns, setTurns] = useState(SCRIPT.slice(0, 3))
  const [rephrase, setRephrase] = useState(false)
  const [pron, setPron] = useState(false)
  const [saved, setSaved] = useState(false)
  const [recording, setRecording] = useState(false)
  const round = Math.ceil(turns.filter((t) => t.role === 'user').length)
  const done = turns.length >= SCRIPT.length

  function nextTurn() {
    setRecording(false)
    setTurns(SCRIPT.slice(0, Math.min(SCRIPT.length, turns.length + 2)))
  }

  return (
    <div className="relative flex min-h-svh flex-col">
      {/* top bar (no main nav during practice) */}
      <header className="sticky top-0 z-20 border-b border-border bg-page/80 px-6 py-3 backdrop-blur-md lg:px-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Orb size={36} active />
            <div>
              <p className="text-[14px] font-bold text-ink">Lior · AI 口语教练</p>
              <p className="text-[12px] text-ink3">低压对话 · 第 {Math.min(round, 8)} / 8 轮</p>
            </div>
          </div>
          <Link
            href="/feedback"
            className="grid size-9 place-items-center rounded-full border border-border bg-surface text-ink2 transition-colors hover:text-ink"
            aria-label="结束练习"
          >
            <X className="size-[18px]" />
          </Link>
        </div>
      </header>

      {/* conversation */}
      <div className="flex-1 px-6 py-6 lg:px-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {turns.map((t, i) =>
            t.role === 'coach' ? (
              <div key={i} className="flex max-w-[80%] gap-3 self-start">
                <Orb size={34} className="mt-1" />
                <div className="rounded-[16px] rounded-tl-md border border-border bg-surface px-4 py-3 shadow-card">
                  <p className="text-pretty text-[15px] leading-relaxed text-ink">{t.text}</p>
                </div>
              </div>
            ) : (
              <div key={i} className="flex max-w-[82%] flex-col items-end gap-1.5 self-end">
                <div className="grad-border rounded-[16px] rounded-tr-md bg-surface px-4 py-3 shadow-card">
                  <p className="text-pretty text-[15px] leading-relaxed text-ink">{t.text}</p>
                </div>
                <button
                  onClick={() => setRephrase(true)}
                  className="flex items-center gap-1.5 rounded-full bg-fill px-3 py-1 text-[12px] font-medium text-ink2 transition-colors hover:text-brand-dark"
                >
                  <Hammer className="size-3.5" />
                  换一种更好的表达
                </button>
              </div>
            ),
          )}

          {done && (
            <Card gradient className="mt-4 flex flex-col items-center gap-4 p-8 text-center">
              <Orb size={90} active />
              <h3 className="text-balance text-[20px] font-bold text-ink">这一场聊得很好</h3>
              <p className="max-w-sm text-pretty leading-relaxed text-ink2">
                你已经能把这个故事比较顺地讲出来了。我把刚才帮你优化过的句子整理成了卡片，去看看吧。
              </p>
              <Link href="/feedback">
                <GradientButton size="lg">
                  查看反馈卡片
                  <ArrowRight className="size-4" />
                </GradientButton>
              </Link>
            </Card>
          )}
        </div>
      </div>

      {/* mic dock */}
      {!done && (
        <div className="sticky bottom-0 border-t border-border bg-page/80 px-6 py-4 backdrop-blur-md lg:px-10">
          <div className="mx-auto flex max-w-3xl items-center justify-center gap-4">
            <button
              onClick={() => (recording ? nextTurn() : setRecording(true))}
              className={cn(
                'grid size-16 place-items-center rounded-full shadow-float transition-transform active:scale-95',
                recording ? 'bg-error text-surface' : 'grad-border bg-surface text-brand',
              )}
              aria-label={recording ? '停止并发送' : '按住说话'}
            >
              {recording ? <Square className="size-6 fill-current" /> : <Mic className="size-6" />}
            </button>
            <p className="text-[13px] text-ink2">
              {recording ? '正在聆听…… 说完点一下结束' : '点击麦克风，用英文回应 Lior'}
            </p>
          </div>
        </div>
      )}

      {/* rephrase sheet (modal) */}
      {rephrase && (
        <Modal onClose={() => setRephrase(false)} title="换一种表达" icon={<Hammer className="size-4 text-brand" />}>
          <div className="rounded-[14px] bg-inset p-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink3">你的原句</p>
            <p className="text-[14px] leading-relaxed text-ink2">{REPHRASE.original}</p>
          </div>
          <div className="grad-border rounded-[14px] bg-surface p-4">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-tag-text">
              <Sparkles className="size-3" />
              更好的表达
            </p>
            <p className="text-[15px] leading-relaxed text-ink">{REPHRASE.improved}</p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {REPHRASE.notes.map((n) => (
              <li key={n} className="flex gap-2 text-[13px] leading-relaxed text-ink2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal" />
                {n}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={() => setPron(true)}
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-[13px] font-medium text-ink2 hover:text-ink"
            >
              <Volume2 className="size-4" />
              看发音
            </button>
            <GradientButton size="sm" onClick={() => setRephrase(false)}>
              <Bookmark className="size-4" />
              收藏进表达库
            </GradientButton>
          </div>
        </Modal>
      )}

      {/* pronunciation card */}
      {pron && (
        <Modal onClose={() => setPron(false)} title="发音纠错" icon={<Volume2 className="size-4 text-teal" />}>
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <p className="text-[24px] font-bold text-ink">{PRONUNCIATION.word}</p>
            <p className="font-mono text-[15px] text-brand-dark">{PRONUNCIATION.ipa}</p>
            <button className="mt-2 grid size-12 place-items-center rounded-full grad-border bg-surface text-teal shadow-card active:scale-95">
              <Volume2 className="size-5" />
            </button>
          </div>
          <p className="rounded-[14px] bg-inset p-4 text-pretty text-[14px] leading-relaxed text-ink2">
            {PRONUNCIATION.tip}
          </p>
          <div className="flex justify-end pt-1">
            <GradientButton
              size="sm"
              onClick={() => {
                setSaved(true)
                setPron(false)
              }}
            >
              <Bookmark className={cn('size-4', saved && 'fill-current')} />
              {saved ? '已收藏' : '收藏发音'}
            </GradientButton>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({
  children,
  title,
  icon,
  onClose,
}: {
  children: React.ReactNode
  title: string
  icon: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/20 p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-[24px] bg-surface p-6 shadow-float">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[16px] font-bold text-ink">
            {icon}
            {title}
          </h3>
          <button
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full bg-fill text-ink2 transition-colors hover:text-ink"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </div>
  )
}
