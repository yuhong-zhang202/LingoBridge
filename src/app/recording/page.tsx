'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, RotateCcw, CheckCircle } from 'lucide-react'
import Orb from '@/components/Orb'
import Waveform from '@/components/Waveform'

export default function RecordingPage() {
  const router = useRouter()
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
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
        <span className="text-[15px] font-semibold text-[#111]">
          正在录音
        </span>
        <div className="w-[30px]" />
      </div>

      {/* 中心内容 */}
      <div className="flex-1 flex flex-col items-center justify-center px-7 relative z-10 gap-6">
        <Orb size={250} pulse />

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
        className="flex items-center justify-between px-8 relative z-10"
        style={{
          paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
          paddingTop: 20,
        }}
      >
        <button className="flex items-center gap-1.5 text-[12px] font-medium text-[#AAAAAA]">
          <RotateCcw size={15} />
          重录
        </button>

        {/* 停止按钮 */}
        <button
          onClick={() => router.push('/article')}
          className="btn-gradient-circle"
          style={{ width: 64, height: 64 }}
        >
          <div className="w-[18px] h-[18px] rounded-[4px] bg-[#333]" />
        </button>

        <button
          onClick={() => router.push('/article')}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-[#333]"
        >
          <CheckCircle size={15} />
          完成
        </button>
      </div>
    </div>
  )
}
