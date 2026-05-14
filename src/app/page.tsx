'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mic2 } from 'lucide-react'
import Orb from '@/components/Orb'
import Waveform from '@/components/Waveform'
import TabBar from '@/components/TabBar'

export default function HomePage() {
  const router = useRouter()
  const [showTextInput, setShowTextInput] = useState(false)
  const [textStory, setTextStory] = useState('')

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
        <Orb size={200} pulse={false} className="mt-4" />

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

          {!showTextInput && (
            <>
              {/* 主按钮：开始录音 */}
              <Link href="/recording" className="block">
                <button className="btn-gradient w-full h-[50px]">
                  <Mic2 size={16} className="text-[#555]" />
                  开始录音
                </button>
              </Link>

              {/* 文字输入入口 */}
              <button
                onClick={() => setShowTextInput(true)}
                className="w-full text-center text-[13px] text-[#AAAAAA] mt-4 cursor-pointer"
              >
                或用文字输入
              </button>
            </>
          )}

          {showTextInput && (
            <div className="w-full animate-fade-up">
              <textarea
                value={textStory}
                onChange={e => setTextStory(e.target.value)}
                placeholder="用中文写下你的故事，比如：今天去了附近的公园，空气很好，心情也轻松了很多..."
                className="w-full min-h-[120px] p-4 rounded-[16px] bg-white border border-[#EEEEEE] text-[15px] text-[#1A1A1A] leading-relaxed placeholder:text-[#CCCCCC] resize-none outline-none shadow-sm focus:border-[#D4875A] transition-colors"
                autoFocus
              />
              <div className="flex justify-between items-center mt-2 px-1">
                <span className="text-[12px] text-[#CCCCCC]">
                  {textStory.length > 0 ? `${textStory.length} 字` : '建议 50 字以上，越具体越好'}
                </span>
                <button
                  disabled={textStory.trim().length < 10}
                  onClick={() => router.push('/article')}
                  className={`px-5 py-2 rounded-[50px] text-[14px] font-medium transition-all duration-200 ${
                    textStory.trim().length >= 10
                      ? 'bg-[#D4875A] text-white'
                      : 'bg-[#EEEEEE] text-[#CCCCCC] cursor-not-allowed'
                  }`}
                >
                  开始生成 →
                </button>
              </div>
              <button
                onClick={() => setShowTextInput(false)}
                className="mt-3 text-[13px] text-[#AAAAAA] flex items-center gap-1 mx-auto"
              >
                ← 改用录音
              </button>
            </div>
          )}
        </div>
      </div>

      <TabBar />
    </div>
  )
}
