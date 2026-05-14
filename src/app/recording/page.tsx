'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, RotateCcw } from 'lucide-react'
import Waveform from '@/components/Waveform'

export default function RecordingPage() {
  const router = useRouter()
  const [seconds, setSeconds] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)
  const animFrameRef = useRef<number>()
  const analyserRef = useRef<AnalyserNode>()

  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let stream: MediaStream

    const startAudioAnalysis = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const audioCtx = new AudioContext()
        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyserRef.current = analyser

        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          analyser.getByteFrequencyData(dataArray)
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
          setAudioLevel(avg / 255)
          animFrameRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // mic not available — fall back to static glow
      }
    }

    startAudioAnalysis()
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const glowScale = 1 + audioLevel * 0.25
  const glowOpacity = 0.7 + audioLevel * 0.3

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
        <span className="text-[15px] font-semibold text-[#111]">
          正在录音
        </span>
        <div className="w-[30px]" />
      </div>

      {/* 中心内容 */}
      <div className="flex-1 flex flex-col items-center justify-center px-7 relative z-10 gap-6">

        {/* 动态音量光晕球 */}
        <div className="relative flex items-center justify-center" style={{ width: 250, height: 250 }}>
          {/* 外层光晕 — 随音量缩放 */}
          <div
            className="absolute rounded-full"
            style={{
              width: 250,
              height: 250,
              background: 'radial-gradient(circle, rgba(200,221,217,0.55) 0%, rgba(232,201,168,0.35) 45%, transparent 72%)',
              filter: 'blur(28px)',
              transform: `scale(${glowScale})`,
              opacity: glowOpacity,
              transition: 'transform 75ms linear, opacity 75ms linear',
            }}
          />
          {/* 核心球 — 固定大小，渐变色 */}
          <div
            className="relative rounded-full z-10"
            style={{
              width: 160,
              height: 160,
              background: 'radial-gradient(circle at 38% 38%, rgba(200,221,217,0.90) 0%, rgba(232,201,168,0.70) 55%, rgba(188,210,168,0.50) 100%)',
              boxShadow: '0 8px 32px rgba(200,221,217,0.30)',
            }}
          />
        </div>

        <div className="flex flex-col items-center gap-2.5">
          <Waveform active />
          <span className="text-[13px] text-[#888] italic">
            listening...
          </span>
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

        {/* 引导提示 */}
        <p className="text-[12px] text-[#CCCCCC] text-center mt-2 px-8 leading-relaxed">
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
          className="w-full h-[56px] border border-[#D4875A] rounded-[50px] flex items-center justify-center gap-2 text-[#D4875A] text-[17px] font-medium active:opacity-75 transition-opacity"
        >
          <div className="w-[16px] h-[16px] bg-[#D4875A] rounded-[3px]" />
          完成录音
        </button>
      </div>
    </div>
  )
}
