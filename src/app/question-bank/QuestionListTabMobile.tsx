/**
 * @module   QuestionListTabMobile
 * @desc     题目列表 Tab（移动端）— 进度卡 + 动态 Part 筛选 + 可练习 / 等待语料两区；改版前独立移动 UI
 * @author   LingoBridge
 * @created  2026-06-01
 */
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import Chip from '@/components/Chip'
import PartTag from '@/components/PartTag'
import type { QBQuestion } from '@/lib/types'
import { BRAND_GRADIENT_SOFT, BRAND_GRADIENT_VERTICAL } from '@/lib/constants'

const PROG = { background: BRAND_GRADIENT_SOFT, borderRadius: 21, padding: 1 }
const BAR  = BRAND_GRADIENT_VERTICAL

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
        <div className="bg-white rounded-[16px] px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-medium text-v2-text-secondary">你的故事已覆盖</span>
            <div>
              <span className="text-[18px] font-semibold text-v2-text-primary">{totalMatched}</span>
              <span className="text-[12px] text-v2-text-muted"> / {totalMapped} 题</span>
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
                    /* 空段色 = bg-muted 同值；与 segColor 动态取色同处三元，无法用 class，故就地引用该 token 值 */
                    style={{ background: i < filledSeg ? segColor(i / Math.max(filledSeg - 1, 1)) : '#EEEBE6' }}
                  />
                ))}
              </div>
            )
          })()}
          {totalMatched === 0
            ? <p className="text-[12px] text-v2-text-muted mt-1.5">讲一个故事，点亮可练习的题目</p>
            : <p className="text-[11px] text-warm-taupe mt-1.5">每一段都是你自己的答题素材</p>}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {partChips.map(p => <Chip key={p} onClick={() => setPart(p)} variant="ghost" active={part === p}>{p}</Chip>)}
      </div>

      {matchedQ.length > 0 && <>
        <button onClick={() => setMatchedOpen(v => !v)} className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-v2-text-secondary">可以练习 · {matchedQ.length} 道</span>
          <ChevronDown size={12} className={`text-v2-text-secondary transition-transform duration-200 ${matchedOpen ? '' : '-rotate-90'}`} />
        </button>
        {matchedOpen && <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-2.5">
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
                  <p className="text-[13px] font-semibold text-v2-text-primary leading-tight mt-1">{q.displayText}</p>
                </div>
                <Chip
                  variant="gradient"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); router.push(`/practice-question?questionId=${q.id}`) }}
                  className="font-medium flex-shrink-0"
                >练习</Chip>
              </div>
            </div>
          ))}
        </div>}
      </>}

      {unmatchedQ.length > 0 && <>
        <button onClick={() => setUnmatchedOpen(v => !v)} className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-v2-text-muted">等待语料 · {unmatchedQ.length} 道</span>
          <ChevronDown size={12} className={`text-v2-text-muted transition-transform duration-200 ${unmatchedOpen ? '' : '-rotate-90'}`} />
        </button>
        {unmatchedOpen && <div className="flex flex-col gap-2">
          {unmatchedQ.map(q => (
            <div key={q.id} className="bg-bg-muted rounded-[12px] border border-black/[0.03] px-[14px] py-[10px] flex items-center gap-2">
              <span className="text-[11px] font-medium border border-black/[0.06] text-v2-text-muted px-[7px] py-[2px] rounded-full flex-shrink-0">Part {q.part}</span>
              <p className="text-[13px] text-v2-text-secondary flex-1">{q.displayText}</p>
            </div>
          ))}
        </div>}
      </>}
    </div>
  )
}
