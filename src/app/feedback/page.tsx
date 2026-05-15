'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Heart } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'

const TOTAL = 8
const CURRENT = 3
const userName = 'YZ'

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

      <div className="flex-1 overflow-y-auto px-6 pt-6 pb-10 relative z-10">

        {/* 卡片堆叠 */}
        <div className="relative mb-5">
          {/* 背景装饰卡 */}
          <div
            className="absolute inset-0 bg-white rounded-[20px] shadow-sm"
            style={{
              transform: 'rotate(2.5deg) scale(0.96) translateY(8px)',
              opacity: 0.5,
              zIndex: 0,
            }}
          />

          {/* 主卡片 */}
          <div
            className="relative shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-[22px] z-10"
            style={{
              background: 'linear-gradient(white, white) padding-box, linear-gradient(to right, #D4875A, #7BA699) border-box',
              border: '1.5px solid transparent',
              borderRadius: 20,
            }}
          >

            <div className="flex items-center mb-4">
              <span
                className="text-[11px] font-medium text-[#AAAAAA] px-3 py-1 rounded-full"
                style={{ backgroundColor: '#FFFFFF', border: '1.5px solid #7BA699' }}
              >
                {userName || '你说的'}
              </span>
            </div>

            {/* 用户原句：浅灰底 + 右下角播放按钮 */}
            <div
              className="relative mb-4"
              style={{
                backgroundColor: '#F8F7F5',
                borderRadius: 10,
                padding: '12px 16px',
              }}
            >
              <p style={{ fontSize: 14, color: '#1A1A1A', fontWeight: '500', lineHeight: 1.6, paddingRight: 36 }}>
                I went to park yesterday, very happy.
              </p>
              <button
                className="absolute bottom-3 right-3 w-[28px] h-[28px] rounded-full flex items-center justify-center"
                style={{ backgroundColor: '#EEF7F3' }}
              >
                <span className="text-[11px]" style={{ color: '#5A9E8A' }}>▶</span>
              </button>
            </div>

            {/* AI 优化标签 */}
            <div
              className="inline-flex items-center px-3 py-1 rounded-[10px] text-[12px] font-medium mb-2"
              style={{ backgroundColor: '#FFFFFF', border: '1.5px solid #7BA699', color: '#5A9E8A' }}
            >
              AI 优化
            </div>

            {/* AI 优化句：浅灰底 + 右下角播放按钮 */}
            <div
              className="relative"
              style={{
                backgroundColor: '#F8F7F5',
                borderRadius: 10,
                padding: '12px 16px',
              }}
            >
              <p style={{ fontSize: 14, color: '#1A1A1A', lineHeight: 1.6, paddingRight: 36 }}>
                I visited a local park yesterday, which left me feeling genuinely refreshed.
              </p>
              <button
                className="absolute bottom-3 right-3 w-[28px] h-[28px] rounded-full flex items-center justify-center"
                style={{ backgroundColor: '#EEF7F3' }}
              >
                <span className="text-[11px]" style={{ color: '#5A9E8A' }}>▶</span>
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
            className="btn-ghost flex-1 h-[48px] active:scale-[0.97] transition-transform duration-150"
          >
            <X size={15} className="text-[#CCCCCC]" />
          </button>
          <button
            onClick={() => setSaved(!saved)}
            className="flex-1 h-[48px] flex items-center justify-center gap-2 rounded-full active:scale-[0.97] transition-transform duration-150"
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
