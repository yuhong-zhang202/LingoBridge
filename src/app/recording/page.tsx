'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, RotateCcw } from 'lucide-react'
import Waveform from '@/components/Waveform'

const PARTICLES = [
  { angle: 3.9,   dist: 0.833, r: 5.5,  color: '#FCDABB' },
  { angle: 11.6,  dist: 0.897, r: 3.5,  color: '#C2DED8' },
  { angle: 19.0,  dist: 0.850, r: 5.0,  color: '#EDF2D3' },
  { angle: 22.7,  dist: 0.750, r: 3.4,  color: '#C6DFD4' },
  { angle: 38.5,  dist: 0.853, r: 3.5,  color: '#C3DED8' },
  { angle: 52.0,  dist: 0.850, r: 3.1,  color: '#FADEC1' },
  { angle: 59.2,  dist: 0.827, r: 3.6,  color: '#EDF2D4' },
  { angle: 68.2,  dist: 0.837, r: 3.0,  color: '#FBDDC0' },
  { angle: 73.2,  dist: 0.713, r: 3.0,  color: '#F9DFC4' },
  { angle: 82.5,  dist: 0.867, r: 3.4,  color: '#C2DFD9' },
  { angle: 89.8,  dist: 0.813, r: 5.5,  color: '#FBDBBC' },
  { angle: 103.7, dist: 0.843, r: 3.5,  color: '#EDF2D4' },
  { angle: 116.4, dist: 0.900, r: 4.0,  color: '#FBDCBD' },
  { angle: 120.8, dist: 0.800, r: 4.8,  color: '#EEF2D8' },
  { angle: 126.9, dist: 0.900, r: 4.1,  color: '#FBDDBF' },
  { angle: 134.8, dist: 0.890, r: 4.9,  color: '#C2DED8' },
  { angle: 155.1, dist: 0.903, r: 3.0,  color: '#FADFC3' },
  { angle: 162.8, dist: 0.890, r: 3.4,  color: '#EEF2D5' },
  { angle: 185.0, dist: 0.923, r: 2.4,  color: '#EEF2D6' },
  { angle: 191.6, dist: 0.913, r: 4.9,  color: '#C4DED7' },
  { angle: 202.0, dist: 0.910, r: 4.0,  color: '#FBDEC3' },
  { angle: 217.0, dist: 0.920, r: 3.4,  color: '#EFF1D5' },
  { angle: 230.0, dist: 0.927, r: 4.1,  color: '#FBDEC3' },
  { angle: 237.1, dist: 0.913, r: 1.8,  color: '#C8E0DA' },
  { angle: 250.7, dist: 0.877, r: 4.9,  color: '#EEF3D6' },
  { angle: 256.2, dist: 0.963, r: 3.0,  color: '#FADDC1' },
  { angle: 262.4, dist: 0.903, r: 3.3,  color: '#C2DED8' },
  { angle: 268.3, dist: 0.777, r: 3.1,  color: '#C8E0D5' },
  { angle: 271.0, dist: 0.950, r: 3.5,  color: '#C2DED8' },
  { angle: 276.7, dist: 0.883, r: 5.5,  color: '#FBDBBB' },
  { angle: 277.2, dist: 1.003, r: 3.0,  color: '#FBDCBE' },
  { angle: 282.3, dist: 0.990, r: 3.4,  color: '#C2DED8' },
  { angle: 285.3, dist: 0.913, r: 3.5,  color: '#EDF2D5' },
  { angle: 287.6, dist: 0.803, r: 4.9,  color: '#EFF3D8' },
  { angle: 293.0, dist: 0.930, r: 3.4,  color: '#C3DED9' },
  { angle: 298.9, dist: 0.857, r: 4.9,  color: '#EEF3D6' },
  { angle: 303.4, dist: 0.983, r: 5.7,  color: '#F0EED0' },
  { angle: 306.5, dist: 0.823, r: 3.1,  color: '#FBDFC3' },
  { angle: 313.5, dist: 0.890, r: 3.5,  color: '#C2DED8' },
  { angle: 327.5, dist: 0.850, r: 3.1,  color: '#FBDEC0' },
  { angle: 336.1, dist: 0.930, r: 3.5,  color: '#C1DDD8' },
  { angle: 349.1, dist: 0.863, r: 2.0,  color: '#EDF2D4' },
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

        {/* 光晕容器：固定 300×300，居中放置 */}
        <div
          className="relative flex-shrink-0"
          style={{ width: 300, height: 300 }}
        >
          {/* ── 光球：4个色块叠加 ── */}

          {/* 绿色 左上 */}
          <div className="absolute rounded-full" style={{
            width:  175 + audioLevel * 18,
            height: 175 + audioLevel * 18,
            left: '50%', top: '50%',
            transform: 'translate(calc(-50% - 28px), calc(-50% - 28px))',
            background: 'radial-gradient(circle, rgba(145,200,122,0.95) 0%, rgba(145,200,122,0) 70%)',
            filter: 'blur(28px)',
            transition: 'width 0.08s ease, height 0.08s ease',
          }} />

          {/* 蓝青 右侧 */}
          <div className="absolute rounded-full" style={{
            width:  155 + audioLevel * 18,
            height: 155 + audioLevel * 18,
            left: '50%', top: '50%',
            transform: 'translate(calc(-50% + 25px), calc(-50% - 5px))',
            background: 'radial-gradient(circle, rgba(112,182,176,0.95) 0%, rgba(112,182,176,0) 70%)',
            filter: 'blur(28px)',
            transition: 'width 0.08s ease, height 0.08s ease',
          }} />

          {/* 橙色 下方 */}
          <div className="absolute rounded-full" style={{
            width:  165 + audioLevel * 18,
            height: 165 + audioLevel * 18,
            left: '50%', top: '50%',
            transform: 'translate(calc(-50% - 5px), calc(-50% + 33px))',
            background: 'radial-gradient(circle, rgba(248,168,118,0.95) 0%, rgba(248,168,118,0) 70%)',
            filter: 'blur(28px)',
            transition: 'width 0.08s ease, height 0.08s ease',
          }} />

          {/* 黄绿 左侧 */}
          <div className="absolute rounded-full" style={{
            width:  130 + audioLevel * 18,
            height: 130 + audioLevel * 18,
            left: '50%', top: '50%',
            transform: 'translate(calc(-50% - 31px), calc(-50% + 5px))',
            background: 'radial-gradient(circle, rgba(210,226,168,0.80) 0%, rgba(210,226,168,0) 70%)',
            filter: 'blur(28px)',
            transition: 'width 0.08s ease, height 0.08s ease',
          }} />

          {/* ── 粒子层：42个，随音量扩散 ── */}
          {PARTICLES.map((p, i) => {
            const rad = (p.angle - 90) * Math.PI / 180
            const baseDist = p.dist * 145
            const dist = baseDist + audioLevel * 10
            const px = 150 + dist * Math.cos(rad)
            const py = 150 + dist * Math.sin(rad)
            const radius = p.r * (1 + audioLevel * 0.12)
            return (
              <div
                key={i}
                className="absolute rounded-full"
                style={{
                  width:  radius * 2,
                  height: radius * 2,
                  left:   px - radius,
                  top:    py - radius,
                  backgroundColor: p.color,
                  opacity: 0.88 + audioLevel * 0.12,
                  transition: 'all 0.08s ease',
                  pointerEvents: 'none',
                }}
              />
            )
          })}
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
