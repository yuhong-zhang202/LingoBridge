/**
 * @module   MatchedQuestionCard
 * @desc     匹配页单题卡片（移动端）— 复用现有视觉，数据来自真实匹配结果。
 *           动作行是【两个平权入口】：「题目分析」（跳 /analysis）与「开始练习」（直达 /practice），
 *           同款渐变胶囊、不分主次；低相关态（practiceVariant='text'）只保留文本级分析入口，
 *           练习入口在类型上就不存在（见 ActionProps）。另有「存对子」：
 *           右滑存（绿底拼图层，右移 > 60px 触发、松手弹回并切已存态）+ 右上角三态书签按钮（右滑的
 *           a11y 兜底，右滑绝不是唯一途径）。图标统一用 lucide Puzzle（结对语义）。三态：存中（spinner +
 *           aria-live 播报）/ 已存（实心 Puzzle，右滑短路）/ 未存。失败由外壳 Toast 呈现、回未存态。
 *           reduced-motion 下弹回不做动画。
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { useRef, useState } from 'react'
import { ArrowRight, Puzzle } from 'lucide-react'
import PartTag from '@/components/PartTag'
import Tag from '@/components/Tag'
import Chip from '@/components/Chip'
import AnkiBookmarkButton, { type AnkiSaveState } from '@/components/anki/AnkiBookmarkButton'
import type { MatchedQuestion } from '@/lib/types'
import { BRAND_GRADIENT_VERTICAL } from '@/lib/constants'

/** 右滑触发存对子的位移阈值（px）。 */
const SWIPE_SAVE_THRESHOLD = 60

/** 动作按钮可访问名称里题面的截断长度（超出加省略号）。 */
const ARIA_LABEL_TEXT_MAX = 40

/**
 * 动作按钮的可访问名称，形如「题目分析：Describe a time you helped someone」。
 *
 * 【为什么必须带题面】一屏最多 6 颗按钮却只有两种文字（题目分析 / 开始练习），读屏用户按按钮列表
 * 导航时根本分不清哪颗属于哪道题。可访问名称属 WCAG 2.4.6，**与「aria-live 长内容只播状态不念全文」
 * 那条铁律不冲突** —— 后者管的是播报（见 A11yAnnouncer），不是可访问名。
 * 题面仍截断：可访问名不是朗读全文的地方。
 *
 * @param  action  动作名（题目分析 / 开始练习）
 * @param  enText  题面（Part 2 取 cue_card_title，其余取 question_text）
 * @returns        拼好的 aria-label
 */
export function actionAriaLabel(action: string, enText: string): string {
  const t = enText.length > ARIA_LABEL_TEXT_MAX ? `${enText.slice(0, ARIA_LABEL_TEXT_MAX)}…` : enText
  return `${action}：${t}`
}

/** 两端共用的动作文案（改一处即两端同改，避免文案漂移） */
const ANALYZE_LABEL = '题目分析'
const PRACTICE_LABEL = '开始练习'

interface BaseProps {
  question: MatchedQuestion
  selected: boolean
  onToggle: () => void
  /** 进题目分析（跳 /analysis）。原名 onPractice —— 名字与行为不符，2026-08-27 正名。 */
  onAnalyze: () => void
  isPrimaryMatch: boolean
  /** 当前题卡属于高匹配组时传 true，高匹配组一律不显示"需切换角度"标签 */
  isHighMatch: boolean
  /** 是否为定稿后按全局排序选出的唯一推荐题。 */
  recommended: boolean
  /** 是否允许显示「需切换角度」标签。低相关态传 false：那个语境下一道题都不能直接用，
   *  只给一部分卡挂标签等于暗示没挂的那几道可以直接用。 */
  showSwitchTag?: boolean
  /** 存对子三态（存中/已存/未存）。 */
  saveState: AnkiSaveState
  /** 触发存对子（右滑越阈 / 点书签）。已存/存中态由本组件短路，不重复调用。 */
  onSave: () => void
}

/**
 * 卡片底部动作区的两种形态 —— **低相关态在类型上就没有练习入口**。
 *
 * ⚠️【为什么把 onPracticeDirect 从 'text' 形态的类型里摘掉（2026-08-27 产品方拍板）】
 *   低相关态那 4 张卡是「我们确实翻遍题库了」的佐证、不是备选题，只保留低强度的文本级
 *   「题目分析」，绝不出「开始练习」—— 出了就等于把一道用不上的题推去开口说。
 *   **刻意用类型摘掉而不是留一个运行时分支靠注释约束**：将来谁想给低相关档加练习入口，
 *   tsc 会当场把他挡在这条决定面前。成例见 MatchingDesktop 的 TierBadge。
 */
type ActionProps =
  | {
      /** 'chip'（默认）= 两个平权入口，均为渐变胶囊 */
      practiceVariant?: 'chip'
      /** 直接开始练习（跳 /practice，跳过分析页） */
      onPracticeDirect: () => void
    }
  | {
      /** 'text' = 低相关态：只有低强度文本级「题目分析」，没有练习入口 */
      practiceVariant: 'text'
      onPracticeDirect?: never
    }

type Props = BaseProps & ActionProps

/**
 * 匹配页单题卡片
 * @param props 见 BaseProps（题目/选中/存对子）与 ActionProps（动作区形态）；
 *              刻意整体接 props 而不解构 practiceVariant —— 靠它做判别联合收窄，
 *              'text' 形态下 onPracticeDirect 在类型上不存在。
 */
export default function MatchedQuestionCard(props: Props) {
  const {
    question, selected, onToggle, onAnalyze, isPrimaryMatch, isHighMatch, recommended,
    showSwitchTag = true, saveState, onSave,
  } = props
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
      {/* 右滑绿底拼图层：卡片右移时从左侧透出；越阈图标由描边 Puzzle → 实心 Puzzle，给存对子的即时预告。
          拼图用品牌橙（brand-primary）= 存对子已存色（与角标已存态同色）；绿底保留为右滑亲和背景。 */}
      <div className="absolute inset-0 bg-tag-success-bg flex items-center pl-5" aria-hidden="true">
        <span className="text-brand-primary">
          <Puzzle size={20} className={overThreshold ? 'fill-current' : ''} />
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
          {recommended && <Tag variant="green" label="试试这道题吧" className="mb-2.5" />}
          <div className="flex items-center gap-2 mb-2.5 pr-9">
            <PartTag label={`Part ${question.part}`} />
            <Tag variant="green" label={question.dimension} />
            {question.is_new && <Tag variant="green" label="新题" />}
            {showSwitchTag && !isPrimaryMatch && !isHighMatch && (
              // 文字色由 brand-primary-dark 改 v2-text-secondary：前者压 brand-primary/10 底约 3.86:1，
              // 10px 字远不达 WCAG AA
              <span className="text-[0.625rem] font-medium px-[8px] py-[3px] rounded-full text-v2-text-secondary bg-brand-primary/10 border border-brand-primary/30">
                需切换角度
              </span>
            )}
          </div>

          <p className="text-[1rem] font-bold text-v2-text-primary leading-snug">{enText}</p>
          {zhText && <p className="text-[0.75rem] text-v2-text-muted mt-0.5">{zhText}</p>}

          {/* 动作行：两个入口【平权】—— 同一款渐变胶囊、同一组内边距，不分主次。
              e.stopPropagation() 不能省：卡片本体是 role="button"，不阻止冒泡会连带触发选中切换。 */}
          <div className="flex items-center justify-end gap-2 mt-3">
            {props.practiceVariant === 'text' ? (
              <button
                onClick={(e) => { e.stopPropagation(); onAnalyze() }}
                aria-label={actionAriaLabel(ANALYZE_LABEL, enText)}
                className="min-h-[44px] inline-flex items-center gap-1 px-1 text-[0.8125rem] font-medium text-v2-text-secondary active:opacity-60"
              >
                {ANALYZE_LABEL}
                <ArrowRight size={12} />
              </button>
            ) : (
              <>
                <Chip
                  variant="gradient"
                  onClick={(e) => { e.stopPropagation(); onAnalyze() }}
                  ariaLabel={actionAriaLabel(ANALYZE_LABEL, enText)}
                  // min-h-[44px] 必须保留：Chip 的 md 尺寸 py-[5px] 裸高约 26px，不足触控目标
                  className="px-3 py-1.5 min-h-[44px] flex-shrink-0"
                >
                  {ANALYZE_LABEL}
                  <ArrowRight size={12} />
                </Chip>
                <Chip
                  variant="gradient"
                  onClick={(e) => { e.stopPropagation(); props.onPracticeDirect() }}
                  ariaLabel={actionAriaLabel(PRACTICE_LABEL, enText)}
                  className="px-3 py-1.5 min-h-[44px] flex-shrink-0"
                >
                  {PRACTICE_LABEL}
                  <ArrowRight size={12} />
                </Chip>
              </>
            )}
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
