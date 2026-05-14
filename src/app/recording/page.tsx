'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, RotateCcw } from 'lucide-react'
import Waveform from '@/components/Waveform'
import Orb from '@/components/Orb'

export default function RecordingPage() {
  const router = useRouter()
  const [seconds, setSeconds] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)
  const animFrameRef = useRef<number>()

  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let stream: MediaStream | null = null
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        src.connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          analyser.getByteFrequencyData(data)
          const avg = data.reduce((a, b) => a + b, 0) / data.length
          setAudioLevel(avg / 255)
          animFrameRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // 无麦克风权限时静默处理
      }
    }
    start()
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <div className="ambient-light" />

      {/* 顶部栏 */}
      <div className="flex items-center justify-between h-[52px] px-5 relative z-10">
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
      <div className="flex-1 flex flex-col items-center justify-center px-7 relative z-10 gap-6">

        <Orb size={300} audioLevel={audioLevel} />

        <div className="flex flex-col items-center gap-2.5">
          <Waveform active />
          <span className="text-[13px] text-[#888] italic">listening...</span>
        </div>

        {/* 实时转写预览 */}
        <div className="surface px-4 py-3 max-w-[260px] text-center">
          <p className="text-[13px] text-[#444] leading-relaxed">
            我今天去了一个公园...
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
        className="px-8 relative z-10"
        style={{
          paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
          paddingTop: 20,
        }}
      >
        <div className="flex justify-start mb-4">
          <button className="flex items-center gap-1.5 text-[12px] font-medium text-[#AAAAAA]">
            <RotateCcw size={15} />
            重录
          </button>
        </div>

        <button
          onClick={() => router.push('/article')}
          className="btn-gradient w-full h-[56px] text-[16px] font-semibold"
        >
          <div className="w-[15px] h-[15px] bg-[#555] rounded-[3px]" />
          完成录音
        </button>
      </div>
    </div>
  )
}
