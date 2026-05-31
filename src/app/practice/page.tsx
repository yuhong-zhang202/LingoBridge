/**
 * @module   PracticePage
 * @desc     练习对话页 — 语音条 AI 消息、按住说话底栏、回复建议气泡
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'

import { useState, useRef, useEffect, Suspense, type RefObject } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Mic, X, Quote } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'
import { useRecording } from '@/hooks/useRecording'
import { QUESTIONS } from '@/data/questions'
import { GRADIENT_BORDER_STYLE, GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'
import type { Question } from '@/lib/types'
import OrbSoft from './_components/OrbSoft'

// ── 对话数据类型
type RoundEntry   = { round: string }
type AiEntry      = { role: 'ai';   durationSec: number; transcript: string }
type UserEntry    = { role: 'user'; text: string }
type DialogueItem = RoundEntry | AiEntry | UserEntry

// ── Mock 数据
const dialogue: DialogueItem[] = [
  { round: 'Round 1 · Frequency & Scene' },
  { role: 'ai',   durationSec: 8, transcript: 'How often do you go to parks? Tell me about the last time you visited one.' },
  { role: 'user', text: 'I usually go on weekends. Last time was last Saturday — I spent the whole afternoon there.' },
  { round: 'Round 2 · Feelings & Reasons' },
  { role: 'ai',   durationSec: 6, transcript: 'How does going to the park make you feel? Why do you enjoy it?' },
]

const suggestions = [
  "It helps me relax and clear my mind.",
  "I love the fresh air and open space.",
  "It's a nice escape from city life.",
]

// ── 时长格式化 m:ss
function formatDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

// ── 静态波形竖条
const WAVE_HEIGHTS = [5, 11, 15, 8, 13, 17, 6, 12, 9, 14, 7, 11]

function StaticWaveBars(): JSX.Element {
  return (
    <div className="flex items-center gap-[2px]" style={{ height: 18 }}>
      {WAVE_HEIGHTS.map((h, i) => (
        <div key={i} style={{ width: 2, height: h, borderRadius: 2, background: '#B5B5B5', flexShrink: 0 }} />
      ))}
    </div>
  )
}

// ── Round 分组标签
function RoundLabel({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex justify-center py-2 mb-1">
      <span className="text-[12px] text-[#A89990]">{text}</span>
    </div>
  )
}

// ── AI 语音条消息
function AiVoicePill({ durationSec, transcript }: { durationSec: number; transcript: string }): JSX.Element {
  const [showTranscript, setShowTranscript] = useState(false)

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        {/* 绿叶头像 */}
        <div className="w-[34px] h-[34px] rounded-full bg-[#E8F3E5] border border-[#C0DDB9] flex items-center justify-center flex-shrink-0 text-[14px]">
          🌿
        </div>

        {/* 语音条胶囊（整体可点击播放） */}
        <button
          onClick={() => console.log('[PracticePage] play audio')}
          className="inline-flex items-center gap-[9px] active:opacity-80 transition-opacity"
          style={{ padding: '9px 14px', background: '#FFFFFF', border: '1px solid rgba(0,0,0,.07)', borderRadius: 9999 }}
        >
          <StaticWaveBars />
          <span className="text-[11px] text-[#888]">{formatDuration(durationSec)}</span>
        </button>

        {/* 转文字按钮 */}
        <button
          onClick={() => setShowTranscript(s => !s)}
          aria-label="语音转文字"
          className="w-[24px] h-[24px] rounded-full bg-white flex items-center justify-center active:scale-[0.97] flex-shrink-0"
          style={{ border: '1px solid rgba(0,0,0,.10)' }}
        >
          <span className="text-[11px] font-semibold text-[#6B5B52] leading-none">文</span>
        </button>
      </div>

      {/* 展开转写文本 */}
      {showTranscript && (
        <p className="ml-[42px] mt-1.5 text-[13px] text-v2-text-secondary leading-relaxed">
          {transcript}
        </p>
      )}
    </div>
  )
}

// ── 用户消息气泡
function UserBubble({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex items-start gap-2 max-w-[85%] ml-auto flex-row-reverse mb-4">
      <div
        className="w-[34px] h-[34px] rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-semibold"
        style={{ background: '#F5D5BC', color: '#B5663A' }}
      >
        你
      </div>
      <div
        className="px-3.5 py-2.5"
        style={{
          background:   '#EDF6EB',
          border:       '1px solid rgba(192,221,185,.55)',
          borderRadius: '16px 6px 16px 16px',
        }}
      >
        <p className="text-[14px] text-[#1A1A1A] leading-[1.6]">{text}</p>
      </div>
    </div>
  )
}

// ── 回复建议气泡
interface SuggestionsPopupProps {
  items: string[]
  onClose: () => void
  onSelect: (text: string) => void
  popupRef: RefObject<HTMLDivElement>
}

function SuggestionsPopup({ items, onClose, onSelect, popupRef }: SuggestionsPopupProps): JSX.Element {
  return (
    <div
      ref={popupRef}
      className="fixed z-[40] rounded-[16px]"
      style={{ ...GRADIENT_BORDER_STYLE_FULL, left: 14, right: 14, bottom: 100, padding: '11px 13px 12px' }}
    >
      {/* 向下三角，左对齐云团按钮 */}
      <div
        className="absolute"
        style={{
          bottom:       -7,
          left:         18,
          width:        12,
          height:       12,
          background:   '#FFFFFF',
          transform:    'rotate(45deg)',
          borderRight:  '1px solid rgba(168,210,196,.80)',
          borderBottom: '1px solid rgba(188,210,168,.75)',
        }}
      />

      {/* 头部 */}
      <div className="flex justify-between items-center mb-2">
        <span className="text-[13px] font-semibold text-v2-text-primary">回复建议</span>
        <button onClick={onClose} className="active:opacity-60 transition-opacity">
          <X size={14} color="#A89990" />
        </button>
      </div>

      {/* 建议句列表 */}
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => { console.log('[PracticePage] suggestion selected:', item); onSelect(item) }}
            className="flex items-center gap-[7px] text-left w-full active:opacity-70 transition-opacity"
            style={{ padding: '7px 11px', background: '#F8F7F5', border: '1px solid rgba(168,153,144,.14)', borderRadius: 11 }}
          >
            <Quote size={11} color="#A89990" style={{ flexShrink: 0 }} />
            <span className="text-[12.5px] leading-[1.45] text-v2-text-primary">{item}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── 主内容（包在 Suspense 内以支持 useSearchParams）
function PracticeContent(): JSX.Element {
  const router = useRouter()
  const params = useSearchParams()
  const { handlePressStart, handlePressEnd } = useRecording()
  const [showSuggestions, setShowSuggestions] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)
  const orbRef   = useRef<HTMLButtonElement>(null)

  const questionId = params.get('questionId') ?? ''
  const q: Question | null = QUESTIONS.find(sq => sq.id === questionId) ?? null

  // 点弹窗外关闭：backdrop 在 z-[19]（低于底栏 z-20），内容区点击关闭，底栏按钮仍可直接交互
  useEffect(() => {
    if (!showSuggestions) return
    const handler = (e: MouseEvent) => {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        orbRef.current   && !orbRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSuggestions])

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <TopBar
        title="练习对话"
        right={
          <button onClick={() => router.push('/feedback')} className="text-[13px] text-[#AAAAAA]">
            结束
          </button>
        }
      />
      <StepBar currentStep="practice" />

      {/* 对话区域 */}
      <div className="flex-1 overflow-y-auto px-5 pt-2 pb-[100px] relative z-10">
        {/* 题目条（不变） */}
        <div className="flex items-center gap-2 bg-[#F7F5F1] border border-black/[0.05] rounded-[8px] px-[11px] py-[6px] mb-4">
          <span className="text-[11px] text-[#AAAAAA] flex-shrink-0">{q?.part ?? 'Part 1'}</span>
          <div className="w-px h-3 bg-[#DDDDDD] flex-shrink-0" />
          <span className="text-[12px] font-medium text-[#444] flex-1 truncate min-w-0">
            {q?.en ?? 'Do you often go to parks or outdoor spaces?'}
          </span>
          <span className="text-[11px] text-[#AAAAAA] flex-shrink-0">1 / 3</span>
        </div>

        {/* 对话列表 */}
        {dialogue.map((item, i) => {
          if ('round' in item) return <RoundLabel key={i} text={item.round} />
          if (item.role === 'ai') return (
            <AiVoicePill key={i} durationSec={item.durationSec} transcript={item.transcript} />
          )
          return <UserBubble key={i} text={item.text} />
        })}
      </div>

      {/* 遮罩：z-[19]，低于底栏，点内容区关闭气泡 */}
      {showSuggestions && (
        <div
          className="fixed inset-0 z-[19]"
          onClick={() => setShowSuggestions(false)}
        />
      )}

      {/* 回复建议气泡 */}
      {showSuggestions && (
        <SuggestionsPopup
          items={suggestions}
          onClose={() => setShowSuggestions(false)}
          onSelect={text => console.log('[PracticePage] suggestion selected:', text)}
          popupRef={popupRef}
        />
      )}

      {/* 底部输入区 */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-bg-page border-t border-black/[0.05] z-20 flex items-center gap-[12px] px-[14px]"
        style={{
          paddingTop:    18,
          paddingBottom: 'max(18px, env(safe-area-inset-bottom))',
        }}
      >
        {/* 云团 OrbSoft 按钮 */}
        <button
          ref={orbRef}
          onClick={() => setShowSuggestions(s => !s)}
          aria-label="回复建议"
          className="flex-shrink-0 active:scale-[0.94] transition-transform duration-150"
        >
          <OrbSoft size={50} />
        </button>

        {/* 按住说话胶囊 */}
        <button
          className="flex flex-1 items-center justify-center gap-[9px] active:scale-[0.97] transition-transform duration-150"
          style={{ ...GRADIENT_BORDER_STYLE, height: 52, borderRadius: 9999 }}
          onPointerDown={handlePressStart}
          onPointerUp={handlePressEnd}
        >
          <Mic size={19} color="#D4875A" />
          <span className="text-[14px] font-medium text-[#444]">按住说话</span>
        </button>
      </div>
    </div>
  )
}

/**
 * 练习对话页入口，包裹 Suspense 支持 useSearchParams
 */
export default function PracticePage(): JSX.Element {
  return <Suspense><PracticeContent /></Suspense>
}
