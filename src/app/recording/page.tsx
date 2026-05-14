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

        {/* 动态音量光球 + 环绕小圆点 */}
        <div className="relative flex items-center justify-center" style={{ width: 220, height: 220 }}>
          {/* 外围环绕小圆点 */}
          {([
            { angle: 0,   dist: 105, size: 8,  color: '#D4875A' },
            { angle: 20,  dist: 110, size: 6,  color: '#7BA699' },
            { angle: 40,  dist: 108, size: 10, color: '#E8C9A8' },
            { angle: 60,  dist: 105, size: 7,  color: '#7BA699' },
            { angle: 80,  dist: 112, size: 5,  color: '#D4875A' },
            { angle: 100, dist: 108, size: 9,  color: '#C8DDD9' },
            { angle: 120, dist: 105, size: 6,  color: '#D4875A' },
            { angle: 140, dist: 110, size: 8,  color: '#7BA699' },
            { angle: 160, dist: 107, size: 5,  color: '#E8C9A8' },
            { angle: 180, dist: 105, size: 10, color: '#D4875A' },
            { angle: 200, dist: 112, size: 6,  color: '#7BA699' },
            { angle: 220, dist: 108, size: 8,  color: '#C8DDD9' },
            { angle: 240, dist: 105, size: 5,  color: '#D4875A' },
            { angle: 260, dist: 110, size: 9,  color: '#7BA699' },
            { angle: 280, dist: 107, size: 6,  color: '#E8C9A8' },
            { angle: 300, dist: 105, size: 8,  color: '#D4875A' },
            { angle: 320, dist: 112, size: 5,  color: '#7BA699' },
            { angle: 340, dist: 108, size: 7,  color: '#C8DDD9' },
          ] as { angle: number; dist: number; size: number; color: string }[]).map((dot, i) => {
            const rad = (dot.angle * Math.PI) / 180
            const x = 110 + dot.dist * Math.cos(rad) - dot.size / 2
            const y = 110 + dot.dist * Math.sin(rad) - dot.size / 2
            return (
              <div
                key={i}
                className="absolute rounded-full"
                style={{ width: dot.size, height: dot.size, backgroundColor: dot.color, left: x, top: y, opacity: 0.7 }}
              />
            )
          })}

          {/* 中央实体光球（随音量 scale 波动） */}
          <div
            style={{
              width: 160,
              height: 160,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 40% 35%, #E8C9A8 0%, #C8DDD9 40%, #7BA699 70%, #D4875A 100%)',
              transform: `scale(${1 + audioLevel * 0.2})`,
              opacity: 0.85 + audioLevel * 0.15,
              boxShadow: `0 0 ${30 + audioLevel * 30}px rgba(212,135,90,${0.15 + audioLevel * 0.2})`,
              filter: 'blur(2px)',
              transition: 'transform 75ms linear, opacity 75ms linear, box-shadow 75ms linear',
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
