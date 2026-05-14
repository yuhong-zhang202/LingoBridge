'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, RotateCcw } from 'lucide-react'
import Waveform from '@/components/Waveform'

const PARTICLES: { angle: number; baseDist: number; size: number; color: string }[] = [
  { angle: 0,   baseDist: 118, size: 8,  color: '#D4875A' },
  { angle: 12,  baseDist: 122, size: 5,  color: '#7BA699' },
  { angle: 25,  baseDist: 115, size: 10, color: '#E8C9A8' },
  { angle: 38,  baseDist: 120, size: 6,  color: '#D4875A' },
  { angle: 50,  baseDist: 118, size: 4,  color: '#A8C8C0' },
  { angle: 62,  baseDist: 124, size: 9,  color: '#7BA699' },
  { angle: 75,  baseDist: 116, size: 5,  color: '#D4875A' },
  { angle: 88,  baseDist: 120, size: 12, color: '#E8C9A8' },
  { angle: 100, baseDist: 118, size: 6,  color: '#7BA699' },
  { angle: 112, baseDist: 115, size: 4,  color: '#D4875A' },
  { angle: 124, baseDist: 122, size: 8,  color: '#A8C8C0' },
  { angle: 136, baseDist: 118, size: 5,  color: '#E8C9A8' },
  { angle: 148, baseDist: 120, size: 10, color: '#7BA699' },
  { angle: 160, baseDist: 116, size: 6,  color: '#D4875A' },
  { angle: 172, baseDist: 124, size: 4,  color: '#A8C8C0' },
  { angle: 184, baseDist: 118, size: 9,  color: '#7BA699' },
  { angle: 196, baseDist: 120, size: 5,  color: '#D4875A' },
  { angle: 208, baseDist: 115, size: 7,  color: '#E8C9A8' },
  { angle: 220, baseDist: 122, size: 4,  color: '#7BA699' },
  { angle: 232, baseDist: 118, size: 11, color: '#D4875A' },
  { angle: 244, baseDist: 120, size: 6,  color: '#A8C8C0' },
  { angle: 256, baseDist: 116, size: 5,  color: '#E8C9A8' },
  { angle: 268, baseDist: 124, size: 8,  color: '#7BA699' },
  { angle: 280, baseDist: 118, size: 4,  color: '#D4875A' },
  { angle: 292, baseDist: 120, size: 10, color: '#A8C8C0' },
  { angle: 304, baseDist: 115, size: 6,  color: '#7BA699' },
  { angle: 316, baseDist: 122, size: 5,  color: '#D4875A' },
  { angle: 328, baseDist: 118, size: 9,  color: '#E8C9A8' },
  { angle: 340, baseDist: 120, size: 4,  color: '#7BA699' },
  { angle: 352, baseDist: 116, size: 7,  color: '#D4875A' },
]

export default function RecordingPage() {
  const router = useRouter()
  const [seconds, setSeconds] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)
  const [orbRotation, setOrbRotation] = useState(0)
  const animFrameRef = useRef<number>()
  const rotationRef = useRef(0)

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
          rotationRef.current += 0.3 + (avg / 255) * 0.8
          setOrbRotation(rotationRef.current)
          animFrameRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // no mic — rotation only
        const tick = () => {
          rotationRef.current += 0.3
          setOrbRotation(rotationRef.current)
          animFrameRef.current = requestAnimationFrame(tick)
        }
        tick()
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

  const ORB_BASE = 160
  const orbSize = ORB_BASE + audioLevel * 24
  const particleExpand = audioLevel * 12

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

        {/* 光球 + 粒子环 */}
        <div className="relative flex items-center justify-center" style={{ width: 260, height: 260 }}>

          {/* 外围粒子 */}
          {PARTICLES.map((p, i) => {
            const rad = ((p.angle - 90) * Math.PI) / 180
            const dist = p.baseDist + particleExpand
            const cx = 130 + dist * Math.cos(rad)
            const cy = 130 + dist * Math.sin(rad)
            return (
              <div
                key={i}
                className="absolute rounded-full"
                style={{
                  width: p.size,
                  height: p.size,
                  backgroundColor: p.color,
                  left: cx - p.size / 2,
                  top: cy - p.size / 2,
                  opacity: 0.75 + audioLevel * 0.25,
                  transform: `scale(${1 + audioLevel * 0.3})`,
                  transition: 'transform 0.1s ease, opacity 0.1s ease',
                }}
              />
            )
          })}

          {/* 中央 conic-gradient 光球 */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: orbSize,
              height: orbSize,
              borderRadius: '50%',
              background: `conic-gradient(
                from ${orbRotation}deg,
                #7BA699 0deg,
                #C8DDD9 60deg,
                #E8C9A8 120deg,
                #D4875A 180deg,
                #E8C9A8 240deg,
                #A8C8C0 300deg,
                #7BA699 360deg
              )`,
              filter: 'blur(18px)',
              opacity: 0.88 + audioLevel * 0.12,
              boxShadow: `0 0 ${40 + audioLevel * 30}px rgba(123,166,153,${0.2 + audioLevel * 0.25})`,
              transition: 'width 0.08s ease, height 0.08s ease, opacity 0.08s ease',
            }}
          />

          {/* 内层中心高亮 */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '45%',
              transform: 'translate(-50%, -50%)',
              width: orbSize * 0.45,
              height: orbSize * 0.45,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(240,220,200,0.9) 0%, transparent 70%)',
              filter: 'blur(8px)',
              opacity: 0.6 + audioLevel * 0.3,
              pointerEvents: 'none',
              transition: 'opacity 0.08s ease',
            }}
          />
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
