/**
 * @module   QuestionFlashCard
 * @desc     Anki「题卡」分点式卡背（v2）：正面题面 / 点击翻面看逐点英文例句 / 左右滑动评估 SRS / 逐点播放英文例句。
 *           卡背 part1/2/3 统一「序号脊柱」布局（不再按 part 分 A/B 变体）：
 *             - 每点：StepNum 序号圈 + 同段内联「标题：解释」一行（标题粗、解释次色），英文例句当主角落在下一行，
 *               播放按钮 🔊 跟英文例句同行右侧（朗读的就是这句，复用 FlashCard 的 speechSynthesis 发音）；无折叠/截断（产品方明确不要）。
 *             - part1（2 点）点间距放大（gap-8/10），part2/3（3 点）保持 gap-5/6，避免大卡里 2 点挤在中间。
 *             - 脊柱（序号+中文标题+中文说明）恒显不塌；仅「英文例句格」按四态分流（该点 en===null 时）：
 *               生成中（hasCorpus 且未生成完 → 浅字「例句生成中…」）/ 生成完但这点没料（hasCorpus 且生成完 →
 *               浅字「这点你没讲到」，绝不再说生成中）/ 未绑语料（留白）；三态皆非交互、不显播放按钮。
 *               仅「未绑语料且全空」的题在卡底显一条邀请式 CTA「分享你的想法 ›」——经宿主 onSupplement 接
 *               /write?qid=（雅思文本输入页，读题做上下文、可切语音、提交后走 restructure→analysis→practice 绑该题）；
 *               匿名用户点它则弹注册引导（宿主用 AnkiRegisterGate）。旧「去题库找这道题 / 绑一句语料生成例句」均已撤。
 *
 *   翻面机制沿用 FlashCard 范式但改用 grid 双面同格叠放（gridArea 1/1）：容器行高取较高面（背面满点），
 *   背面撑开不被裁 —— 根治旧「背面 absolute inset-0 被锁死在正面高度、第 3 点例句被 overflow-hidden 切掉」。
 *   受控重复：FlashCard 绑 PhraseCard、卡背结构完全不同，无法直接复用其 Face，故把 3D 翻面 + 拖拽飞出 +
 *   键盘 ←→ 的机制在此重写一份并补齐 a11y；差异记账、不改 FlashCard 自身。
 *   a11y（ux 点名硬伤，题卡必补）：
 *     - prefers-reduced-motion：翻面 3D 旋转 → 直接切面（单面渲染，全局 globals.css 已把 transition 压到近 0）；
 *       该分支同时是端侧退路（grid + preserve-3d + rotateX 在移动 Safari/微信 WebView 若冲突可整体退回单面）；
 *       滑动飞出 → 即时评级不做大位移。
 *     - 翻面可键盘：整卡 role=button / tabIndex=0 / Space·Enter 翻面 / aria-pressed / 可见焦点环。
 *     - 触控目标 ≥44px（翻面区、播放、卡底绑语料 CTA）；点数组用 <ul><li>；空点态给读屏文本。
 * @author   LingoBridge
 * @created  2026-07-24
 */
'use client'
import { type JSX, type CSSProperties, useState, useRef, useEffect, useCallback } from 'react'
import { RotateCw, ArrowLeft, ArrowRight, Volume2, ChevronRight } from 'lucide-react'
import Tag from '@/components/Tag'
import { BRAND_GRADIENT_VERTICAL, BRAND_GRADIENT_SOFT } from '@/lib/constants'
import { deriveEffectivePoints, splitCueCard, type EffectivePoint } from '@/lib/anki/answer-points'
import type { AnkiCard } from '@/lib/anki/list'

// 超过此位移（px）判定为一次有效滑动
const SWIPE_THRESHOLD = 90
// 左侧竖渐变条（橙→绿）—— 全站复用的品牌竖向渐变
const STRIP = BRAND_GRADIENT_VERTICAL

/** 卡片外壳阴影（与 FlashCard 同款暖阴影）。 */
const CARD_SHADOW = 'shadow-[0_10px_30px_-8px_rgba(180,120,70,0.20),0_3px_10px_rgba(120,90,60,0.06)]'

/** 朗读英文（系统语音）。与 FlashCard 同款实现：先 cancel 掉在读的，再以 en-US 播当前句。 */
function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  window.speechSynthesis.speak(u)
}

interface Props {
  card: AnkiCard
  /** 评级回调（右滑/熟悉=true，左滑/不熟悉=false）。 */
  onGrade: (remembered: boolean) => void
  /**
   * 逐点编辑回调（已下线：卡背改为播放英文例句，不再逐点编辑）。
   * 保留为可选 prop 仅为兼容仍传入它的宿主页；组件内不再调用，对应 PATCH 后端端点保留未删。
   */
  onEditPoint?: (idx: number, en: string) => Promise<void>
  /**
   * 空点态邀请钩子（「分享你的想法」）。注册用户 → 宿主 router.push('/write?qid='+questionId)；
   * 匿名用户 → 宿主弹注册引导（AnkiRegisterGate）。外围未接前可留空 → 钩子降级为不可点提示。
   */
  onSupplement?: (questionId: string) => void
  /**
   * 匿名会话：隐藏 SRS 熟悉/不熟悉评级（评级 POST 需注册）。
   * - 翻面浏览照旧可用；
   * - 左右滑 / 键盘 ←→ 改为【切换卡片】（上一张/下一张，纯浏览、不评级、不落库），经 onPrev/onNext 交宿主换卡索引；
   * - 评级三条入口（左右滑 / 键盘 ←→ / 底部按钮）在匿名下都不会触发 flyOut（flyOut 另有短路双保险）。
   */
  anonymous?: boolean
  /** 匿名浏览：上一张（宿主把当前卡索引 -1，clamp 到 0）。仅 anonymous 时经 ←/右滑触发。 */
  onPrev?: () => void
  /** 匿名浏览：下一张（宿主把当前卡索引 +1，clamp 到末张）。仅 anonymous 时经 →/左滑触发。 */
  onNext?: () => void
}

/**
 * 话题名美化（Part1 话题标用）：topic 是英文全大写、下划线分词（如 HOMETOWN / WORK_OR_STUDY），
 * 直接显难看。转 Title Case + 下划线→空格（HOMETOWN→Hometown，WORK_OR_STUDY→Work Or Study）。
 * 空 / 全空白 → 返回 null（调用侧不渲染话题标）。
 * ⚠️ 这是英文话题名占位；理想是中文话题名 topic_zh，但 AnkiCard 目前无该字段（需后端 get_anki_cards RPC 补），
 *    本轮先用美化英文，不阻塞。
 */
function prettifyTopic(topic: string): string | null {
  const t = topic.trim()
  if (t === '') return null
  return t
    .split(/[_\s]+/)
    .filter((w) => w !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/** 序号圆圈：外层极淡渐变描边 + 内层白底灰数字（与 analysis 侧重点 StepNum 视觉一致）。 */
function StepNum({ n }: { n: number }): JSX.Element {
  return (
    <div style={{ background: BRAND_GRADIENT_SOFT, padding: 1, borderRadius: '50%', width: 20, height: 20, flexShrink: 0 }}>
      <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
        <span className="text-[11px] font-bold leading-none text-neutral-mid">{n}</span>
      </div>
    </div>
  )
}

/** 读系统「减少动态效果」偏好（响应式：跟随系统切换）。 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** 播放按钮（🔊，≥44px 命中区）。复用 FlashCard 的 speechSynthesis 发音，朗读本点英文例句。 */
function PlayBtn({ idx, text }: { idx: number; text: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); speak(text) }}
      aria-label={`朗读第 ${idx + 1} 点例句`}
      className="min-w-[44px] min-h-[44px] -my-2 flex items-center justify-center text-v2-text-muted active:opacity-50"
    >
      <Volume2 size={16} />
    </button>
  )
}

/**
 * 「英文例句格」四态分流（脊柱恒显、只有这一格随状态变）：
 *   A 正常   ：p.en !== null → 英文例句 + 播放键；
 *   C 未绑语料：p.en===null 且 !hasCorpus → 留白（返回 null，什么都不渲染）；
 *   B 生成中 ：p.en===null 且 hasCorpus 且 !genDone → 浅字「例句生成中…」，非交互、无播放键；
 *   B′ 生成完这点没料：p.en===null 且 hasCorpus 且 genDone → 浅字「这点你没讲到」（生成已完成，绝不说生成中）。
 * B/B′ 同字号/色，仅措辞按 genDone 分。
 */
function PointBody({ p, hasCorpus, genDone }: {
  p: EffectivePoint; hasCorpus: boolean; genDone: boolean
}): JSX.Element | null {
  if (p.en !== null) {
    return (
      <div className="flex items-start justify-between gap-2 mt-1.5">
        <p className="text-[15px] lg:text-[17px] text-v2-text-primary leading-[1.5] flex-1 min-w-0" lang="en">{p.en}</p>
        <PlayBtn idx={p.idx} text={p.en} />
      </div>
    )
  }
  if (!hasCorpus) return null
  return (
    <p className="text-[13px] lg:text-[14px] text-v2-text-muted leading-[1.5] mt-1.5">
      {genDone ? '这点你没讲到' : '例句生成中…'}
    </p>
  )
}

/** 序号脊柱单点（part1/2/3 统一）：StepNum + 同段内联「标题：解释」恒显；英文例句格按 A/B/B′/C 分流。 */
function PointRow({ p, hasCorpus, genDone }: {
  p: EffectivePoint; hasCorpus: boolean; genDone: boolean
}): JSX.Element {
  return (
    <li className="flex items-start gap-2.5">
      <StepNum n={p.idx + 1} />
      <div className="flex-1 min-w-0 pt-[1px]">
        <p className="text-[14px] lg:text-[16px] leading-[1.6]">
          <span className="font-semibold text-v2-text-primary">{p.title}</span>
          <span className="text-v2-text-secondary">：{p.desc}</span>
        </p>
        <PointBody p={p} hasCorpus={hasCorpus} genDone={genDone} />
      </div>
    </li>
  )
}

/** 正面题面（三 part 统一极简）：part2 只取题干（丢 cue 段）、part1/3 直接题面；居中英文题 + 一句引导 + 语料概括。 */
function CardFront({ card }: { card: AnkiCard }): JSX.Element {
  const heading = card.part === 2 ? splitCueCard(card.questionText).intro : card.questionText
  // 语料一句话概括：给用户一句「这题你打算讲哪段经历」的上下文；空 / 旧语料降级——整行不渲染。
  const summary = card.corpusSummary?.trim()
  // 仅 Part1：显话题标，给「Is that a big city」这类追问上下文（Part2/3 是 cue card、非话题追问，不加）。
  const topicLabel = card.part === 1 ? prettifyTopic(card.topic) : null
  return (
    <div className="relative flex-1 flex flex-col items-center justify-center text-center">
      <div className="absolute top-0 left-0 flex items-center gap-2">
        <Tag variant="gray" label={`Part ${card.part}`} />
        {topicLabel && (
          <span className="text-[11px] font-medium text-v2-text-muted whitespace-nowrap">{topicLabel}</span>
        )}
      </div>
      <p className="text-[19px] lg:text-[26px] font-semibold text-v2-text-primary leading-[1.5]" lang="en">{heading}</p>
      <p className="text-[13px] lg:text-[15px] text-brand-accent mt-5 lg:mt-7">想想你会怎么答？</p>
      {summary && (
        <p className="text-[13px] lg:text-[14px] text-v2-text-muted leading-[1.5] mt-3 lg:mt-4 max-w-[85%]">
          你的语料 · {summary}
        </p>
      )}
    </div>
  )
}

/** 卡背（分点式）：part1/2/3 统一序号脊柱；点数组用 <ul>，垂直居中。 */
function CardBack({ card, onSupplement }: {
  card: AnkiCard; onSupplement?: (q: string) => void
}): JSX.Element {
  const focusPoints = card.analysis?.focusPoints ?? []
  const points = deriveEffectivePoints(focusPoints, card.generatedAnswer, card.editedAnswer)
  const allEmpty = points.length > 0 && points.every((p) => p.en === null)
  // 「已绑语料」= corpusId 非空 或 isAnswered（用户给这题存过料）。未绑语料才是真·没素材。
  const hasCorpus = card.corpusId !== null || card.isAnswered
  // 「生成已完成」判据 = drain 整卡原子写回后 generatedAnswer 非 null（哪怕所有点留空、JSON 串 "[...]" 仍非
  // null），或用户已逐点编辑（editedAnswer 非空）。据此把「生成中」与「生成完但这点没料」分开——不能用
  // anyEn 启发式（全留空时会永远误判成生成中）。
  const genDone = card.generatedAnswer !== null || (card.editedAnswer !== null && card.editedAnswer !== '')

  if (points.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-center">
        <p className="text-[13px] text-v2-text-muted">这道题还没有可展示的答题要点</p>
      </div>
    )
  }

  // part1 只 2 点、在大卡里会挤在中间 → 点间距放大（产品方真机再上调一档，更开但不散）；part2/3（3 点）本就撑满，保持原 gap。
  const gapClass = points.length === 2 ? 'gap-12 lg:gap-14' : 'gap-5 lg:gap-6'

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      {/* my-auto：内容不足时垂直居中；内容超高（part3 满点+长例句）时外边距收拢、从顶部滚动，
          外层 py 边距恒在、内容不裁不贴框，卡片仍固定同高（统一）。 */}
      <div className="my-auto w-full">
      <ul className={`flex flex-col ${gapClass}`}>
        {points.map((p) => (
          <PointRow key={p.idx} p={p} hasCorpus={hasCorpus} genDone={genDone} />
        ))}
      </ul>
      {/* 卡底 CTA：仅「未绑语料且全空」的题显示。邀请式——分享你的想法（宿主接 /write?qid= 雅思文本输入页，
          匿名则弹注册引导）。不再走旧「去题库找这道题」，也不承诺"点了就生成例句"（那入口并不入队生成）。 */}
      {allEmpty && !hasCorpus && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSupplement?.(card.questionId) }}
          disabled={!onSupplement}
          className="mt-4 min-h-[44px] flex items-center justify-center gap-0.5 text-[14px] font-medium text-brand-primary-dark active:opacity-60 disabled:opacity-70 disabled:cursor-default"
        >
          分享你的想法
          <ChevronRight size={14} />
        </button>
      )}
      </div>
    </div>
  )
}

/**
 * 卡片外壳（承载正/背面内容 + 左渐变条 + 卡片 chrome）。
 * flip3d：3D 双面模式（grid 双面同格叠放）—— 两面各占 gridArea 1/1，容器行高取较高面（背面满点），背面撑开
 *   不被裁；背面 rotateX180 + backfaceVisibility hidden 实现翻面。false = reduced-motion 单面渲染（自适应不裁）。
 * inert：3D 双面模式下两面同时在 DOM，背面虽 backface-hidden 但其内部按钮仍在 Tab 序里 —— 给未激活的一面
 *   挂 inert（读屏隐藏 + 移出 Tab 序 + 禁交互），避免正面时 Tab 到不可见的背面编辑按钮。
 */
function FaceShell({ children, flip3d, back, inert }: {
  children: JSX.Element; flip3d: boolean; back?: boolean; inert?: boolean
}): JSX.Element {
  const style: CSSProperties = flip3d
    ? { gridArea: '1/1', backfaceVisibility: 'hidden', transform: back ? 'rotateX(180deg)' : undefined }
    : {}
  return (
    <div
      className={`relative rounded-[22px] bg-white ${CARD_SHADOW} overflow-hidden`}
      style={style}
      inert={inert}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[5px] z-[1]" style={{ background: STRIP }} aria-hidden="true" />
      <div className="px-[22px] py-[22px] h-[400px] lg:px-10 lg:py-10 lg:h-[460px] flex flex-col">{children}</div>
    </div>
  )
}

export default function QuestionFlashCard({ card, onGrade, onSupplement, anonymous = false, onPrev, onNext }: Props): JSX.Element {
  const reduced = useReducedMotion()
  const [flipped, setFlipped] = useState(false)
  const [dx, setDx] = useState(0)
  const [animated, setAnimated] = useState(false)
  const startX = useRef(0)
  const dxRef = useRef(0) // 最新位移（读它判飞出，避免闭包里的 dx 落后 / 在 setDx 更新器里再套 setDx）
  const dragging = useRef(false)
  const moved = useRef(false)
  const fired = useRef(false)

  // 直接飞出并回调（底部按钮 / 键盘 ←→ / 右滑越阈）；reduced-motion 下即时评级、不做大位移。
  // 匿名短路：评级需注册，匿名一律不飞出、不回调（三入口共用本函数，故右滑也被一并挡住）。
  const flyOut = useCallback((remembered: boolean): void => {
    if (anonymous) return
    if (fired.current) return
    fired.current = true
    if (reduced) { onGrade(remembered); return }
    setAnimated(true)
    setDx(remembered ? 520 : -520)
    window.setTimeout(() => onGrade(remembered), 180)
  }, [reduced, onGrade, anonymous])

  // 键盘 ←→：注册用户 = SRS 评级（→熟悉/←不熟悉）；匿名 = 切卡浏览（→下一张/←上一张，不评级、不落库）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      e.preventDefault()
      if (anonymous) {
        if (e.key === 'ArrowRight') onNext?.()
        else onPrev?.()
        return
      }
      if (e.key === 'ArrowRight') flyOut(true)
      else flyOut(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flyOut, anonymous, onPrev, onNext])

  const toggleFlip = useCallback((): void => { if (!moved.current) setFlipped((f) => !f) }, [])

  // 弹回原位（拖拽未过阈值 / 匿名切卡后当前卡收回中心；切卡时宿主换索引会让本组件按 key 重挂、天然回中）。
  const snapBack = useCallback((): void => {
    setAnimated(true)
    dxRef.current = 0
    setDx(0)
    window.setTimeout(() => setAnimated(false), 180)
  }, [])

  // 整卡键盘翻面（Space/Enter）；仅当事件目标是卡容器本身（非内部控件）才翻，避免抢内部按钮的激活
  const onContainerKeyDown = (e: React.KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleFlip() }
  }

  const onTouchStart = (e: React.TouchEvent): void => {
    startX.current = e.touches[0].clientX
    dragging.current = true
    moved.current = false
    setAnimated(false)
  }
  const onTouchMove = (e: React.TouchEvent): void => {
    if (!dragging.current) return
    const d = e.touches[0].clientX - startX.current
    if (Math.abs(d) > 6) moved.current = true
    dxRef.current = d
    setDx(d)
  }
  const onTouchEnd = (): void => {
    if (!dragging.current) return
    dragging.current = false
    const cur = dxRef.current
    if (anonymous) {
      // 匿名 = 切卡浏览：右滑（cur>0）上一张 / 左滑（cur<0）下一张；不评级、不飞出、不落库。
      // 换卡由宿主换索引触发本组件按 key 重挂（回中心），这里同时 snapBack 兜底（到边界索引不变、不重挂时也归位）。
      if (cur > SWIPE_THRESHOLD) { snapBack(); onPrev?.(); return }
      if (cur < -SWIPE_THRESHOLD) { snapBack(); onNext?.(); return }
      snapBack()
      return
    }
    if (cur > SWIPE_THRESHOLD) { flyOut(true); return }   // flyOut 内部统一处理 reduced（即时评级）/ 非 reduced（飞出动画 + setDx）
    if (cur < -SWIPE_THRESHOLD) { flyOut(false); return }
    snapBack() // 未过阈值：弹回原位
  }

  return (
    <div className="w-full max-w-[400px] lg:max-w-[640px] mx-auto select-none">
      <div
        style={{ transform: `translateX(${dx}px) rotate(${dx * 0.03}deg)`, transition: animated && !reduced ? 'transform 0.2s ease' : 'none' }}
        onClick={toggleFlip}
        onKeyDown={onContainerKeyDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        role="button"
        tabIndex={0}
        aria-pressed={flipped}
        aria-label={
          (flipped ? '题卡背面（答题要点），按空格或回车翻回正面' : '题卡正面（题目），按空格或回车翻面看答题要点')
          + (anonymous ? '；匿名浏览，按左右方向键或左右滑动切换上一张/下一张卡片' : '')
        }
        className="outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40 rounded-[22px]"
      >
        {reduced ? (
          // reduced-motion：不做 3D 旋转，单面渲染直接切面（全局 CSS 已把 transition 压到近 0 = 淡入即时）；
          // 单面天然自适应内容高、不裁，也是 grid+3D 端侧冲突时的整体退路。
          <FaceShell flip3d={false}>
            {flipped
              ? <CardBack card={card} onSupplement={onSupplement} />
              : <CardFront card={card} />}
          </FaceShell>
        ) : (
          <div style={{ perspective: 1000 }}>
            {/* grid 双面同格叠放：两面各 gridArea 1/1，行高取较高面（背面满点撑开），根治背面被裁 */}
            <div className="grid transition-transform duration-300" style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateX(180deg)' : 'none' }}>
              <FaceShell flip3d inert={flipped}>
                <CardFront card={card} />
              </FaceShell>
              <FaceShell flip3d back inert={!flipped}>
                <CardBack card={card} onSupplement={onSupplement} />
              </FaceShell>
            </div>
          </div>
        )}
      </div>

      {anonymous ? (
        // 匿名：评级需注册（隐藏熟悉/不熟悉）；左右滑 / ←→ = 切卡浏览。正面提示可翻面、背面提示注册记录进度，两态都点出可切卡。
        <p className="text-center text-[13px] text-v2-text-muted mt-[18px] lg:mt-6">
          {flipped ? '左右切卡浏览 · 注册后记录复习进度' : '点击翻面看要点 · 左右切卡浏览'}
        </p>
      ) : !flipped ? (
        <p className="text-center text-[13px] text-v2-text-secondary mt-[18px] lg:mt-6 flex items-center justify-center gap-1.5">
          <RotateCw size={14} />点击卡片翻面看答题要点
        </p>
      ) : (
        <div className="flex items-center justify-center gap-5 mt-[18px] lg:mt-6">
          <button type="button" onClick={() => flyOut(false)} className="flex items-center gap-1 text-[13px] text-error active:opacity-60">
            <ArrowLeft size={15} />不熟悉
          </button>
          <span className="text-[12px] text-v2-text-muted">左右滑动</span>
          <button type="button" onClick={() => flyOut(true)} className="flex items-center gap-1 text-[13px] text-tag-success-text active:opacity-60">
            熟悉<ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
