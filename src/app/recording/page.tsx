/**
 * @module   RecordingPage
 * @desc     录音页 — 真实采集音频，完成后调 Whisper 转写并进入整理流程
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { X, RotateCcw } from 'lucide-react'
import Waveform from '@/components/Waveform'
import Orb from '@/components/Orb'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'

export default function RecordingPage() {
  const router = useRouter()
  const [seconds, setSeconds] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { audioLevel, start, stop } = useAudioRecorder()

  // 计时（转写时暂停）
  useEffect(() => {
    if (transcribing) return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [transcribing])

  // 进页面即开始录音
  useEffect(() => { void start() }, [start])

  const handleFinish = useCallback(async () => {
    setError(null)
    setTranscribing(true)
    try {
      const blob = await stop()
      if (!blob) throw new Error('没有录到声音，请重试')
      if (blob.size > 10 * 1024 * 1024) throw new Error('录音过长，请分段录制') // ENGINEERING §9
      const form = new FormData()
      form.append('audio', blob, 'recording.webm')
      const res = await fetch('/api/transcribe', { method: 'POST', body: form })
      if (!res.ok) throw new Error('转写失败，请重试')
      const data = (await res.json()) as { text: string }
      router.push(`/restructure?rawText=${encodeURIComponent(data.text)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '转写失败，请重试')
      setTranscribing(false)
    }
  }, [stop, router])

  const handleRerecord = useCallback(async () => {
    await stop()
    setSeconds(0)
    setError(null)
    void start()
  }, [stop, start])

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      <div className="ambient-light" />

      {/* 顶部栏 */}
      <div className="flex-shrink-0 flex items-center justify-between h-[52px] px-5 relative z-10">
        <button
          onClick={() => router.back()}
          className="w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center"
        >
          <X size={14} className="text-[#333]" />
        </button>
        <span className="text-[15px] font-semibold text-[#111]">{transcribing ? '转写中' : '正在录音'}</span>
        <div className="w-[30px]" />
      </div>

      {/* 中心内容 */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-7 relative z-10 gap-4 py-4">

        <Orb size={260} audioLevel={transcribing ? 0 : audioLevel} pulse={transcribing} />

        {!transcribing ? (
          <>
            <div className="flex flex-col items-center gap-2.5">
              <Waveform active />
              <span className="text-[13px] text-[#888] italic">listening...</span>
            </div>

            <div className="surface px-4 py-3 max-w-[260px] text-center">
              <p className="text-[13px] text-[#444] leading-relaxed">
                正在聆听，说完点下方「完成录音」自动转写
              </p>
            </div>

            <span className="text-[22px] font-semibold text-[#111] tracking-[2px]">{fmt(seconds)}</span>

            <p className="text-[12px] text-[#CCCCCC] text-center px-8 leading-relaxed">
              建议说 30–60 秒，说得越具体效果越好 ✨
            </p>
          </>
        ) : (
          <p className="text-[13px] text-v2-text-muted">正在转写你的录音…</p>
        )}
      </div>

      {/* 底部控制 */}
      <div
        className="flex-shrink-0 px-8 relative z-10"
        style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom))', paddingTop: 20 }}
      >
        {error && <p className="text-center text-[12px] text-v2-text-muted mb-2">{error}</p>}
        <button
          onClick={handleFinish}
          disabled={transcribing}
          className="btn-gradient w-full h-[56px] text-[16px] font-semibold disabled:opacity-60"
        >
          <div className="w-[15px] h-[15px] bg-[#555] rounded-[3px]" />
          {transcribing ? '转写中…' : '完成录音'}
        </button>
        <div className="flex justify-center mt-3">
          <button
            onClick={handleRerecord}
            disabled={transcribing}
            className="flex items-center gap-1.5 text-[12px] font-medium text-[#AAAAAA] disabled:opacity-50"
          >
            <RotateCcw size={15} />
            重录
          </button>
        </div>
      </div>
    </div>
  )
}
