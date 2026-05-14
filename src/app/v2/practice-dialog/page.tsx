'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Volume2, ChevronUp, ChevronDown, Mic2, SkipForward } from 'lucide-react'
import Orb from '@/components/Orb'
import StepProgress from '@/components/ui-v2/StepProgress'

const STEPS = ['故事', '文章', '题目', '练习', '反馈']

export default function V2PracticeDialogPage() {
  const router = useRouter()
  const [scriptOpen, setScriptOpen] = useState(false)

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      {/* TopBar */}
      <div className="w-full flex items-center justify-between h-[56px] px-5">
        <span className="text-[15px] font-bold text-v2-text-primary">练习对话</span>
        <button className="text-[13px] text-v2-text-muted px-3 py-1 rounded-full bg-bg-surface border border-black/[0.07]">
          结束
        </button>
      </div>

      <StepProgress steps={STEPS} current={3} />

      {/* Topic strip */}
      <div className="flex items-center justify-between bg-bg-muted mx-5 rounded-[10px] px-3.5 py-2 mb-2">
        <span className="text-[11px] text-v2-text-secondary">当前话题：户外活动 · Part 1</span>
        <span className="text-[11px] text-v2-text-muted">问题 1 / 3</span>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-5 pb-[160px]">
        {/* AI message */}
        <div className="flex items-end gap-2 mb-5 mt-3">
          <div className="flex-shrink-0 relative">
            <Orb size={40} pulse={false} />
          </div>
          <div className="max-w-[78%]">
            <p className="text-[11px] text-v2-text-muted mb-1 ml-1">Lingo</p>
            <div className="bg-bg-surface rounded-[18px_18px_18px_4px] border border-black/[0.05] px-4 py-3 shadow-sm">
              <p className="text-[14px] text-v2-text-primary leading-relaxed">
                我们今天来聊聊户外活动这个话题。
              </p>
              <p className="text-[14px] text-v2-text-primary leading-relaxed mt-1">
                你还记得上次说的那次公园经历吗？
              </p>
              <button className="flex items-center gap-1.5 mt-2.5">
                <Volume2 size={12} className="text-v2-text-muted" />
                <span className="text-[11px] text-v2-text-muted">播放语音</span>
              </button>
            </div>
          </div>
        </div>

        {/* User message */}
        <div className="flex justify-end mb-4">
          <div className="max-w-[78%]">
            <p className="text-[11px] text-v2-text-muted mb-1 mr-1 text-right">你</p>
            <div className="bg-brand-primary rounded-[18px_18px_4px_18px] px-4 py-3 shadow-sm">
              <p className="text-[14px] text-white leading-relaxed">
                I remember I went to a park last weekend...
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom panel */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-bg-surface border-t border-black/[0.06] z-20"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Script toggle */}
        <button
          onClick={() => setScriptOpen(!scriptOpen)}
          className="w-full flex items-center justify-between px-5 py-2.5 border-b border-black/[0.05]"
        >
          <span className="text-[12px] text-v2-text-muted">查看口语稿参考</span>
          {scriptOpen
            ? <ChevronDown size={13} className="text-v2-text-muted" />
            : <ChevronUp size={13} className="text-v2-text-muted" />
          }
        </button>

        {scriptOpen && (
          <div className="px-5 py-3 bg-bg-muted animate-fade-up">
            <p className="text-[13px] text-v2-text-secondary leading-relaxed line-clamp-3">
              Last weekend, I spent some time at a local park near my home. It was a genuinely
              refreshing experience...
            </p>
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center justify-between px-8 pt-3 pb-4">
          <button className="flex items-center gap-1.5 text-[12px] text-v2-text-muted">
            <SkipForward size={14} />
            跳过
          </button>

          <button
            className="w-[60px] h-[60px] rounded-full bg-brand-primary flex items-center justify-center shadow-md active:scale-95 transition-transform"
          >
            <Mic2 size={22} className="text-white" />
          </button>

          <button
            onClick={() => router.push('/v2/feedback')}
            className="flex flex-col items-center gap-0.5"
          >
            <span className="text-[12px] font-semibold text-v2-text-primary">下一题</span>
            <span className="text-[10px] text-v2-text-muted">1 / 3</span>
          </button>
        </div>
      </div>
    </div>
  )
}
