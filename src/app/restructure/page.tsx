/**
 * @module   RestructurePage
 * @desc     AI 整理确认页 — 展示原始语料与 AI 整理结果，支持编辑后进入题目匹配
 * @author   LingoBridge
 * @created  2026-05-28
 */
'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Quote, Sparkles, Pencil, Check, RefreshCw } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'
import Orb from '@/components/Orb'
import Chip from '@/components/Chip'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import { MOCK_RAW_STORY, MOCK_AI_RESULT } from '@/data/restructure'

// 渐变参数：AI 结果卡 border 用半透明 rgba（与 globals.css 保持一致）
const GRAD_BORDER = 'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80))'

// ── AI 整理结果卡片（读 / 编辑同一组件切换）
function AiResultCard({ text, isEditing, onToggleEdit, onChange }: {
  text: string; isEditing: boolean; onToggleEdit: () => void; onChange: (v: string) => void
}) {
  return (
    <div style={{ background: GRAD_BORDER, padding: 1, borderRadius: 21 }}>
      <div className="bg-white rounded-[20px] px-5 pt-4 pb-5">
        {isEditing ? (
          <textarea
            value={text}
            onChange={e => onChange(e.target.value)}
            className="w-full min-h-[110px] text-[14px] text-gray-900 leading-relaxed bg-gray-50 rounded-[12px] px-3 py-2.5 outline-none resize-none focus:ring-1 focus:ring-brand-primary/30"
            autoFocus
          />
        ) : (
          <p className="text-[14px] text-gray-900 leading-relaxed">{text}</p>
        )}
        <div className="flex justify-end mt-2">
          <Chip onClick={onToggleEdit} variant="default">
            {isEditing ? <><Check size={12} />完成</> : <><Pencil size={12} />编辑</>}
          </Chip>
        </div>
      </div>
    </div>
  )
}

// ── 页面主体（Suspense 包裹原因：useSearchParams 需要）
function RestructureContent() {
  const router    = useRouter()
  const rawStory  = useSearchParams().get('story') ?? MOCK_RAW_STORY
  const [isLoading, setIsLoading] = useState(true)
  const [aiText,    setAiText]    = useState(MOCK_AI_RESULT)
  const [isEditing, setIsEditing] = useState(false)

  const startLoading = () => {
    setIsLoading(true)
    setIsEditing(false)
    setTimeout(() => setIsLoading(false), 1500)
  }

  useEffect(startLoading, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      <div className="ambient-light" />
      <TopBar title="整理确认" />
      <StepBar currentStep="restructure" />

      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-6 relative z-10 flex flex-col gap-4">

        {/* 原始语料卡片 */}
        <div className="bg-white rounded-[16px] border border-black/[0.05] px-5 pt-4 pb-5">
          <div className="flex items-center gap-1.5 mb-2.5">
            <Quote size={13} className="text-gray-400" />
            <span className="text-[11px] font-medium text-gray-400">素材录入</span>
          </div>
          <p className="text-[14px] text-gray-500 leading-relaxed">{rawStory}</p>
        </div>

        {/* 过渡区 */}
        <div className="flex items-center gap-2 px-1">
          <div className="flex-1 h-px bg-gray-200" />
          <Sparkles size={12} className="text-gray-300" />
          <span className="text-[11px] text-gray-400">语料梳理</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* AI 整理结果 / 加载态 */}
        {isLoading ? (
          <div className="flex flex-col items-center py-6 gap-3">
            <Orb size={120} />
            <p className="text-[13px] text-v2-text-muted">AI 整理中…</p>
          </div>
        ) : (
          <AiResultCard
            text={aiText}
            isEditing={isEditing}
            onToggleEdit={() => setIsEditing(v => !v)}
            onChange={setAiText}
          />
        )}
      </div>

      {/* 底部操作区 */}
      {!isLoading && (
        <div
          className="flex-shrink-0 px-5 relative z-10"
          style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom))', paddingTop: 12 }}
        >
          {/* 主按钮 */}
          <button
            className="flex items-center justify-center gap-1.5 w-full px-6 py-3 rounded-full text-[14px] font-medium text-[#444] mb-3 active:scale-[0.97] transition-transform duration-150"
            style={GRADIENT_BORDER_STYLE}
            onClick={() => router.push(`/matching?story=${encodeURIComponent(aiText)}`)}
          >
            开始匹配题目 →
          </button>
          {/* 次要按钮 */}
          <button
            className="w-full flex items-center justify-center gap-1.5 text-[13px] text-gray-400 active:opacity-70 transition-opacity"
            onClick={() => { setAiText(MOCK_AI_RESULT); startLoading() }}
          >
            <RefreshCw size={13} />重新整理
          </button>
        </div>
      )}
    </div>
  )
}

export default function RestructurePage() {
  return <Suspense><RestructureContent /></Suspense>
}
