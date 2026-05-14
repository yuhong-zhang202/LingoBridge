'use client'
import Link from 'next/link'
import { Mic2 } from 'lucide-react'
import Orb from '@/components/Orb'
import Waveform from '@/components/Waveform'
import TabBar from '@/components/TabBar'

export default function HomePage() {
  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col pb-[56px]">
      <div className="ambient-light" />

      {/* 顶部栏 */}
      <div className="flex items-center justify-between h-[52px] px-5 relative z-10">
        <span className="text-[16px] font-bold text-[#111]">
          LingoBridge
        </span>
        <div className="w-[30px] h-[30px] rounded-full bg-white shadow-sm" />
      </div>

      {/* 主体 */}
      <div className="flex-1 flex flex-col items-center px-7 relative z-10 pt-6">

        {/* 光晕球 */}
        <Orb size={190} pulse={false} className="mt-4" />

        {/* 波形 + 提示 */}
        <div className="flex flex-col items-center gap-2 mt-5">
          <Waveform active={false} />
          <span className="text-[12px] text-[#BBBBBB] italic">
            说说看...
          </span>
        </div>

        {/* 标题 */}
        <div className="text-center mt-8">
          <h1 className="text-[24px] font-bold text-[#111] tracking-tight">
            说说你的故事
          </h1>
          <p className="text-[13px] text-[#888] mt-2">
            AI 帮你变成雅思口语素材
          </p>
        </div>

        {/* 操作区 */}
        <div className="w-full mt-9">

          {/* 主按钮：开始录音 */}
          <Link href="/recording" className="block">
            <button className="btn-gradient w-full h-[50px]">
              <Mic2 size={16} className="text-[#555]" />
              开始录音
            </button>
          </Link>

          {/* 文字链接 */}
          <Link href="/article">
            <p className="text-center text-[13px] text-[#AAAAAA] mt-4 cursor-pointer">
              或用文字输入
            </p>
          </Link>

          {/* Dev: v2 对比入口 */}
          <Link href="/v2">
            <p className="text-center text-[11px] text-[#CCCCCC] mt-8 cursor-pointer border border-dashed border-[#E5E5E5] rounded-full px-4 py-1.5">
              ✦ 体验 v2.0 新版设计
            </p>
          </Link>
        </div>
      </div>

      <TabBar />
    </div>
  )
}
