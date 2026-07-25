/**
 * @module   MatchedQuestionCard
 * @desc     匹配页单题卡片（移动端）— 复用现有视觉，数据来自真实匹配结果。新增「存对子」：
 *           右滑存（绿底书签层，右移 > 60px 触发、松手弹回并切已存态）+ 右上角三态书签按钮（右滑的
 *           a11y 兜底，右滑绝不是唯一途径）。三态：存中（spinner + aria-live 播报）/ 已存（BookmarkCheck，
 *           右滑短路）/ 未存。失败由外壳 Toast 呈现、回未存态。reduced-motion 下弹回不做动画。
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { useRef, useState } from 'react'
import { ArrowRight, Bookmark, BookmarkCheck } from 'lucide-react'
import PartTag from '@/components/PartTag'
import Tag from '@/components/Tag'
import Chip from '@/components/Chip'
import AnkiBookmarkButton, { type AnkiSaveState } from '@/components/anki/AnkiBookmarkButton'
import type { MatchedQuestion } from '@/lib/types'
import { BRAND_GRADIENT_VERTICAL } from '@/lib/constants'

/** 右滑触发存对子的位移阈值（px）。 */
const SWIPE_SAVE_THRESHOLD = 60

interface Props {
  question: MatchedQuestion
  selected: boolean
  onToggle: () => void
  onPractice: () => void
  isPrimaryMatch: boolean
  /** 当前题卡属于高匹配组时传 true，高匹配组一律不显示"需切换角度"标签 */
  isHighMatch: boolean
  /** 存对子三态（存中/已存/未存）。 */
  saveState: AnkiSaveState
  /** 触发存对子（右滑越阈 / 点书签）。已存/存中态由本组件短路，不重复调用。 */
  onSave: () => void
}

/**
 * 匹配页单题卡片
 * @param question   匹配题目
 * @param selected   是否选中
 * @param onToggle   点击卡片切换选中
 * @param onPractice 点击练习按钮
 * @param saveState  存对子三态
 * @param onSave     触发存对子
 */
export default function MatchedQuestionCard({ question, selected, onToggle, onPractice, isPrimaryMatch, isHighMatch, saveState, onSave }: Props) {
  // Part 2 主显示卡片标题，其余显示题目文本
  const enText = question.part === 2 ? (question.cue_card_title ?? question.question_text) : question.question_text
  const zhText = question.part === 2 ? (question.cue_card_title_zh ?? '') : (question.question_text_zh ?? '')

  // 右滑手势：仅正向（右移）有效，越阈触发 onSave；已存/存中态整条短路（不给右滑，也不显进度）。
  const canSwipe = saveState === 'idle'
  const [dx, setDx] = useState(0)
  const [animated, setAnimated] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const dxRef = useRef(0)
  const dragging = useRef(false)
  const moved = useRef(false)
  const axis = useRef<'none' | 'x' | 'y'>('none')

  const onTouchStart = (e: React.TouchEvent): void => {
    if (!canSwipe) return
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    dragging.current = true
    moved.current = false
    axis.current = 'none'
    setAnimated(false)
  }
  const onTouchMove = (e: React.TouchEvent): void => {
    if (!dragging.current) return
    const rawX = e.touches[0].clientX - startX.current
    const rawY = e.touches[0].clientY - startY.current
    // 首次判定滑动主轴：纵向占优 → 让位给列表滚动，本次不横移；横向占优 → 接管为存对子右滑。
    if (axis.current === 'none') {
      if (Math.abs(rawX) < 6 && Math.abs(rawY) < 6) return
      axis.current = Math.abs(rawX) > Math.abs(rawY) ? 'x' : 'y'
    }
    if (axis.current !== 'x') return
    moved.current = true
    const d = Math.max(0, Math.min(rawX, 120))   // 仅右移、封顶 120px
    dxRef.current = d
    setDx(d)
  }
  const onTouchEnd = (): void => {
    if (!dragging.current) return
    dragging.current = false
    const cur = dxRef.current
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // 弹回原位（reduced-motion 不做过渡）
    setAnimated(!reduce)
    dxRef.current = 0
    setDx(0)
    if (cur > SWIPE_SAVE_THRESHOLD) onSave()
    window.setTimeout(() => setAnimated(false), 180)
  }

  const overThreshold = dx > SWIPE_SAVE_THRESHOLD

  return (
    <div className="relative rounded-[14px] overflow-hidden">
      {/* 右滑绿底书签层：卡片右移时从左侧透出；越阈图标 Bookmark → BookmarkCheck，给存对子的即时预告 */}
      <div className="absolute inset-0 bg-tag-success-bg flex items-center pl-5" aria-hidden="true">
        <span className="text-tag-success-text">
          {overThreshold ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}
        </span>
      </div>

      {/* 卡片本体（可横移）。整卡可点：role=button + 键盘（回车/空格切换选中）。onKeyDown 仅处理源于卡片自身的按键。 */}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => { if (!moved.current) onToggle() }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: `translateX(${dx}px)`, transition: animated ? 'transform 0.18s ease' : 'none' }}
        className={`relative bg-white rounded-[14px] overflow-hidden flex cursor-pointer border border-black/[0.05] transition-shadow duration-200 ${
          selected ? 'shadow-[0_2px_16px_rgba(212,135,90,0.12)]' : 'shadow-[0_1px_8px_rgba(0,0,0,0.06)]'
        }`}
      >
        {/* 左侧竖条 */}
        <div className="w-[4px] flex-shrink-0 self-stretch">
          {selected ? (
            <div className="w-full h-full" style={{ background: BRAND_GRADIENT_VERTICAL }} />
          ) : (
            <div className="w-full h-full bg-transparent" />
          )}
        </div>

        <div className="flex-1 p-4 min-w-0">
          <div className="flex items-center gap-2 mb-2.5 pr-9">
            <PartTag label={`Part ${question.part}`} />
            <Tag variant="green" label={question.dimension} />
            {question.is_new && <Tag variant="green" label="新题" />}
            {!isPrimaryMatch && !isHighMatch && (
              <span className="text-[10px] font-medium px-[8px] py-[3px] rounded-full text-brand-primary-dark bg-brand-primary/10 border border-brand-primary/30">
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
              className="px-3 py-1.5 min-h-[44px] flex-shrink-0"
            >
              题目分析
              <ArrowRight size={12} />
            </Chip>
          </div>
        </div>

        {/* 右上角三态书签（右滑的 a11y 兜底：可聚焦、可点存题卡；已存显 BookmarkCheck、存中显 spinner） */}
        <AnkiBookmarkButton
          state={saveState}
          onSave={onSave}
          className="absolute top-1 right-1"
        />
      </div>
    </div>
  )
}
