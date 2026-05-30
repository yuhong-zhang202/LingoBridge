'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, Heart, Play } from 'lucide-react'
import TopBar from '@/components/TopBar'
import PartTag from '@/components/PartTag'
import { StepBar } from '@/components/StepBar'
import Tag from '@/components/Tag'
import { GRADIENT_BORDER_STYLE_FULL as GRADIENT_BORDER_STYLE } from '@/lib/constants'

const TOTAL = 8
const CURRENT = 3
const userName = 'YZ'

export default function FeedbackPage() {
  const router = useRouter()
  const [saved, setSaved] = useState(false)

  // ── 滑动手势状态
  const [offset, setOffset]   = useState(0)
  const [animated, setAnimated] = useState(false)
  const startXRef   = useRef(0)
  const isDragging  = useRef(false)

  const dragStart = (x: number) => {
    startXRef.current = x
    isDragging.current = true
    setAnimated(false)
  }

  const dragMove = (x: number) => {
    if (!isDragging.current) return
    setOffset(x - startXRef.current)
  }

  const dragEnd = () => {
    if (!isDragging.current) return
    isDragging.current = false
    setAnimated(true)
    setOffset(cur => {
      if (cur > 60) {
        setTimeout(() => { setSaved(true); setAnimated(false); setOffset(0) }, 200)
        return 500
      }
      if (cur < -60) {
        setTimeout(() => router.push('/'), 200)
        return -500
      }
      setTimeout(() => setAnimated(false), 200)
      return 0
    })
  }

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
      <StepBar currentStep="practice" />

      <div className="flex-1 overflow-y-auto px-6 pt-6 pb-10 relative z-10">

        {/* 卡片堆叠 — 绑定滑动手势 */}
        <div
          className="relative mb-5 select-none"
          style={{
            transform: `translateX(${offset}px)`,
            transition: animated ? 'transform 0.2s ease' : 'none',
            cursor: 'grab',
          }}
          onTouchStart={e => dragStart(e.touches[0].clientX)}
          onTouchMove={e => dragMove(e.touches[0].clientX)}
          onTouchEnd={dragEnd}
          onMouseDown={e => dragStart(e.clientX)}
          onMouseMove={e => dragMove(e.clientX)}
          onMouseUp={dragEnd}
          onMouseLeave={dragEnd}
        >
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
            className="relative shadow-[0_2px_12px_rgba(0,0,0,0.06)] px-[22px] pt-[16px] pb-[22px] z-10"
            style={{ ...GRADIENT_BORDER_STYLE, borderRadius: 20 }}
          >

            <div className="flex items-center mb-2 mt-[5px]">
              <PartTag label={userName || '你说的'} />
            </div>

            {/* 用户原句：渐变描边 + 右下角播放按钮 */}
            <div
              className="mb-4"
              style={{
                background: 'linear-gradient(135deg, rgba(232,136,58,0.35), rgba(123,191,116,0.35))',
                padding: 1,
                borderRadius: 14,
              }}
            >
              <div
                className="relative"
                style={{ background: '#FFFFFF', borderRadius: 13, padding: '12px 16px' }}
              >
                <p style={{ fontSize: 14, color: '#1A1A1A', fontWeight: '500', lineHeight: 1.6, paddingRight: 36 }}>
                  I went to park yesterday, very happy.
                </p>
                <button
                  className="absolute bottom-3 right-3 w-6 h-6 rounded-full flex items-center justify-center bg-gray-100"
                >
                  <Play size={11} className="text-gray-400" />
                </button>
              </div>
            </div>

            {/* AI 优化标签 */}
            <Tag label="AI 优化" variant="green" className="mb-2" />

            {/* AI 优化句：渐变描边 + 右下角播放按钮 */}
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(232,136,58,0.35), rgba(123,191,116,0.35))',
                padding: 1,
                borderRadius: 14,
              }}
            >
              <div
                className="relative"
                style={{ background: '#FFFFFF', borderRadius: 13, padding: '12px 16px 24px' }}
              >
                <p style={{ fontSize: 14, color: '#1A1A1A', lineHeight: 1.6, paddingRight: 36 }}>
                  I visited a local park yesterday, which left me feeling genuinely refreshed.
                </p>
                <button
                  className="absolute bottom-3 right-3 w-6 h-6 rounded-full flex items-center justify-center bg-gray-100"
                >
                  <Play size={11} className="text-gray-400" />
                </button>
              </div>
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
