'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mic2, ChevronLeft, ChevronRight } from 'lucide-react'
import Orb from '@/components/Orb'
import TabBar from '@/components/TabBar'
import { QUESTIONS } from '@/data/questions'

function randomQuestion() {
  return QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)]
}

export default function HomePage() {
  const router = useRouter()
  const [showTextInput, setShowTextInput] = useState(false)
  const [textStory, setTextStory] = useState('')
  const [ieltsMode, setIeltsMode] = useState(false)
  const [question, setQuestion] = useState(() => randomQuestion())

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      <div className="ambient-light" />

      {/* 顶部栏 */}
      <div className="flex items-center justify-between h-[52px] px-5 relative z-10">
        <span className="text-[16px] font-bold text-[#111]">
          LingoBridge
        </span>
        <div className="w-[30px] h-[30px] rounded-full bg-white shadow-sm" />
      </div>

      {/* 主体 */}
      <div className="flex-1 flex flex-col items-center px-7 relative z-10 pt-6 pb-[72px] overflow-y-auto">

        {/* Orb */}
        <Orb size={300} pulse={false} />

        {/* Orb 与文字区固定间距 */}
        <div className="h-[41px]" />

        {/* 文字 + 操作区 */}
        <div className="w-full flex flex-col items-center">

          {!showTextInput && (
            <div className="text-center w-full">
              {/* 左右箭头切换控件，始终显示在标题上方 */}
              <div className="flex items-center justify-center gap-3 mb-3">
                <button
                  onClick={() => setIeltsMode(false)}
                  className="w-[26px] h-[26px] rounded-full bg-white shadow-sm flex items-center justify-center active:scale-[0.93] transition-all duration-150"
                  style={{ border: '1px solid rgba(0,0,0,0.07)', opacity: ieltsMode ? 1 : 0.28 }}
                  aria-label="返回故事模式"
                >
                  <ChevronLeft size={14} color="#A89990" />
                </button>
                <button
                  onClick={() => { setQuestion(randomQuestion()); setIeltsMode(true) }}
                  className="w-[26px] h-[26px] rounded-full bg-white shadow-sm flex items-center justify-center active:scale-[0.93] transition-all duration-150"
                  style={{ border: '1px solid rgba(0,0,0,0.07)', opacity: ieltsMode ? 0.28 : 1 }}
                  aria-label="切换雅思题目"
                >
                  <ChevronRight size={14} color="#A89990" />
                </button>
              </div>

              {!ieltsMode ? (
                <>
                  <h1 className="text-[20px] font-bold text-[#111] tracking-tight">
                    说说你的故事
                  </h1>
                  <p className="text-[13px] text-[#888] mt-2">
                    精准匹配雅思口语题目
                  </p>
                </>
              ) : (
                <>
                  <h1 className="w-full text-center text-[20px] font-bold text-[#111] tracking-tight leading-snug pl-6">
                    {question.zh}
                  </h1>
                  <p className="text-[13px] text-[#888] mt-2">
                    聊聊你的看法
                  </p>
                </>
              )}
            </div>
          )}

          {/* 操作区 */}
          <div className={`w-full ${showTextInput ? 'mt-0' : 'mt-4'}`}>

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
                  className="w-full text-center text-[13px] text-[#AAAAAA] mt-3 cursor-pointer"
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
                  className="w-full min-h-[120px] p-4 rounded-[16px] bg-white border border-[#EEEEEE] text-[15px] text-[#1A1A1A] leading-relaxed placeholder:text-[#CCCCCC] resize-none outline-none shadow-sm focus:border-brand-primary transition-colors"
                  autoFocus
                />
                <div className="flex justify-between items-center mt-2 px-1">
                  <span className="text-[12px] text-[#CCCCCC]">
                    {textStory.length > 0 ? `${textStory.length} 字` : '建议 50 字以上，越具体越好'}
                  </span>
                  <button
                    disabled={textStory.trim().length < 10}
                    onClick={() => router.push('/article')}
                    className={`px-5 py-2 text-[14px] font-medium transition-all duration-200 ${
                      textStory.trim().length >= 10
                        ? 'btn-gradient'
                        : 'rounded-[50px] bg-[#EEEEEE] text-[#CCCCCC] cursor-not-allowed'
                    }`}
                  >
                    开始匹配 →
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

        {/* 剩余空白沉到底部 */}
        <div className="flex-1" />
      </div>{/* end 主体 */}

      <div className="flex-shrink-0"><TabBar /></div>
    </div>
  )
}
