/**
 * @module   QuestionListTab
 * @desc     题目列表 Tab — 进度卡 + 动态 Part 筛选 + 可练习 / 等待语料两区
 * @author   LingoBridge
 * @created  2026-06-01
 */
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import Chip from '@/components/Chip'
import PartTag from '@/components/PartTag'
import type { QBQuestion } from '@/lib/types'

const PROG = { background: 'linear-gradient(135deg,rgba(240,188,160,0.35),rgba(168,210,196,0.35))', borderRadius: 21, padding: 1 }
const BAR  = 'linear-gradient(to bottom,rgba(240,188,160,0.85),rgba(168,210,196,0.80))'

const SEG_N = 24
const segColor = (t: number): string => {
  const r = Math.round(212 + (123 - 212) * t)
  const g = Math.round(135 + (166 - 135) * t)
  const b = Math.round(90  + (153 - 90)  * t)
  const a = (0.70 + (0.50 - 0.70) * t).toFixed(2)
  return `rgba(${r},${g},${b},${a})`
}

interface Props {
  mappedQuestions: QBQuestion[]
  totalMapped: number
  totalMatched: number
  availableParts: (1 | 2 | 3)[]
}

export default function QuestionListTab({ mappedQuestions, totalMapped, totalMatched, availableParts }: Props) {
  const router = useRouter()
  const [part, setPart] = useState('全部')
  const [matchedOpen, setMatchedOpen] = useState(true)
  const [unmatchedOpen, setUnmatchedOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const partChips = ['全部', ...availableParts.map(p => `Part ${p}`)]
  const filtered   = part === '全部' ? mappedQuestions : mappedQuestions.filter(q => `Part ${q.part}` === part)
  const matchedQ   = filtered.filter(q => q.matched)
  const unmatchedQ = filtered.filter(q => !q.matched)

  return (
    <div className="flex flex-col gap-4">
      <div style={PROG}>
        <div className="bg-white rounded-[20px] px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-medium text-[#6B5B52]">你的故事已覆盖</span>
            <div>
              <span className="text-[18px] font-semibold text-[#2C2420]">{totalMatched}</span>
              <span className="text-[12px] text-[#A89990]"> / {totalMapped} 题</span>
            </div>
          </div>
          {(() => {
            const pct = totalMapped ? totalMatched / totalMapped : 0
            const filledSeg = Math.round(pct * SEG_N)
            return (
              <div className="flex gap-[3px]">
                {Array.from({ length: SEG_N }, (_, i) => (
                  <div
                    key={i}
                    className="flex-1 h-1 rounded-[2px]"
                    style={{ background: i < filledSeg ? segColor(i / Math.max(filledSeg - 1, 1)) : '#EEEBE6' }}
                  />
                ))}
              </div>
            )
          })()}
          {totalMatched === 0
            ? <p className="text-[12px] text-v2-text-muted mt-1.5">讲一个故事，点亮可练习的题目</p>
            : <p className="text-[11px] text-[#C4B5A9] mt-1.5">每一段都是你自己的答题素材</p>}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {partChips.map(p => <Chip key={p} onClick={() => setPart(p)} variant="ghost" active={part === p}>{p}</Chip>)}
      </div>

      {matchedQ.length > 0 && <>
        <button onClick={() => setMatchedOpen(v => !v)} className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-[#6B5B52]">可以练习 · {matchedQ.length} 道</span>
          <ChevronDown size={12} className={`text-[#6B5B52] transition-transform duration-200 ${matchedOpen ? '' : '-rotate-90'}`} />
        </button>
        {matchedOpen && <div className="flex flex-col gap-2">
          {matchedQ.map(q => (
            <div
              key={q.id}
              onClick={() => setSelectedId(q.id)}
              className="bg-white rounded-[14px] border border-black/[0.05] overflow-hidden flex shadow-[0_1px_6px_rgba(0,0,0,0.05)] cursor-pointer"
            >
              <div
                className="w-[4px] flex-shrink-0 self-stretch"
                style={{ background: q.id === selectedId ? BAR : 'transparent' }}
              />
              <div className="flex-1 px-[14px] py-[10px] flex items-center gap-[10px]">
                <div className="flex-1 min-w-0">
                  <PartTag label={`Part ${q.part}`} />
                  <p className="text-[13px] font-semibold text-[#111] leading-tight mt-1">{q.displayText}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); router.push(`/analysis?questionId=${q.id}&storyId=1`) }}
                  style={GRADIENT_BORDER_STYLE}
                  className="text-[11px] font-medium text-[#444] px-[10px] py-[3px] rounded-full flex-shrink-0"
                >练习</button>
              </div>
            </div>
          ))}
        </div>}
      </>}

      {unmatchedQ.length > 0 && <>
        <button onClick={() => setUnmatchedOpen(v => !v)} className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-[#BBB]">等待语料 · {unmatchedQ.length} 道</span>
          <ChevronDown size={12} className={`text-[#BBB] transition-transform duration-200 ${unmatchedOpen ? '' : '-rotate-90'}`} />
        </button>
        {unmatchedOpen && <div className="flex flex-col gap-2">
          {unmatchedQ.map(q => (
            <div key={q.id} className="bg-[#FAFAF8] rounded-[12px] border border-black/[0.03] px-[14px] py-[10px] flex items-center gap-2">
              <span className="text-[11px] font-medium border border-black/[0.06] text-[#CCC] px-[7px] py-[2px] rounded-full flex-shrink-0">Part {q.part}</span>
              <p className="text-[13px] text-[#BBB] flex-1">{q.displayText}</p>
            </div>
          ))}
        </div>}
      </>}
    </div>
  )
}
