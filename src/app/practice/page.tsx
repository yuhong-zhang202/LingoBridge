'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Volume2, FileText, ChevronDown, RotateCcw, Mic2 } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'

const QUESTIONS = [
  { topic: '户外活动 · Part 1', ai: '我们今天来聊聊户外活动这个话题。你还记得上次说的那次公园经历吗？' },
  { topic: '户外活动 · Part 1', ai: '你在公园里做了什么让你感到放松的事情？' },
  { topic: '户外活动 · Part 1', ai: '如果下次再去公园，你会做什么不一样的事吗？' },
]

export default function PracticePage() {
  const router = useRouter()
  const [hintOpen, setHintOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isLongPressing, setIsLongPressing] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>()

  const total = QUESTIONS.length
  const current = QUESTIONS[currentIndex]

  const handleNext = () => {
    if (currentIndex < total - 1) {
      setCurrentIndex(i => i + 1)
      setHintOpen(false)
    } else {
      router.push('/feedback')
    }
  }

  const handleEnd = () => router.push('/feedback')

  const handlePressStart = () => {
    longPressTimer.current = setTimeout(() => {
      setIsLongPressing(true)
      if (navigator.vibrate) navigator.vibrate(30)
    }, 300)
  }

  const handlePressEnd = () => {
    clearTimeout(longPressTimer.current)
  }

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <div className="ambient-light" />
      <TopBar
        title="练习对话"
        right={
          <button onClick={handleEnd} className="text-[13px] text-[#AAAAAA]">结束</button>
        }
      />
      <StepBar currentStep="practice" />

      <div
        className="flex-1 overflow-y-auto px-5 relative z-10"
        style={{ paddingBottom: hintOpen ? 280 : 160 }}
      >

        {/* 话题提示条 */}
        <div className="flex items-center justify-between bg-[#F4F4F4] rounded-[10px] px-3.5 py-2 mb-4">
          <span className="text-[11px] text-[#888888]">当前话题：{current.topic}</span>
          <span className="text-[11px] text-[#AAAAAA]">问题 {currentIndex + 1} / {total}</span>
        </div>

        {/* AI 气泡 - 左侧 */}
        <div className="flex items-start gap-3 max-w-[85%] mb-4">
          <div className="w-8 h-8 rounded-full bg-[#C8DDD9] flex items-center justify-center flex-shrink-0 text-[14px]">
            🌿
          </div>
          <div className="flex-1 rounded-[16px] rounded-tl-[4px] px-4 py-3 shadow-sm border border-black/[0.05]" style={{ backgroundColor: '#FFFFFF' }}>
            <p className="text-[15px] text-[#1A1A1A] leading-relaxed">
              {current.ai}
            </p>
            <button className="flex items-center gap-1 mt-2 text-[12px] text-[#AAAAAA]">
              <Volume2 size={12} />
              播放语音
            </button>
          </div>
        </div>

        {/* 用户气泡 - 右侧 */}
        <div className="flex items-start gap-3 max-w-[85%] ml-auto flex-row-reverse mb-4">
          <div className="w-8 h-8 rounded-full bg-[#E8C9A8] flex items-center justify-center flex-shrink-0 text-[13px] font-semibold text-[#D4875A]">
            你
          </div>
          <div
            className="rounded-[16px] rounded-tr-[4px] px-4 py-3 shadow-sm border border-black/[0.05]"
            style={{ backgroundColor: '#FDFAF6' }}
          >
            <p style={{ fontSize: 15, color: '#1A1A1A', lineHeight: 1.6 }}>
              I remember I went to a park last weekend...
            </p>
          </div>
        </div>
      </div>

      {/* 底部固定区域：口语稿折叠栏 + 录音操作栏 */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px]"
        style={{
          backgroundColor: '#FFFFFF',
          borderTop: '1px solid #EEEEEE',
          zIndex: 20,
          boxSizing: 'border-box',
        }}
      >
        {/* 口语稿折叠栏 */}
        <button
          onClick={() => setHintOpen(!hintOpen)}
          className="w-full flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid #F0EDE9' }}
        >
          <div className="flex items-center gap-2">
            <FileText size={13} className="text-[#CCCCCC]" />
            <span className="text-[13px] text-[#AAAAAA]">查看口语稿参考</span>
          </div>
          <ChevronDown
            size={13}
            className={`text-[#CCCCCC] transition-transform duration-300 ${hintOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {/* 口语稿内容 */}
        {hintOpen && (
          <div
            className="px-4 py-3 overflow-y-auto"
            style={{ backgroundColor: '#FAFAF8', borderBottom: '1px solid #F0EDE9', maxHeight: 120 }}
          >
            <p className="text-[10px] font-medium text-[#CCCCCC] uppercase tracking-wide mb-2">
              你的口语稿
            </p>
            <p className="text-[13px] text-[#AAAAAA] leading-relaxed">
              Last weekend, I spent some time at a local park near my home. It was a genuinely refreshing experience...
            </p>
          </div>
        )}

        {/* 录音操作栏 */}
        <div
          className="flex items-center justify-between px-8"
          style={{
            paddingTop: 16,
            paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
          }}
        >
          <button className="flex items-center gap-1.5 text-[12px] text-[#CCCCCC]">
            <RotateCcw size={14} />
            重录
          </button>

          <button
            className="btn-gradient-circle"
            style={{ width: 56, height: 56 }}
            onMouseDown={handlePressStart}
            onMouseUp={handlePressEnd}
            onMouseLeave={handlePressEnd}
            onTouchStart={handlePressStart}
            onTouchEnd={handlePressEnd}
          >
            <Mic2 size={20} className="text-[#333]" />
          </button>

          <button
            onClick={handleNext}
            className="flex flex-col items-center gap-0.5"
          >
            <span className="text-[12px] text-[#888]">
              {currentIndex < total - 1 ? '下一题' : '完成'}
            </span>
            <span className="text-[10px] text-[#CCCCCC]">{currentIndex + 1} / {total}</span>
          </button>
        </div>
      </div>

      {/* 长按录音底栏 */}
      {isLongPressing && (
        <>
          {/* 背景遮罩 */}
          <div
            style={{
              position: 'fixed',
              top: 0, right: 0, bottom: 0, left: 0,
              backgroundColor: 'rgba(0,0,0,0.30)',
              zIndex: 40,
            }}
          />

          {/* 半圆底栏 */}
          <div
            className="sheet-enter"
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              width: '100%',
              height: 320,
              background: '#FFFFFF',
              borderTopLeftRadius: '50% 60px',
              borderTopRightRadius: '50% 60px',
              paddingTop: 32,
              zIndex: 50,
            }}
          >
            {/* 录音波形 */}
            <div className="flex items-center justify-center gap-[5px] mb-2">
              {[4, 8, 14, 20, 28, 20, 14, 8, 4].map((h, i) => (
                <div
                  key={i}
                  className="rounded-full animate-pulse"
                  style={{
                    width: 5,
                    height: h,
                    animationDelay: `${i * 0.08}s`,
                    animationDuration: '0.6s',
                    background: `linear-gradient(to top,
                      rgb(212,135,90),
                      rgb(${Math.round(212 + (119 - 212) * i / 8)},${Math.round(135 + (166 - 135) * i / 8)},${Math.round(90 + (153 - 90) * i / 8)})
                    )`,
                  }}
                />
              ))}
            </div>

            <p className="text-center text-[13px] text-[#AAAAAA] mb-8">
              正在录音...
            </p>

            {/* 三个操作按钮 */}
            <div className="flex items-end justify-between px-12">

              {/* 取消 */}
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={() => setIsLongPressing(false)}
                  className="w-[64px] h-[64px] rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#F0EDE9' }}
                >
                  <span className="text-[22px]">✕</span>
                </button>
                <span className="text-[13px] text-[#888888]">取消</span>
              </div>

              {/* 发送语音（中，最大） */}
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={() => setIsLongPressing(false)}
                  className="w-[80px] h-[80px] rounded-full flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, #D4875A, #7BA699)',
                    padding: 2,
                  }}
                >
                  <div
                    className="w-full h-full rounded-full flex items-center justify-center"
                    style={{ backgroundColor: '#FAFAFA' }}
                  >
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="#D4875A"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="#D4875A" strokeWidth="2" strokeLinecap="round"/>
                      <line x1="12" y1="19" x2="12" y2="23" stroke="#D4875A" strokeWidth="2" strokeLinecap="round"/>
                      <line x1="8" y1="23" x2="16" y2="23" stroke="#D4875A" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </div>
                </button>
                <span className="text-[13px] font-medium" style={{ color: '#D4875A' }}>
                  发送语音
                </span>
              </div>

              {/* 转文字 */}
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={() => setIsLongPressing(false)}
                  className="w-[64px] h-[64px] rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#EAF4F1' }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M4 6h16M4 12h10M4 18h7" stroke="#7BA699" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
                <span className="text-[13px]" style={{ color: '#7BA699' }}>转文字</span>
              </div>
            </div>

            <p className="text-center text-[12px] text-[#BBBBBB] mt-6">
              松开发送，上滑取消
            </p>
          </div>
        </>
      )}
    </div>
  )
}
