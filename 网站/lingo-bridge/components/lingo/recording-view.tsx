'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X, Square, ArrowRight } from 'lucide-react'
import { Orb } from './orb'
import { Waveform } from './waveform'
import { GradientButton, Tag } from './primitives'

const TRANSCRIPT_CHUNKS = [
  '上周末我朋友心情特别不好，',
  '因为她工作上遇到了一些挫折。',
  '我就约她出来喝咖啡，',
  '陪她聊了一下午，',
  '听她把烦恼都讲出来……',
]

function fmt(s: number) {
  const m = Math.floor(s / 60)
    .toString()
    .padStart(2, '0')
  const ss = (s % 60).toString().padStart(2, '0')
  return `${m}:${ss}`
}

export function RecordingView() {
  const [seconds, setSeconds] = useState(0)
  const [recording, setRecording] = useState(true)
  const [chunks, setChunks] = useState(1)

  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [recording])

  useEffect(() => {
    if (!recording) return
    const id = setInterval(
      () => setChunks((c) => Math.min(TRANSCRIPT_CHUNKS.length, c + 1)),
      2200,
    )
    return () => clearInterval(id)
  }, [recording])

  return (
    <div className="relative flex min-h-svh flex-col items-center px-6 py-8">
      {/* top: exit only, no main nav */}
      <div className="flex w-full max-w-3xl items-center justify-between">
        <Tag variant="green">{recording ? '正在聆听' : '已暂停'}</Tag>
        <Link
          href="/"
          className="grid size-10 place-items-center rounded-full border border-border bg-surface text-ink2 transition-colors hover:text-ink"
          aria-label="退出录音"
        >
          <X className="size-5" />
        </Link>
      </div>

      {/* orb */}
      <div className="mt-8 flex flex-col items-center lg:mt-12">
        <Orb size={340} level={recording ? 0.7 : 0} active={recording} />
        <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-ink">{fmt(seconds)}</p>
        <p className="mt-1 text-sm text-ink2">用中文慢慢讲，不用着急，也不用完整</p>
      </div>

      {/* waveform */}
      <Waveform active={recording} className="mt-6 w-full max-w-xl" />

      {/* live transcript */}
      <div className="mt-6 w-full max-w-2xl">
        <div className="rounded-[16px] border border-border bg-surface/80 p-5 shadow-card backdrop-blur-sm">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-ink3">实时转写</p>
          <p className="min-h-20 text-pretty text-[16px] leading-relaxed text-ink">
            {TRANSCRIPT_CHUNKS.slice(0, chunks).join('')}
            {recording && <span className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-brand align-middle" />}
          </p>
        </div>
      </div>

      {/* controls */}
      <div className="mt-8 flex items-center gap-4">
        {recording ? (
          <button
            onClick={() => setRecording(false)}
            className="grid size-20 place-items-center rounded-full bg-error text-surface shadow-float transition-transform active:scale-95"
            aria-label="停止录音"
          >
            <Square className="size-7 fill-current" />
          </button>
        ) : (
          <Link href="/restructure">
            <GradientButton size="lg">
              整理这段故事
              <ArrowRight className="size-4" />
            </GradientButton>
          </Link>
        )}
      </div>
    </div>
  )
}
