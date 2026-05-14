'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Volume2, FileText, ChevronDown, SkipForward, Mic2 } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'

export default function PracticePage() {
  const router = useRouter()
  const [hintOpen, setHintOpen] = useState(false)

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <div className="ambient-light" />
      <TopBar
        title="练习对话"
        right={
          <button className="text-[13px] text-[#AAAAAA]">结束</button>
        }
      />
      <StepBar currentStep="practice" />

      <div className="flex-1 overflow-y-auto px-5 pb-[100px] relative z-10">

        {/* 话题提示条 */}
        <div className="flex items-center justify-between bg-[#F4F4F4] rounded-[10px] px-3.5 py-2 mb-4">
          <span className="text-[11px] text-[#888888]">当前话题：户外活动 · Part 1</span>
          <span className="text-[11px] text-[#AAAAAA]">问题 1 / 3</span>
        </div>

        {/* AI 气泡 - 左侧 */}
        <div className="flex items-start gap-3 max-w-[85%] mb-4">
          <div className="w-8 h-8 rounded-full bg-[#C8DDD9] flex items-center justify-center flex-shrink-0 text-[14px]">
            🌿
          </div>
          <div className="bg-white rounded-[16px] rounded-tl-[4px] px-4 py-3 shadow-sm border border-black/[0.05]">
            <p className="text-[15px] text-[#1A1A1A] leading-relaxed">
              我们今天来聊聊户外活动这个话题。
            </p>
            <p className="text-[15px] text-[#1A1A1A] leading-relaxed mt-1">
              你还记得上次说的那次公园经历吗？
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
          <div className="bg-[#F2D5C0] rounded-[16px] rounded-tr-[4px] px-4 py-3">
            <p className="text-[15px] text-[#1A1A1A] leading-relaxed">
              I remember I went to a park last weekend...
            </p>
          </div>
        </div>

        {/* 花盆藏纸 */}
        <button
          onClick={() => setHintOpen(!hintOpen)}
          className="w-full flex items-center gap-2 bg-white border border-dashed border-black/[0.10] rounded-[14px] px-3.5 py-2.5 mb-1 shadow-sm"
        >
          <FileText size={13} className="text-[#CCCCCC]" />
          <span className="flex-1 text-left text-[12px] text-[#BBBBBB]">
            查看口语稿参考
          </span>
          <ChevronDown
            size={13}
            className={`text-[#CCCCCC] transition-transform duration-300 ${hintOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {hintOpen && (
          <div className="bg-white border border-dashed border-black/[0.10] rounded-[14px] px-3.5 py-3.5 mb-3 shadow-sm animate-fade-up">
            <p className="text-[10px] font-medium text-[#CCCCCC] uppercase tracking-wide mb-2">
              你的口语稿
            </p>
            <p className="text-[13px] text-[#AAAAAA] leading-relaxed line-clamp-3">
              Last weekend, I spent some time at a local
              park near my home. It was a genuinely
              refreshing experience...
            </p>
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] flex items-center justify-between px-8 bg-bg-page border-t border-black/[0.05] z-20"
        style={{
          paddingTop: 16,
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
        }}
      >
        <button className="flex items-center gap-1.5 text-[12px] text-[#CCCCCC]">
          <SkipForward size={14} />
          跳过
        </button>

        <button
          className="btn-gradient-circle"
          style={{ width: 56, height: 56 }}
        >
          <Mic2 size={20} className="text-[#333]" />
        </button>

        <button
          onClick={() => router.push('/feedback')}
          className="flex flex-col items-center gap-0.5"
        >
          <span className="text-[12px] text-[#888]">下一题</span>
          <span className="text-[10px] text-[#CCCCCC]">1 / 3</span>
        </button>
      </div>
    </div>
  )
}
