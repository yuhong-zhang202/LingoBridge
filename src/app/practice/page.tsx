/**
 * @module   PracticePage
 * @desc     练习对话页 — 基于选中题目进行口语对话练习，题目信息从 URL 参数读取
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Volume2, RotateCcw, Mic2 } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'
import { useRecording } from '@/hooks/useRecording'
import { QUESTIONS } from '@/data/questions'
import type { Question } from '@/lib/types'

const GRAD_MIC = 'linear-gradient(135deg, rgba(232,136,58,0.45), rgba(123,191,116,0.45))'

const ROUNDS = [
  { label: 'Round 1 · Frequency & Scene',
    ai: 'How often do you go to parks? Tell me about the last time you visited one.',
    user: 'I usually go on weekends. Last time was last Saturday — I spent the whole afternoon there.' },
  { label: 'Round 2 · Feelings & Reasons',
    ai: 'How does going to the park make you feel? Why do you enjoy it?',
    user: 'It makes me feel refreshed. I enjoy the fresh air and the peaceful atmosphere.' },
  { label: 'Round 3 · Personal Experience',
    ai: 'Can you link your last park visit to a specific moment that stood out to you?',
    user: 'I saw many children playing — it was surprisingly relaxing just watching them.' },
]

function RoundLabel({ text }: { text: string }) {
  return (
    <div className="flex justify-center py-2 mb-1">
      <span className="text-[11px] text-[#AAAAAA]">{text}</span>
    </div>
  )
}

function AiBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 max-w-[85%] mb-2">
      <div className="w-7 h-7 rounded-full bg-[#EDF6EB] border border-[#C0DDB9] flex items-center justify-center flex-shrink-0 text-[12px]">🌿</div>
      <div>
        <div className="bg-white border border-black/[0.05] px-3.5 py-2.5" style={{ borderRadius: '4px 12px 12px 12px' }}>
          <p className="text-[14px] text-[#1A1A1A] leading-[1.6]">{text}</p>
        </div>
        <button className="flex items-center gap-1 mt-1 text-[11px] text-[#AAAAAA]">
          <Volume2 size={11} />Play
        </button>
      </div>
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 max-w-[85%] ml-auto flex-row-reverse mb-4">
      <div className="w-7 h-7 rounded-full bg-[#F2C9A0] flex items-center justify-center flex-shrink-0 text-[11px] font-semibold text-brand-primary">你</div>
      <div className="bg-[#EDF6EB] border border-[#C8E0C4] px-3.5 py-2.5" style={{ borderRadius: '12px 4px 12px 12px' }}>
        <p className="text-[14px] text-[#1A1A1A] leading-[1.6]">{text}</p>
      </div>
    </div>
  )
}

function PracticeContent() {
  const router = useRouter()
  const params = useSearchParams()
  const [currentIndex, setCurrentIndex] = useState(0)
  const { handlePressStart, handlePressEnd } = useRecording()

  const questionId = params.get('questionId') ?? ''
  const q: Question | null = QUESTIONS.find(sq => sq.id === questionId) ?? null
  const total = ROUNDS.length

  const handleNext = () => {
    if (currentIndex < total - 1) setCurrentIndex(i => i + 1)
    else router.push('/feedback')
  }

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <div className="ambient-light" />
      <TopBar
        title="练习对话"
        right={<button onClick={() => router.push('/feedback')} className="text-[13px] text-[#AAAAAA]">结束</button>}
      />
      <StepBar currentStep="practice" />

      <div className="flex-1 overflow-y-auto px-5 pt-2 pb-[100px] relative z-10">
        {/* 极简题目条 */}
        <div className="flex items-center gap-2 bg-[#F7F5F1] border border-black/[0.05] rounded-[8px] px-[11px] py-[6px] mb-4">
          <span className="text-[11px] text-[#AAAAAA] flex-shrink-0">{q?.part ?? 'Part 1'}</span>
          <div className="w-px h-3 bg-[#DDDDDD] flex-shrink-0" />
          <span className="text-[12px] font-medium text-[#444] flex-1 truncate min-w-0">
            {q?.en ?? 'Do you often go to parks or outdoor spaces?'}
          </span>
          <span className="text-[11px] text-[#AAAAAA] flex-shrink-0">1 / 3</span>
        </div>

        {/* 三轮对话 */}
        {ROUNDS.map((r, i) => (
          <div key={i}>
            <RoundLabel text={r.label} />
            <AiBubble text={r.ai} />
            <UserBubble text={r.user} />
          </div>
        ))}
      </div>

      {/* 底部操作区 */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-[#FEFEFE] border-t border-black/[0.05] z-20 flex items-center justify-between px-6"
        style={{ paddingTop: 14, paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
      >
        <button className="flex flex-col items-center gap-1 w-[52px]">
          <RotateCcw size={16} className="text-[#CCCCCC]" />
          <span className="text-[10px] text-[#CCCCCC]">重录</span>
        </button>

        <div style={{ background: GRAD_MIC, padding: 2, borderRadius: '50%' }}>
          <button
            className="w-[52px] h-[52px] rounded-full bg-white flex items-center justify-center active:scale-[0.95] transition-transform duration-150"
            onMouseDown={handlePressStart} onMouseUp={handlePressEnd}
            onTouchStart={handlePressStart} onTouchEnd={handlePressEnd}
          >
            <Mic2 size={20} className="text-brand-primary" />
          </button>
        </div>

        <button onClick={handleNext} className="flex flex-col items-center gap-1 w-[52px]">
          <span className="text-[12px] text-[#888]">{currentIndex < total - 1 ? '下一题' : '完成'}</span>
          <span className="text-[10px] text-[#CCCCCC]">{currentIndex + 1} / {total}</span>
        </button>
      </div>
    </div>
  )
}

export default function PracticePage() {
  return <Suspense><PracticeContent /></Suspense>
}
