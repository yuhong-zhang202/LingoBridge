/**
 * @module   QuestionFlashCard
 * @desc     Anki「题卡」分点式卡背（v0.3）：正面题面 / 点击翻面看逐点英文例句 / 左右滑动评估 SRS / 逐点行内编辑。
 *           一套组件按 part 切卡背布局变体：
 *             - A「脊柱」布局（part1/2）：中文标题左对齐成脊柱（StepNum 序号圈 + 标题），英文例句当主角，
 *               desc 默认 line-clamp 折叠、点「›」展开；
 *             - B「台阶卡」布局（part3）：每点包一层 cream-soft 圆角小卡（立场/理由/延伸逻辑分块）。
 *           空点态（noMaterial）：标题照常显示（结构不塌），英文位换虚线框 + 补料钩子（引导，不用告警色）。
 *
 *   翻面/滑动机制沿用 FlashCard 范式（受控重复：FlashCard 绑 PhraseCard、卡背结构完全不同，无法直接复用其
 *   Face，故把 3D 翻面 + 拖拽飞出 + 键盘 ←→ 的机制在此重写一份并补齐 a11y；差异记账、不改 FlashCard 自身）。
 *   a11y（ux 点名硬伤，题卡必补）：
 *     - prefers-reduced-motion：翻面 3D 旋转 → 直接切面（淡入，全局 globals.css 已把 transition 压到近 0）；
 *       滑动飞出 → 即时评级不做大位移。
 *     - 翻面可键盘：整卡 role=button / tabIndex=0 / Space·Enter 翻面 / aria-pressed / 可见焦点环。
 *     - 触控目标 ≥44px（翻面区、编辑、补料钩子、desc 展开）；点数组用 <ul><li>；空点态给读屏文本。
 * @author   LingoBridge
 * @created  2026-07-24
 */
'use client'
import { type JSX, type CSSProperties, useState, useRef, useEffect, useCallback } from 'react'
import { RotateCw, ArrowLeft, ArrowRight, Pencil, ChevronRight } from 'lucide-react'
import { BRAND_GRADIENT_VERTICAL, BRAND_GRADIENT_SOFT } from '@/lib/constants'
import { deriveEffectivePoints, splitCueCard, type EffectivePoint } from '@/lib/anki/answer-points'
import type { AnkiCard } from '@/lib/anki/list'

// 超过此位移（px）判定为一次有效滑动
const SWIPE_THRESHOLD = 90
// 左侧竖渐变条（橙→绿）—— 全站复用的品牌竖向渐变
const STRIP = BRAND_GRADIENT_VERTICAL
// desc 折叠行数（真机调松紧的唯一旋钮：改这一个常量即可，见任务「desc 折叠做成易调」）
const DESC_CLAMP_LINES = 1

/** 卡片外壳阴影（与 FlashCard 同款暖阴影）。 */
const CARD_SHADOW = 'shadow-[0_10px_30px_-8px_rgba(180,120,70,0.20),0_3px_10px_rgba(120,90,60,0.06)]'

interface Props {
  card: AnkiCard
  /** 评级回调（右滑/熟知=true，左滑/重复=false）。 */
  onGrade: (remembered: boolean) => void
  /** 逐点保存：写第 idx 点的英文覆盖（空串=清覆盖回退）。抛错则组件内提示、不吞。 */
  onEditPoint: (idx: number, en: string) => Promise<void>
  /** 补料钩子入口（空点态「去补一句语料」）。外围导航未接前可留空 → 钩子降级为不可点提示。 */
  onSupplement?: (questionId: string) => void
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

/** 逐点编辑控制（从主组件下发，单点独占编辑态供键盘守卫）。 */
interface EditControls {
  editingIdx: number | null
  editValue: string
  editSaving: boolean
  editError: string | null
  onStart: (idx: number, current: string) => void
  onChange: (v: string) => void
  onCancel: () => void
  onSave: () => void
}

/** 行内单行编辑器（📝 展开后）：预填原句 → [取消][保存]。键盘事件 stopPropagation 防冒泡触发翻面/评级。 */
function InlineEdit({ edit, idx }: { edit: EditControls; idx: number }): JSX.Element {
  return (
    <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        autoFocus
        value={edit.editValue}
        onChange={(e) => edit.onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation() // 输入框内的方向键/空格/回车归输入框，不冒泡触发翻面或 SRS 评级
          if (e.key === 'Enter') edit.onSave()
          else if (e.key === 'Escape') edit.onCancel()
        }}
        disabled={edit.editSaving}
        aria-label={`编辑第 ${idx + 1} 点的英文例句`}
        className="w-full text-[15px] text-v2-text-primary bg-white border border-brand-primary-light rounded-[10px] px-2.5 py-2 outline-none focus:ring-2 focus:ring-brand-primary/25 disabled:opacity-50"
        lang="en"
      />
      {edit.editError && <p className="text-[12px] text-error mt-1">{edit.editError}</p>}
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); edit.onCancel() }}
          disabled={edit.editSaving}
          className="min-h-[44px] px-3 text-[13px] text-v2-text-muted active:opacity-60 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); edit.onSave() }}
          disabled={edit.editSaving}
          className="min-h-[44px] px-4 text-[13px] font-semibold text-brand-primary-dark active:opacity-60 disabled:opacity-50"
        >
          {edit.editSaving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

/** 空点态：虚线框 + 补料钩子（引导，不用 error/warning 色；读屏可读；钩子 ≥44px）。 */
function EmptyPointBox({ questionId, onSupplement }: { questionId: string; onSupplement?: (q: string) => void }): JSX.Element {
  return (
    <div className="mt-1.5 rounded-[12px] border border-dashed border-warm-line px-3 py-2.5">
      <p className="text-[13px] text-v2-text-muted">这点你还没讲到</p>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onSupplement?.(questionId) }}
        disabled={!onSupplement}
        className="mt-1 min-h-[44px] flex items-center gap-0.5 text-[13px] text-brand-primary-dark active:opacity-60 disabled:opacity-70 disabled:cursor-default"
      >
        补一句语料就能生成例句
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

/** 编辑按钮（📝，≥44px 命中区）。 */
function EditBtn({ idx, current, edit }: { idx: number; current: string; edit: EditControls }): JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); edit.onStart(idx, current) }}
      aria-label={`编辑第 ${idx + 1} 点`}
      className="min-w-[44px] min-h-[44px] -my-2 flex items-center justify-center text-v2-text-muted active:opacity-50"
    >
      <Pencil size={15} />
    </button>
  )
}

/** desc 可展开文本：默认 line-clamp（常量控行数），点「›」展开/收起（≥44px）。 */
function ExpandableDesc({ desc }: { desc: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const clampStyle: CSSProperties = expanded
    ? {}
    : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: DESC_CLAMP_LINES, overflow: 'hidden' }
  return (
    <div className="flex items-start gap-1 mt-1">
      <p className="text-[12px] text-v2-text-muted leading-relaxed flex-1" style={clampStyle}>{desc}</p>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
        aria-expanded={expanded}
        aria-label={expanded ? '收起说明' : '展开说明'}
        className="min-w-[44px] min-h-[44px] -m-2.5 flex items-center justify-center text-v2-text-muted active:opacity-50 flex-shrink-0"
      >
        <ChevronRight size={14} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
    </div>
  )
}

/** 英文例句主角行 / 空点态 / 编辑态 三选一。 */
function PointBody({ p, questionId, edit, onSupplement }: {
  p: EffectivePoint; questionId: string; edit: EditControls; onSupplement?: (q: string) => void
}): JSX.Element {
  if (edit.editingIdx === p.idx) return <InlineEdit edit={edit} idx={p.idx} />
  if (p.noMaterial || p.en === null) return <EmptyPointBox questionId={questionId} onSupplement={onSupplement} />
  return (
    <p className="text-[15px] text-v2-text-primary leading-[1.5] mt-1" lang="en">{p.en}</p>
  )
}

/** A「脊柱」布局单点（part1/2）：StepNum + 标题脊柱、英文主角、desc 折叠。 */
function PointRowA({ p, questionId, edit, onSupplement }: {
  p: EffectivePoint; questionId: string; edit: EditControls; onSupplement?: (q: string) => void
}): JSX.Element {
  return (
    <li className="flex items-start gap-2.5">
      <StepNum n={p.idx + 1} />
      <div className="flex-1 min-w-0 pt-[1px]">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[14px] font-medium text-v2-text-primary leading-[1.6]">{p.title}</p>
          {!p.noMaterial && edit.editingIdx !== p.idx && <EditBtn idx={p.idx} current={p.en ?? ''} edit={edit} />}
        </div>
        <PointBody p={p} questionId={questionId} edit={edit} onSupplement={onSupplement} />
        <ExpandableDesc desc={p.desc} />
      </div>
    </li>
  )
}

/** B「台阶卡」布局单点（part3）：cream-soft 圆角小卡分块。 */
function PointCardB({ p, questionId, edit, onSupplement }: {
  p: EffectivePoint; questionId: string; edit: EditControls; onSupplement?: (q: string) => void
}): JSX.Element {
  return (
    <li className="rounded-[14px] bg-cream-soft px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <StepNum n={p.idx + 1} />
          <p className="text-[14px] font-medium text-v2-text-primary leading-[1.4]">{p.title}</p>
        </div>
        {!p.noMaterial && edit.editingIdx !== p.idx && <EditBtn idx={p.idx} current={p.en ?? ''} edit={edit} />}
      </div>
      <PointBody p={p} questionId={questionId} edit={edit} onSupplement={onSupplement} />
      <ExpandableDesc desc={p.desc} />
    </li>
  )
}

/** 正面题面（part1/3 居中英文题；part2 左对齐 topic + You should say 提示）。 */
function CardFront({ card }: { card: AnkiCard }): JSX.Element {
  if (card.part === 2) {
    const { intro, cue } = splitCueCard(card.questionText)
    const heading = card.cueCardTitle ?? card.topic // cue card 自身标题（如「A Perfect Job」）作 topic 头，兜底 DB 分类
    return (
      <div className="flex-1 flex flex-col justify-center">
        {heading && <p className="text-[12px] font-medium text-brand-primary-dark mb-2">{heading}</p>}
        <p className="text-[17px] font-semibold text-v2-text-primary leading-[1.5]">{intro}</p>
        {cue && (
          <div className="mt-3">
            <p className="text-[12px] font-medium text-v2-text-secondary mb-1">You should say:</p>
            {/* 现库 question_text 为无分隔平铺文本、拆 bullet 缺陷率约 28%（见 answer-points.splitCueCard 注），
                故整块呈现提示体、不伪造 <ul>；真 bullet 需 seed 落结构化字段（数据层，非本批）。 */}
            <p className="text-[14px] text-v2-text-secondary leading-[1.7]" lang="en">{cue}</p>
          </div>
        )}
        <p className="text-[13px] text-brand-accent mt-5">想想你会怎么答？</p>
      </div>
    )
  }
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center">
      <p className="text-[19px] font-semibold text-v2-text-primary leading-[1.5]" lang="en">{card.questionText}</p>
      <p className="text-[13px] text-brand-accent mt-5">想想你会怎么答？</p>
    </div>
  )
}

/** 卡背（分点式）：part1/2 走 A 脊柱、part3 走 B 台阶；点数组用 <ul>。 */
function CardBack({ card, edit, onSupplement }: {
  card: AnkiCard; edit: EditControls; onSupplement?: (q: string) => void
}): JSX.Element {
  const focusPoints = card.analysis?.focusPoints ?? []
  const points = deriveEffectivePoints(focusPoints, card.generatedAnswer, card.editedAnswer)
  const allEmpty = points.length > 0 && points.every((p) => p.noMaterial)
  const isB = card.part === 3

  if (points.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-center">
        <p className="text-[13px] text-v2-text-muted">这道题还没有可展示的答题要点</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <ul className={`flex flex-col ${isB ? 'gap-2.5' : 'gap-4'}`}>
        {points.map((p) => (
          isB
            ? <PointCardB key={p.idx} p={p} questionId={card.questionId} edit={edit} onSupplement={onSupplement} />
            : <PointRowA key={p.idx} p={p} questionId={card.questionId} edit={edit} onSupplement={onSupplement} />
        ))}
      </ul>
      {/* 全空兜底：整卡多点皆空 → 卡底一条补料引导（引导色、非告警）。 */}
      {allEmpty && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSupplement?.(card.questionId) }}
          disabled={!onSupplement}
          className="mt-4 min-h-[44px] flex items-center justify-center gap-0.5 text-[13px] text-brand-primary-dark active:opacity-60 disabled:opacity-70 disabled:cursor-default"
        >
          这道题你的语料还比较少，去补几句
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  )
}

/**
 * 卡片外壳（承载正/背面内容 + 左渐变条 + 卡片 chrome）。
 * inert：3D 双面模式下两面同时在 DOM，背面虽 backface-hidden 但其内部按钮仍在 Tab 序里 —— 给未激活的一面
 * 挂 inert（读屏隐藏 + 移出 Tab 序 + 禁交互），避免正面时 Tab 到不可见的背面编辑按钮。
 */
function FaceShell({ children, layered, flip3d, inert }: {
  children: JSX.Element; layered: boolean; flip3d: boolean; inert?: boolean
}): JSX.Element {
  const style: CSSProperties = flip3d
    ? { backfaceVisibility: 'hidden', transform: layered ? 'rotateX(180deg)' : undefined }
    : {}
  return (
    <div
      className={`${layered ? 'absolute inset-0' : 'relative'} rounded-[22px] bg-white ${CARD_SHADOW} overflow-hidden`}
      style={style}
      inert={inert}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[5px] z-[1]" style={{ background: STRIP }} aria-hidden="true" />
      <div className="px-[22px] pt-[20px] pb-[20px] min-h-[340px] flex flex-col">{children}</div>
    </div>
  )
}

export default function QuestionFlashCard({ card, onGrade, onEditPoint, onSupplement }: Props): JSX.Element {
  const reduced = useReducedMotion()
  const [flipped, setFlipped] = useState(false)
  const [dx, setDx] = useState(0)
  const [animated, setAnimated] = useState(false)
  const startX = useRef(0)
  const dxRef = useRef(0) // 最新位移（读它判飞出，避免闭包里的 dx 落后 / 在 setDx 更新器里再套 setDx）
  const dragging = useRef(false)
  const moved = useRef(false)
  const fired = useRef(false)

  // 逐点编辑态（单点独占；editingIdx 供键盘守卫：编辑时禁 ←→ 评级与翻面键，让方向键归输入框）
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // 直接飞出并回调（底部按钮 / 键盘 ←→）；reduced-motion 下即时评级、不做大位移
  const flyOut = useCallback((remembered: boolean): void => {
    if (fired.current) return
    fired.current = true
    if (reduced) { onGrade(remembered); return }
    setAnimated(true)
    setDx(remembered ? 520 : -520)
    window.setTimeout(() => onGrade(remembered), 180)
  }, [reduced, onGrade])

  // 键盘 ←→ 评级（编辑中禁用，避免抢输入框方向键）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (editingIdx !== null) return
      if (e.key === 'ArrowRight') { e.preventDefault(); flyOut(true) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); flyOut(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingIdx, flyOut])

  const toggleFlip = useCallback((): void => { if (!moved.current) setFlipped((f) => !f) }, [])

  // 整卡键盘翻面（Space/Enter）；仅当事件目标是卡容器本身（非内部控件）才翻，避免抢内部按钮的激活
  const onContainerKeyDown = (e: React.KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return
    if (editingIdx !== null) return
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
    if (cur > SWIPE_THRESHOLD) { flyOut(true); return }   // flyOut 内部统一处理 reduced（即时评级）/ 非 reduced（飞出动画 + setDx）
    if (cur < -SWIPE_THRESHOLD) { flyOut(false); return }
    setAnimated(true) // 未过阈值：弹回原位
    dxRef.current = 0
    setDx(0)
    window.setTimeout(() => setAnimated(false), 180)
  }

  // ── 逐点编辑 handlers ──
  const startEdit = useCallback((idx: number, current: string): void => {
    setEditingIdx(idx)
    setEditValue(current)
    setEditError(null)
  }, [])
  const cancelEdit = useCallback((): void => { setEditingIdx(null); setEditError(null) }, [])
  const saveEdit = useCallback((): void => {
    if (editingIdx === null || editSaving) return
    setEditSaving(true)
    setEditError(null)
    void onEditPoint(editingIdx, editValue)
      .then(() => { setEditingIdx(null) })
      .catch(() => { setEditError('保存失败，请重试') })
      .finally(() => { setEditSaving(false) })
  }, [editingIdx, editValue, editSaving, onEditPoint])

  const edit: EditControls = {
    editingIdx, editValue, editSaving, editError,
    onStart: startEdit, onChange: setEditValue, onCancel: cancelEdit, onSave: saveEdit,
  }

  return (
    <div className="w-full select-none">
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
        aria-label={flipped ? '题卡背面（答题要点），按空格或回车翻回正面' : '题卡正面（题目），按空格或回车翻面看答题要点'}
        className="outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40 rounded-[22px]"
      >
        {reduced ? (
          // reduced-motion：不做 3D 旋转，直接切面（全局 CSS 已把 transition 压到近 0 = 淡入即时）
          <FaceShell layered={false} flip3d={false}>
            {flipped
              ? <CardBack card={card} edit={edit} onSupplement={onSupplement} />
              : <CardFront card={card} />}
          </FaceShell>
        ) : (
          <div style={{ perspective: 1000 }}>
            <div className="relative transition-transform duration-300" style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateX(180deg)' : 'none' }}>
              <FaceShell layered={false} flip3d inert={flipped}>
                <CardFront card={card} />
              </FaceShell>
              <FaceShell layered flip3d inert={!flipped}>
                <CardBack card={card} edit={edit} onSupplement={onSupplement} />
              </FaceShell>
            </div>
          </div>
        )}
      </div>

      {!flipped ? (
        <p className="text-center text-[13px] text-v2-text-secondary mt-[18px] flex items-center justify-center gap-1.5">
          <RotateCw size={14} />点击卡片翻面看答题要点
        </p>
      ) : (
        <div className="flex items-center justify-center gap-5 mt-[18px]">
          <button type="button" onClick={() => flyOut(false)} className="flex items-center gap-1 text-[13px] text-error active:opacity-60">
            <ArrowLeft size={15} />重复
          </button>
          <span className="text-[12px] text-v2-text-muted">左右滑动</span>
          <button type="button" onClick={() => flyOut(true)} className="flex items-center gap-1 text-[13px] text-tag-success-text active:opacity-60">
            熟知<ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
