/**
 * @module   QuestionCard
 * @desc     题目匹配页单题卡片 — 含收藏切换、练习按钮；第一张用渐变描边强调样式
 * @author   LingoBridge
 * @created  2026-05-28
 */
'use client'
import { useState } from 'react'
import { Star, ArrowRight } from 'lucide-react'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import type { MatchQuestion } from '@/data/matching'

const GRAD = 'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80))'

interface Props {
  question: MatchQuestion
  isFirst: boolean
  onPractice: () => void
}

/**
 * 卡片内容（含收藏 useState，读 / 编辑共用）
 * @param question  题目数据
 * @param onPractice  练习按钮回调
 */
function CardInner({ question, onPractice }: Pick<Props, 'question' | 'onPractice'>) {
  const [starred, setStarred] = useState(false)
  return (
    <div className="bg-white rounded-[15px] p-4">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
          {question.part}
        </span>
        {question.hot && (
          <span className="text-[10px] font-medium bg-brand-primary-light text-brand-primary px-2 py-0.5 rounded-full">
            当季热题
          </span>
        )}
      </div>
      <p className="text-[15px] font-semibold text-v2-text-primary leading-snug mb-0.5">
        {question.en}
      </p>
      <p className="text-[12px] text-v2-text-muted mb-3">{question.zh}</p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <button onClick={() => setStarred(s => !s)} className="p-0.5 flex-shrink-0">
            <Star
              size={14}
              className={starred ? 'text-brand-primary fill-brand-primary' : 'text-gray-300'}
            />
          </button>
          <span className="text-[11px] text-gray-400 truncate">
            与你的故事相关：{question.related.join('、')}
          </span>
        </div>
        <button
          onClick={onPractice}
          className="flex items-center gap-1 text-[12px] font-medium text-[#444] px-3 py-1.5 rounded-full flex-shrink-0 ml-2"
          style={GRADIENT_BORDER_STYLE}
        >
          练习<ArrowRight size={11} />
        </button>
      </div>
    </div>
  )
}

/**
 * 题目卡片
 * @param question   题目数据
 * @param isFirst    是否为第一张（用渐变描边强调样式）
 * @param onPractice 练习按钮回调
 */
export default function QuestionCard({ question, isFirst, onPractice }: Props) {
  if (isFirst) {
    return (
      <div style={{ background: GRAD, padding: 1, borderRadius: 17 }}>
        <CardInner question={question} onPractice={onPractice} />
      </div>
    )
  }
  return (
    <div className="rounded-[16px] border border-black/[0.05] overflow-hidden">
      <CardInner question={question} onPractice={onPractice} />
    </div>
  )
}
