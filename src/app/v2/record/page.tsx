'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Mic2, Square, ArrowLeft } from 'lucide-react'
import Button from '@/components/ui-v2/Button'
import Orb from '@/components/Orb'

export default function V2RecordPage() {
  const router = useRouter()
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [recording])

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="min-h-screen bg-bg-base flex flex-col items-center px-6">
      <div className="ambient-light-warm" />

      {/* TopBar */}
      <div className="w-full flex items-center justify-between h-[56px] relative z-10">
        <button
          onClick={() => router.back()}
          className="w-[36px] h-[36px] rounded-full bg-bg-surface shadow-sm flex items-center justify-center"
        >
          <ArrowLeft size={16} className="text-v2-text-secondary" />
        </button>
        <span className="text-[15px] font-bold text-v2-text-primary">录制故事</span>
        <div className="w-[36px]" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center w-full relative z-10 -mt-10">
        <Orb size={180} pulse={recording} />

        {/* Timer */}
        <div className="mt-6 mb-2">
          <span
            className="text-[52px] font-bold tracking-tight text-v2-text-primary"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {fmt(seconds)}
          </span>
        </div>

        <p className="text-[13px] text-v2-text-muted mb-2">
          {recording ? '正在录音...' : seconds > 0 ? '录音已停止' : '准备好就开始吧'}
        </p>
        {recording && (
          <p className="text-[12px] text-v2-text-muted text-center px-8 leading-relaxed">
            建议说 30–60 秒，说得越具体效果越好 ✨
          </p>
        )}

        <div className="mt-10 flex flex-col items-center gap-3 w-full">
          {!recording ? (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => { setRecording(true); setSeconds(0) }}
            >
              <Mic2 size={18} />
              {seconds > 0 ? '继续录音' : '开始录音'}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="lg"
              fullWidth
              onClick={() => setRecording(false)}
            >
              <Square size={16} />
              停止录音
            </Button>
          )}

          {!recording && seconds > 0 && (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => router.push('/v2/article')}
            >
              生成口语文章 →
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
