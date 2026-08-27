/**
 * @module   MatchedQuestionCard
 * @desc     匹配页单题卡片（移动端）— 复用现有视觉，数据来自真实匹配结果。
 *           动作行是【两个平权入口】：「题目分析」（跳 /analysis）与「开始练习」（直达 /practice），
 *           同款渐变胶囊、不分主次、左右分置（差异只写在父容器的 justify 上，两颗按钮 class 逐字相同）；
 *           低相关态（practiceVariant='text'）只保留文本级分析入口，练习入口在类型上就不存在（见 ActionProps）。
 *           「存对子」只有一条途径：右上角三态书签按钮（无条件渲染、可聚焦、可点）。三态：存中
 *           （spinner + aria-live 播报）/ 已存 / 未存。失败由外壳 Toast 呈现、回未存态。
 *
 *           ⚠️【2026-08-27 为什么删掉了右滑存对子】原本还有一条右滑手势（右移 > 60px 触发，
 *           带绿底拼图层与松手弹回动画），连同 SWIPE_SAVE_THRESHOLD、六个 ref、三个 onTouch* 一并删净。
 *           三条理由：① 右上角书签按钮本就是【无条件渲染、三态齐全】的同功能入口（顶注旧文自称
 *           「右滑的 a11y 兜底、右滑绝不是唯一途径」），删后功能面零损失；② 全仓无任何测试覆盖右滑 ——
 *           一条没人守得住的隐藏交互；③ 裁绿底层所需的 overflow-hidden 挡住了推荐标签向左出挑。
 *
 *           推荐题标签「试试这道题吧」【骑在卡片左边框上】（向左出挑 8px，不向上 —— 向上会撞
 *           GroupHeader 的分隔线）。已知代价：它会压住选中态那根 4px 渐变竖条顶端约 26px；
 *           骑边与「竖条完整」二者不可兼得，产品方选了骑边。视觉标签 aria-hidden，读屏文本另由
 *           卡内首位的 sr-only 承担，保证朗读顺序是「试试这道题吧 → Part → …」且只念一遍。
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { ArrowRight } from 'lucide-react'
import PartTag from '@/components/PartTag'
import Tag from '@/components/Tag'
import Chip from '@/components/Chip'
import AnkiBookmarkButton, { type AnkiSaveState } from '@/components/anki/AnkiBookmarkButton'
import type { MatchedQuestion } from '@/lib/types'
import { BRAND_GRADIENT_VERTICAL } from '@/lib/constants'

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
  /** 触发存对子（点右上角书签）。已存/存中态由按钮自身短路，不重复调用。 */
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

  return (
    // 不裁切的定位容器：原先这层带 rounded-[14px] overflow-hidden，唯一职责是裁右滑绿底层；
    // 绿底层已删，裁切也就没有消费者了（卡片本体自带同款圆角与 overflow-hidden）。
    // 去掉裁切正是推荐标签能向左出挑 8px 的前提，所以刻意不新加一层 DOM。
    <div className="relative">
      {/* 卡片本体。整卡可点：role=button + 键盘（回车/空格切换选中）。onKeyDown 仅处理源于卡片自身的按键。
          onClick 原为 `if (!moved.current) onToggle()`，moved 只由已删的 onTouchMove 写过；手势删掉后
          它恒为 false、那层判断恒真，故直接 onToggle —— 点击行为与改动前逐字等价。 */}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
        }}
        className={`relative bg-white rounded-[14px] overflow-hidden flex cursor-pointer border border-black/[0.05] transition-shadow duration-200 ${
          selected ? 'shadow-[0_2px_16px_rgba(212,135,90,0.12)]' : 'shadow-[0_1px_8px_rgba(0,0,0,0.06)]'
        }`}
      >
        {/* 推荐题的读屏文本：必须是卡内第一个子元素，可访问名才按「试试这道题吧 → Part → …」顺序拼。
            视觉标签在卡外、aria-hidden，两者合起来只念一遍。 */}
        {recommended && <span className="sr-only">试试这道题吧</span>}

        {/* 左侧竖条 */}
        <div className="w-[4px] flex-shrink-0 self-stretch">
          {selected ? (
            <div className="w-full h-full" style={{ background: BRAND_GRADIENT_VERTICAL }} />
          ) : (
            <div className="w-full h-full bg-transparent" />
          )}
        </div>

        {/* 推荐态把上内边距从 4 撑到 11：骑边标签纵向仍压在卡片上内边距区内，不撑就会盖住 PartTag 行。
            ① 必须拆成 px-/pb-/pt- 三段，不能写 p-4 再补 pt-11 靠类顺序赢（这串没走 twMerge，脆）；
            ② 必须用 rem 制的 pt-11 而不是 pt-[44px]：字体档放大时标签跟着长高，px padding 不长。 */}
        <div className={`flex-1 px-4 pb-4 min-w-0 ${recommended ? 'pt-11' : 'pt-4'}`}>
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

          {/* 动作行：两个入口【平权】—— 同一款渐变胶囊、同一组内边距，不分主次，且左右分置。
              e.stopPropagation() 不能省：卡片本体是 role="button"，不阻止冒泡会连带触发选中切换。
              ⚠️ 判别式必须写 `=== 'text'`，绝不能写真值判断：practiceVariant 在 'chip' 形态下是可选的、
                 实际常常是 undefined，写成 `props.practiceVariant ? …` 会让常规态整个走错分支。
                 （桌面 DetailPane 的 lowTone 是布尔可以真值判断 —— 两端形似而不神似，照抄必翻车。）
              ⚠️ 分置只写在父容器的 justify 上：两颗 Chip 的 class 必须逐字相同，这是「平权」的物理保障；
                 也不用 flex-row-reverse / order-*，那会让 DOM 顺序 ≠ 视觉顺序，打破 Tab 与朗读顺序。 */}
          <div className={`flex items-center gap-2 mt-3 ${
            props.practiceVariant === 'text' ? 'justify-end' : 'justify-between'
          }`}>
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

        {/* 右上角三态书签 —— 存题卡的唯一入口（无条件渲染、可聚焦、可点；已存显 BookmarkCheck、存中显 spinner） */}
        <AnkiBookmarkButton
          state={saveState}
          onSave={onSave}
          className="absolute top-1 right-1"
        />
      </div>

      {/* 推荐题的骑边视觉标签：卡片本体之后、定位容器之内，向左出挑 8px 压在左边框上。
          top-2 而非 -top-2：推荐题几乎总是列表第一张，向上出挑会撞 GroupHeader 那条分隔线。
          已知代价：标签会压住选中态 4px 渐变竖条顶端约 26px —— 骑边与「竖条完整」不可兼得，产品方选骑边。
          aria-hidden + pointer-events-none：朗读交给卡内首位的 sr-only，点击照旧穿透给整卡。 */}
      {recommended && (
        <span aria-hidden="true" className="pointer-events-none absolute top-2 -left-2 z-10">
          <Tag variant="green" label="试试这道题吧" />
        </span>
      )}
    </div>
  )
}
