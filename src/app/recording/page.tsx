'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, RotateCcw } from 'lucide-react'
import Waveform from '@/components/Waveform'

const DOTS = [
  { top: '8%',  left: '48%', size: 12, color: '#c6d7c8' },
  { top: '10%', left: '60%', size: 8,  color: '#d6d9c5' },
  { top: '12%', left: '38%', size: 6,  color: '#f3c7a7' },
  { top: '15%', left: '68%', size: 10, color: '#c8d9d8' },
  { top: '18%', left: '27%', size: 14, color: '#dce2c7' },
  { top: '22%', left: '78%', size: 12, color: '#b9d6d4' },
  { top: '28%', left: '18%', size: 10, color: '#f5d0b4' },
  { top: '35%', left: '12%', size: 16, color: '#d8e3ca' },
  { top: '45%', left: '10%', size: 12, color: '#c9dddd' },
  { top: '58%', left: '12%', size: 9,  color: '#f4cfbb' },
  { top: '70%', left: '18%', size: 11, color: '#dfe6cb' },
  { top: '80%', left: '28%', size: 13, color: '#c3d8d7' },
  { top: '88%', left: '42%', size: 15, color: '#b7d1d3' },
  { top: '90%', left: '58%', size: 10, color: '#dce1c8' },
  { top: '84%', left: '72%', size: 14, color: '#f2c7ab' },
  { top: '72%', left: '84%', size: 18, color: '#c4d7d8' },
  { top: '58%', left: '88%', size: 8,  color: '#f5c8ae' },
  { top: '45%', left: '90%', size: 16, color: '#f3d0b5' },
  { top: '30%', left: '85%', size: 11, color: '#dce5cb' },
  { top: '18%', left: '78%', size: 13, color: '#c6dada' },
]

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

    const startAnalysis = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const audioCtx = new AudioContext()
        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)

        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          analyser.getByteFrequencyData(dataArray)
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
          setAudioLevel(avg / 255)
          animFrameRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // no mic — static glow
      }
    }

    startAnalysis()
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // subtle scale pulse driven by audio
  const orbScale = 1 + audioLevel * 0.08

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

        {/* 光晕 */}
        <div
          className="relative w-[250px] h-[250px] flex items-center justify-center"
          style={{
            transform: `scale(${orbScale})`,
            transition: 'transform 0.1s ease',
          }}
        >
          {/* 外围浮动圆点 */}
          {DOTS.map((dot, i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                top: dot.top,
                left: dot.left,
                width: dot.size,
                height: dot.size,
                background: dot.color,
                opacity: 0.9 + audioLevel * 0.1,
                filter: 'blur(0.4px)',
              }}
            />
          ))}

          {/* 主光球 */}
          <div className="relative w-[170px] h-[170px]">
            {/* 左侧绿 */}
            <div
              className="absolute left-[8px] top-[18px] w-[90px] h-[120px] rounded-full"
              style={{ background: 'rgba(210,224,148,0.95)', filter: 'blur(32px)' }}
            />
            {/* 底部暖橙 */}
            <div
              className="absolute left-[28px] bottom-[6px] w-[95px] h-[72px] rounded-full"
              style={{ background: 'rgba(248,199,150,0.95)', filter: 'blur(30px)' }}
            />
            {/* 右侧蓝青 */}
            <div
              className="absolute right-[10px] top-[40px] w-[62px] h-[105px] rounded-full"
              style={{ background: 'rgba(164,219,235,0.95)', filter: 'blur(28px)' }}
            />
            {/* 顶部亮绿 */}
            <div
              className="absolute top-[0px] left-[78px] w-[58px] h-[55px] rounded-full"
              style={{ background: 'rgba(182,218,118,0.95)', filter: 'blur(26px)' }}
            />
            {/* 白色雾化层 */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.72) 70%, rgba(255,255,255,0.95) 100%)',
                filter: 'blur(12px)',
              }}
            />
          </div>
        </div>

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

        {/* 引导提示 */}
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
          className="w-full h-[56px] border border-[#D4875A] rounded-[50px] flex items-center justify-center gap-2 text-[#D4875A] text-[17px] font-medium active:opacity-75 transition-opacity"
        >
          <div className="w-[16px] h-[16px] bg-[#D4875A] rounded-[3px]" />
          完成录音
        </button>
      </div>
    </div>
  )
}
