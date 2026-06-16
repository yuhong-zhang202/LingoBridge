/**
 * @module   MatchedQuestionCard
 * @desc     匹配页单题卡片 — 复用现有视觉，数据来自真实匹配结果
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { ArrowRight } from 'lucide-react'
import PartTag from '@/components/PartTag'
import Tag from '@/components/Tag'
import Chip from '@/components/Chip'
import type { MatchedQuestion } from '@/lib/types'

interface Props {
  question: MatchedQuestion
  selected: boolean
  onToggle: () => void
  onPractice: () => void
  isPrimaryMatch: boolean
  /** 当前题卡属于高匹配组时传 true，高匹配组一律不显示"需切换角度"标签 */
  isHighMatch: boolean
}

/**
 * 匹配页单题卡片
 * @param question   匹配题目
 * @param selected   是否选中
 * @param onToggle   点击卡片切换选中
 * @param onPractice 点击练习按钮
 */
export default function MatchedQuestionCard({ question, selected, onToggle, onPractice, isPrimaryMatch, isHighMatch }: Props) {
  // Part 2 主显示卡片标题，其余显示题目文本
  const enText = question.part === 2 ? (question.cue_card_title ?? question.question_text) : question.question_text
  const zhText = question.part === 2 ? (question.cue_card_title_zh ?? '') : (question.question_text_zh ?? '')

  return (
    <div
      onClick={onToggle}
      className={`bg-white rounded-[14px] overflow-hidden flex cursor-pointer border border-black/[0.05] transition-shadow duration-200 ${
        selected ? 'shadow-[0_2px_16px_rgba(212,135,90,0.12)]' : 'shadow-[0_1px_8px_rgba(0,0,0,0.06)]'
      }`}
    >
      {/* 左侧竖条 */}
      <div className="w-[4px] flex-shrink-0 self-stretch">
        {selected ? (
          <div
            className="w-full h-full"
            style={{ background: 'linear-gradient(to bottom, rgba(240,188,160,0.85), rgba(168,210,196,0.80))' }}
          />
        ) : (
          <div className="w-full h-full bg-transparent" />
        )}
      </div>

      <div className="flex-1 p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <PartTag label={`Part ${question.part}`} />
          <Tag variant="green" label={question.dimension} />
          {question.is_new && <Tag variant="green" label="新题" />}
          {!isPrimaryMatch && !isHighMatch && (
            <span
              className="text-[10px] font-medium px-[8px] py-[3px] rounded-full"
              style={{ background: 'rgba(212,135,90,0.10)', color: '#D4875A', border: '1px solid rgba(212,135,90,0.28)' }}
            >
              需切换角度
            </span>
          )}
        </div>

        <p className="text-[16px] font-bold text-v2-text-primary leading-snug">{enText}</p>
        {zhText && <p className="text-[12px] text-v2-text-muted mt-0.5">{zhText}</p>}

        <div className="flex items-center justify-end mt-3">
          <Chip
            variant="gradient"
            onClick={(e) => { e.stopPropagation(); onPractice() }}
            className="px-3 py-1.5 flex-shrink-0"
          >
            题目分析
            <ArrowRight size={12} />
          </Chip>
        </div>
      </div>
    </div>
  )
}
