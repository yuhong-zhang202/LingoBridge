'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Volume2, X, Heart } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'

const TOTAL = 8
const CURRENT = 3
const TAGS = ['词汇升级', '句式优化', '时态修正']

const GRADIENT_BORDER_STYLE = {
  background: [
    'linear-gradient(white, white) padding-box',
    'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80), rgba(188,210,168,0.75)) border-box',
  ].join(','),
  border: '1.5px solid transparent',
} as React.CSSProperties

export default function FeedbackPage() {
  const router = useRouter()
  const [saved, setSaved] = useState(false)

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <div className="ambient-light" />
      <TopBar
        title="反馈卡片"
        right={
          <span className="text-[13px] text-[#AAAAAA]">
            {CURRENT} / {TOTAL}
          </span>
        }
      />
      <StepBar currentStep="feedback" />

      {/* 卡片进度条 */}
      <div className="relative z-10">
        <div className="h-[2px] bg-[#EEEEEE]">
          <div
            className="h-full bg-[#AAAAAA] rounded-sm transition-all duration-500"
            style={{ width: `${(CURRENT / TOTAL) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-6 pb-10 relative z-10">

        {/* 卡片堆叠 */}
        <div className="relative mb-5">
          {/* 背景装饰卡 */}
          <div
            className="absolute inset-0 bg-white rounded-[28px] shadow-sm"
            style={{
              transform: 'rotate(2.5deg) scale(0.96) translateY(8px)',
              opacity: 0.5,
              zIndex: 0,
            }}
          />

          {/* 主卡片 */}
          <div className="relative bg-white rounded-[28px] shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-[22px] z-10 border border-black/[0.04]">

            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-medium text-[#AAAAAA] bg-[#F4F4F4] px-3 py-1 rounded-full">
                你说的
              </span>
              <button className="w-[30px] h-[30px] rounded-full bg-[#F4F4F4] flex items-center justify-center">
                <Volume2 size={13} className="text-[#AAAAAA]" />
              </button>
            </div>

            <div className="surface px-3.5 py-3 mb-4">
              <p className="text-[14px] text-[#555] leading-relaxed">
                I went to park yesterday, very happy.
              </p>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-black/[0.06]" />
              <span className="text-[11px] text-[#CCCCCC]">AI 优化</span>
              <div className="flex-1 h-px bg-black/[0.06]" />
            </div>

            <div className="bg-[#FAFAFA] rounded-[14px] px-3.5 py-3 mb-4 border-l-[2.5px] border-l-[rgba(168,210,196,0.70)]">
              <p className="text-[14px] text-[#222] leading-relaxed">
                I visited a local park yesterday, which left me feeling genuinely refreshed.
              </p>
            </div>

            <div className="flex gap-1.5 flex-wrap mb-4">
              {TAGS.map(tag => (
                <span key={tag} className="text-[11px] text-[#888] bg-[#F4F4F4] px-2.5 py-1 rounded-full">
                  {tag}
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <button className="btn-ghost flex-1 h-[34px] text-[12px]">
                ▶ 听原句
              </button>
              <button className="btn-ghost flex-1 h-[34px] text-[12px]">
                ▶ 听优化句
              </button>
            </div>
          </div>
        </div>

        {/* 滑动提示 */}
        <div className="flex items-center justify-center gap-3 mb-3">
          <span className="text-[12px] text-[#CCCCCC]">← 跳过</span>
          <span className="text-[12px] text-[#CCCCCC]">—</span>
          <span className="text-[12px] text-[#888]">收藏 →</span>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3 mb-4">
          <button
            onClick={() => router.push('/')}
            className="btn-ghost flex-1 h-[48px]"
          >
            <X size={15} className="text-[#CCCCCC]" />
          </button>
          <button
            onClick={() => setSaved(!saved)}
            className="flex-1 h-[48px] flex items-center justify-center gap-2 rounded-full"
            style={GRADIENT_BORDER_STYLE}
          >
            <Heart
              size={16}
              className={saved ? 'text-[#C47A6A] fill-[#C47A6A]' : 'text-[#555]'}
            />
            <span className="text-[13px] font-semibold text-[#444]">
              收藏
            </span>
          </button>
        </div>

        <p className="text-[12px] text-[#CCCCCC] text-center">
          还有 {TOTAL - CURRENT} 张卡片
        </p>
      </div>
    </div>
  )
}
