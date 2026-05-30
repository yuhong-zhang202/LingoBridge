/**
 * @module   RecordingPage
 * @desc     录音页 — 实时采集音频并可视化，完成后进入文章生成流程
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, RotateCcw } from 'lucide-react'
import Waveform from '@/components/Waveform'
import Orb from '@/components/Orb'
import { useRecording } from '@/hooks/useRecording'

export default function RecordingPage() {
  const router = useRouter()
  const [seconds, setSeconds] = useState(0)
  const { audioLevel, handlePressStart, cancelLongPress } = useRecording()

  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Start audio analysis immediately on mount; clean up on unmount
  useEffect(() => {
    handlePressStart()
    return () => cancelLongPress()
  }, [handlePressStart, cancelLongPress])

  const transcribedText = '我今天去了一个公园...'

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
        <span className="text-[15px] font-semibold text-[#111]">正在录音</span>
        <div className="w-[30px]" />
      </div>

      {/* 中心内容 */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-7 relative z-10 gap-4 py-4">

        <Orb size={260} audioLevel={audioLevel} />

        <div className="flex flex-col items-center gap-2.5">
          <Waveform active />
          <span className="text-[13px] text-[#888] italic">listening...</span>
        </div>

        {/* 实时转写预览 */}
        <div className="surface px-4 py-3 max-w-[260px] text-center">
          <p className="text-[13px] text-[#444] leading-relaxed">
            {transcribedText}
          </p>
        </div>

        {/* 计时器 */}
        <span className="text-[22px] font-semibold text-[#111] tracking-[2px]">
          {fmt(seconds)}
        </span>

        <p className="text-[12px] text-[#CCCCCC] text-center px-8 leading-relaxed">
          建议说 30–60 秒，说得越具体效果越好 ✨
        </p>
      </div>

      {/* 底部控制 */}
      <div
        className="flex-shrink-0 px-8 relative z-10"
        style={{
          paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
          paddingTop: 20,
        }}
      >
        <button
          onClick={() => router.push(`/restructure?rawText=${encodeURIComponent(transcribedText)}`)}
          className="btn-gradient w-full h-[56px] text-[16px] font-semibold"
        >
          <div className="w-[15px] h-[15px] bg-[#555] rounded-[3px]" />
          完成录音
        </button>
        <div className="flex justify-center mt-3">
          <button className="flex items-center gap-1.5 text-[12px] font-medium text-[#AAAAAA]">
            <RotateCcw size={15} />
            重录
          </button>
        </div>
      </div>
    </div>
  )
}
