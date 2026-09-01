/**
 * @module   MatchedQuestionCard
 * @desc     匹配页单题卡片（移动端）— 复用现有视觉，数据来自真实匹配结果。
 *           动作行是【两个平权入口】：「题目分析」（跳 /analysis）与「开始练习」（直达 /practice），
 *           同款渐变胶囊、不分主次、一左一右分置（差异只写在父容器的 justify 上，两颗按钮 class 逐字相同）；
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
 *           推荐题提示「试试这道题吧」= 内容流首行的【纯文字 + 小 ✨】（2026-09-01 产品方拍板，
 *           由此前的绿色 Tag 胶囊改来）。⚠️ 它曾经【骑在卡片左边框上】（绝对定位向左出挑 8px、
 *           aria-hidden，读屏另由卡内首位的 sr-only 承担）；改纯文字后骑边必须一并撤销 ——
 *           无底色的文字一半悬在卡外会读成渲染错误，那个位置只有带填充的角标撑得住。
 *           回到内容流后，sr-only 兜底、内容区的 pt-11 让位、桌面左栏滚动容器的 -ml-3 pl-3 防裁切
 *           这三样为骑边搭的机制全部随之拆除，别当成漏改加回来。
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { Sparkles } from 'lucide-react'
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
    // 外层容器：原先带 rounded-[14px] overflow-hidden，唯一职责是裁右滑绿底层；绿底层随手势一并删了。
    // ⚠️ 它一度还承担「让骑边标签能向左出挑而不被裁」，但标签已于 2026-09-01 收回卡内 ——
    //    所以这层现在只是个不再裁切的普通包裹，卡片本体自带圆角与 overflow-hidden，不依赖它。
    //    留着是因为拆掉要连带动 DOM 层级、收益为零；哪天顺手清理可以合并进本体。
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
        {/* 左侧竖条 */}
        <div className="w-[4px] flex-shrink-0 self-stretch">
          {selected ? (
            <div className="w-full h-full" style={{ background: BRAND_GRADIENT_VERTICAL }} />
          ) : (
            <div className="w-full h-full bg-transparent" />
          )}
        </div>

        <div className="flex-1 p-4 min-w-0">
          {/* 推荐提示：2026-09-01 产品方拍板由绿色 Tag 胶囊改为【纯文字 + 小 ✨】。
              ⚠️ 连带把标签从「骑在卡片左边框上」收回卡内：无底色的纯文字一半悬在卡外
                 会读成渲染错误，骑边这个位置只有带填充的角标撑得住。
              ⚠️ 文字用 v2-text-secondary（压白底 6.47:1）而非品牌色：本项目已有判例
                 ——brand-primary-dark 压浅底约 3.86:1，小字远不达 WCAG AA（见下方「需切换角度」那条）。
                 颜色只给 ✨ 图标，既有 HomeDesktop 的同款用法。
              回到内容流后不再需要 sr-only 兜底：它本来就是为「视觉标签在卡外、aria-hidden」配的。 */}
          {recommended && (
            <p className="flex items-center gap-1 text-[0.6875rem] text-v2-text-secondary mb-2">
              <Sparkles size={12} className="text-brand-primary flex-shrink-0" />
              试试这道题吧
            </p>
          )}
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
              【排布沿革，2026-09-01 一天内三次拍板，别再来回改】
                ① justify-between 贴两端 → 判「像两件不相干的事」
                ② justify-center + 固定 gap 成组居中 → 判「还要更开、要一左一右、但别贴边框」
                ③ 回到 justify-between，两端落在内容区 p-4 的内边距上 —— 那 16px 就是留给边框的间距。
              gap-2 现在只作「快贴上时」的兜底，不再决定两颗的距离（距离由容器宽度决定）。
              e.stopPropagation() 不能省：卡片本体是 role="button"，不阻止冒泡会连带触发选中切换。
              ⚠️ 判别式必须写 `=== 'text'`，绝不能写真值判断：practiceVariant 在 'chip' 形态下是可选的、
                 实际常常是 undefined，写成 `props.practiceVariant ? …` 会让常规态整个走错分支。
                 （桌面 DetailPane 的 lowTone 是布尔可以真值判断 —— 两端形似而不神似，照抄必翻车。）
              ⚠️ 排布只写在父容器的 justify 上：两颗 Chip 的 class 必须逐字相同，这是「平权」的物理保障；
                 也不用 flex-row-reverse / order-*，那会让 DOM 顺序 ≠ 视觉顺序，打破 Tab 与朗读顺序。 */}
          {/* 与桌面同步：justify-between（一左一右），两端落在内容区 p-4 的内边距上 ——
              那 16px 就是「距离卡片边框保留的间距」。
              ⚠️ 改回 justify-between 顺带消掉了上一版 gap-20 的溢出隐患：
                 固定 gap 在特大字体档下会把两颗顶出卡片（本行无 flex-wrap、Chip 又是 flex-shrink-0），
                 而 justify-between 是「有多少宽用多少」，永远撑不破。gap-2 只作快贴上时的兜底。 */}
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
              </button>
            ) : (
              <>
                <Chip
                  variant="gradient"
                  onClick={(e) => { e.stopPropagation(); onAnalyze() }}
                  ariaLabel={actionAriaLabel(ANALYZE_LABEL, enText)}
                  /* ⚠️【2026-09-01 产品方真机否掉了原来的写法，别改回去】原为
                     `px-3 py-1.5 min-h-[44px]`，出发点是 WCAG 2.5.5 的 44px 触控目标，
                     但那是把「命中区要 44」这条要求写到了【可见胶囊】的盒子上：
                     结果这两颗比同屏 Part 筛选 chip（MatchingMobile.tsx:128，同为 Chip md）高 47%、
                     左右还各窄 2px（px-3 覆盖了 md 的 px-3.5，cn() 是 twMerge、真的会覆盖）——
                     又高又窄，一眼看出不是一套。
                     ⇒ 可见尺寸交还 Chip 的 md 规格（DESIGN.md:411/414 把「练习/分析」这类小动作
                        点名划给 Chip），命中区改用【伪元素外扩】，可视尺寸不变。
                     取值依据：md 实测约 30px（12px 字 × 1.5 行高 + py-[5px]×2 + 渐变描边），
                     最小字体档(0.9)约 29.2px，+9px×2 = 47.2px，全档位 ≥44。
                     ⚠️ 本项目已有同款成例：anki/review/page.tsx:352 那排筛选 Chip 用的就是这一串，
                        逐字复用、不自造新数字。
                     ⚠️ 横向只扩 2px：两颗之间 gap-2(8px) − 2×2 = 净空 4px，命中区不重叠，
                        不会出现「点左边那颗却跳去练习」。 */
                  className="flex-shrink-0 relative after:absolute after:-inset-y-[9px] after:-inset-x-[2px] after:content-['']"
                >
                  {ANALYZE_LABEL}
                </Chip>
                <Chip
                  variant="gradient"
                  onClick={(e) => { e.stopPropagation(); props.onPracticeDirect() }}
                  ariaLabel={actionAriaLabel(PRACTICE_LABEL, enText)}
                  /* class 串必须与上面那颗【逐字相同】——这是「平权」唯一的物理保障，理由见上方长注释 */
                  className="flex-shrink-0 relative after:absolute after:-inset-y-[9px] after:-inset-x-[2px] after:content-['']"
                >
                  {PRACTICE_LABEL}
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

    </div>
  )
}
