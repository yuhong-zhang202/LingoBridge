/**
 * @module   AnalysisPage
 * @desc     题目侧重点分析页 — 考官侧重点与句式框架，选题后跳转练习
 * @author   LingoBridge
 * @created  2026-05-28
 */
'use client'
import { Suspense, ReactNode, useState } from 'react'
import type { CSSProperties } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Target, Type, ChevronDown } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import { StepBar } from '@/components/StepBar'
import { MOCK_ANALYSIS } from '@/data/analysis'
import { QUESTIONS } from '@/data/questions'
import type { Question } from '@/lib/types'
import PartTag from '@/components/PartTag'

const GRAD_BORDER = 'linear-gradient(135deg, rgba(232,136,58,0.35), rgba(123,191,116,0.35))'
const GRAD_NUM    = 'linear-gradient(135deg, rgba(232,136,58,0.40), rgba(123,191,116,0.40))'

const LIGHTER_BORDER: CSSProperties = {
  background: 'linear-gradient(white,white) padding-box,linear-gradient(135deg,rgba(232,136,58,0.35),rgba(123,191,116,0.35)) border-box',
  border: '1.5px solid transparent',
}

/** 句式填空 [xxx] 渲染为绿色加粗 */
function HighlightSentence({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]+\])/).map((part, i) =>
        part.startsWith('[')
          ? <span key={i} className="font-semibold text-[#4A8A45]">{part}</span>
          : part
      )}
    </>
  )
}

/** 序号圆圈：外层极淡渐变描边 + 内层白底 + 灰色数字 */
function StepNum({ n }: { n: number }) {
  return (
    <div style={{ background: GRAD_NUM, padding: 1, borderRadius: '50%', width: 20, height: 20, flexShrink: 0 }}>
      <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
        <span className="text-[11px] font-bold leading-none text-[#A0A09A]">{n}</span></div>
    </div>
  )
}

/** 渐变描边卡片 — 极淡 1px 渐变 border + 白底内层 */
function GradCard({ children }: { children: ReactNode }) {
  return (
    <div className="shadow-[0_2px_12px_rgba(0,0,0,0.06)]" style={{ background: GRAD_BORDER, padding: 1, borderRadius: 21 }}>
      <div className="bg-white rounded-[20px] px-[22px] pt-[16px] pb-[22px]">{children}</div>
    </div>
  )
}

function AnalysisContent() {
  const router     = useRouter()
  const params     = useSearchParams()
  const questionId = params.get('questionId') ?? ''
  const storyId    = params.get('storyId') ?? '1'
  const found: Question = QUESTIONS.find(q => q.id === questionId) ?? QUESTIONS[0]
  const data       = MOCK_ANALYSIS
  const [showMore, setShowMore] = useState(false)

  return (
    <div
      className="relative flex flex-col bg-bg-page overflow-hidden"
      style={{ height: '100dvh', paddingBottom: 'calc(56px + env(safe-area-inset-bottom))' }}
    >
      <div className="ambient-light" />
      <TopBar title="题目分析" />
      <StepBar currentStep="analysis" />

      {/* 唯一滚动区 — min-h-0 是关键，缺了它 overflow-y-auto 不生效 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-8 relative z-10 flex flex-col gap-4">

        {/* 题目卡片 */}
        <div className="card px-[22px] pt-[16px] pb-[22px]">
          <div className="flex items-center gap-2 mb-2.5">
            <PartTag label={found.part} />
            {found.hot && (
              <span className="text-[10px] font-medium bg-[#EDF6EB] border border-[#C0DDB9] text-[#3D7A38] px-[8px] py-[3px] rounded-full">
                当季热题
              </span>
            )}
          </div>
          <p className="text-[14px] font-medium text-[#1A1A1A] leading-[1.6] mb-1">{found.en}</p>
          <p className="text-[12px] text-[#888888]">{found.zh}</p>
        </div>

        {/* 答题侧重点 */}
        <GradCard>
          <div className="flex items-center gap-1.5 mb-3">
            <Target size={13} className="text-brand-primary" />
            <span className="text-[13px] font-semibold text-[#444]">答题侧重点</span>
          </div>
          <div className="flex flex-col gap-3">
            {data.focusPoints.map((fp, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <StepNum n={i + 1} />
                <div className="flex-1 pt-[1px]">
                  <p className="text-[14px] font-medium text-[#1A1A1A] leading-[1.6]">{fp.title}</p>
                  <p className="text-[12px] text-[#888888] mt-0.5 leading-relaxed">{fp.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </GradCard>

        {/* 可用句式框架 */}
        <GradCard>
          <div className="flex items-center gap-1.5 mb-3">
            <Type size={13} className="text-brand-accent" />
            <span className="text-[13px] font-semibold text-[#444]">可用句式框架</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {(showMore ? data.sentenceFrames : data.sentenceFrames.slice(0, 1)).map((sf, i) => (
              <div key={i} className="bg-[#F8F7F5] rounded-[10px] px-4 py-3">
                <p className="text-[14px] text-[#1A1A1A] leading-[1.6]">
                  <HighlightSentence text={sf.text} />
                </p>
                {sf.tip && <p className="text-[12px] text-[#888888] mt-1.5">{sf.tip}</p>}
              </div>
            ))}
            <button
              className="flex items-center justify-center gap-1 text-[12px] text-[#888888] py-1 active:opacity-60 transition-opacity"
              onClick={() => setShowMore(v => !v)}
            >
              {showMore ? '收起' : '查看更多句式 ∨'}
              <ChevronDown size={12} className={`transition-transform duration-200 ${showMore ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </GradCard>

        <button
          className="flex items-center justify-center gap-1.5 w-full px-5 py-2.5 rounded-full text-[14px] font-semibold text-[#444] active:scale-[0.97] transition-transform duration-150"
          style={LIGHTER_BORDER}
          onClick={() => router.push(`/practice?questionId=${questionId}&storyId=${storyId}`)}
        >
          开始练习 →
        </button>

      </div>

      <TabBar />
    </div>
  )
}

export default function AnalysisPage() {
  return <Suspense><AnalysisContent /></Suspense>
}
