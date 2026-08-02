/**
 * @module   CollectedCard
 * @desc     素材库「收藏卡片」单卡 —— 手写复刻 feedback 桌面版卡片视觉（胶囊描边标签 + 白底原句框 +
 *           绿底优化框 + 播放按钮），并用一条 GRADIENT_BORDER_STYLE_FULL_OPAQUE 渐变描边裹住卡内容。
 *           不复用 FeedbackCard（其描边只裹卡主体、
 *           且半透明描边在 SwipeToDelete 红底上会透棕，故本卡自画不透明描边）。
 *           enableSwipe=true 时外层包 SwipeToDelete 支持移动端左滑删除；false 时裸渲染（桌面端）。
 *           桌面选择模式：卡体 inert（不可点、不可 Tab、移出无障碍树）+ 同级 stretched 复选覆盖按钮。
 * @author   LingoBridge
 * @created  2026-07-05
 */
'use client'
import { type JSX, useEffect, useRef, useState } from 'react'
import { Volume2, Check } from 'lucide-react'
import PolishNote from '@/components/PolishNote'
import SwipeToDelete from '@/components/library/SwipeToDelete'
import { BRAND_GRADIENT_SOFT, GRADIENT_BORDER_STYLE_FULL_OPAQUE } from '@/lib/constants'
import type { CollectedCard as CollectedCardData } from '@/lib/types'

interface CollectedCardProps {
  /** 卡片数据 */
  card: CollectedCardData
  /** true=移动端（包 SwipeToDelete 支持左滑删除）；false=桌面端（裸渲染） */
  enableSwipe: boolean
  /** 删除回调 */
  onDelete: (id: string) => void
  /** 桌面多选：是否在选择模式（浮出 checkbox、整卡点击切换、禁用内部交互）。移动端不传 */
  selecting?: boolean
  /** 桌面多选：本卡是否被选中 */
  selected?: boolean
  /** 桌面多选：切换选中态 */
  onSelectToggle?: (id: string) => void
}

/** 用浏览器 TTS 读一句英文（与 FeedbackCard 同一实现） */
function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'en-US'
  window.speechSynthesis.speak(utt)
}

/** 胶囊描边标签（复刻 FeedbackCard 非 plain 的 InfoTag：软渐变描边 + 白底 + 深橙字） */
function InfoTag({ text, letterSpacing }: { text: string; letterSpacing: number }) {
  return (
    <div className="flex-shrink-0" style={{ width: 56, height: 24, background: BRAND_GRADIENT_SOFT, borderRadius: 9999, padding: 1 }}>
      <div className="w-full h-full flex items-center justify-center bg-white rounded-full">
        <span className="text-brand-primary-dark" style={{ fontSize: '0.6875rem', fontWeight: 500, lineHeight: 1, letterSpacing }}>
          {text}
        </span>
      </div>
    </div>
  )
}

/** 句子框 + 播放按钮（复刻 FeedbackCard 非 plain：原句白底、优化绿底） */
/** 超过此字数视为「长句」，默认折叠 3 行 +「查看更多」展开（与 SwapCorpusDialog 的 CorpusSummary 同范式）。 */
const SENTENCE_CLAMP_CHARS = 60

/**
 * 句子框（原句/优化）：超长句子默认 line-clamp-3 +「查看更多/收起」切换——收藏卡新版出来前的
 * 过渡方案（产品方定稿：不做框内滚动；默认折叠态所有卡行数一致、组件观感统一，展开是用户主动行为）。
 * 播放按钮绝对定位钉在框右下。
 */
function SentenceBlock({ text, variant }: { text: string; variant: 'original' | 'ai' }) {
  const isAi = variant === 'ai'
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > SENTENCE_CLAMP_CHARS
  const box = isAi ? 'bg-tag-success-bg border border-tag-success-border' : 'bg-white border border-black/[0.07]'
  return (
    <div className={`relative rounded-[14px] px-3 py-2.5 ${box}`}>
      <p className={`text-[0.875rem] leading-relaxed pr-7 ${isAi ? 'text-v2-text-primary' : 'text-v2-text-secondary'} ${isLong && !expanded ? 'line-clamp-3' : ''}`}>
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
          aria-expanded={expanded}
          className="mt-1 min-h-[32px] text-[0.75rem] font-medium text-brand-primary-dark active:opacity-60"
        >
          {expanded ? '收起' : '查看更多'}
        </button>
      )}
      {/* 命中区扩到 40×40（右下对齐 + p-2.5 使图标可视位置仍等效 right-2.5 bottom-2.5） */}
      <button
        onClick={() => speak(text)}
        aria-label="播放"
        className="absolute right-0 bottom-0 min-w-[40px] min-h-[40px] flex items-end justify-end p-2.5 active:opacity-50 transition-opacity"
      >
        <Volume2 size={13} className="text-v2-text-muted" />
      </button>
    </div>
  )
}

/**
 * 解释区：默认展开（产品方定稿——不折叠，一眼可见）。顶部一条极浅实线把「句子对」与解释两段分组。
 * 内两段（语法：/词组优化：）由公用 PolishNote 渲染；老格式 note 由 PolishNote 回退单段展示。
 */
function ExplanationBlock({ note }: { note: string }): JSX.Element {
  return (
    <div className="mt-3 pt-3 border-t border-black/[0.05]">
      <PolishNote note={note} />
    </div>
  )
}

export default function CollectedCard({
  card,
  enableSwipe,
  onDelete,
  selecting = false,
  selected = false,
  onSelectToggle,
}: CollectedCardProps): JSX.Element {
  // 选择模式下把卡体整体设为 inert：内部播放按钮既不可点、也不可 Tab 聚焦，并移出无障碍树，
  // 使同级的覆盖复选按钮成为唯一交互点（旧的 pointer-events-none 只挡鼠标、挡不住键盘）。
  // React 18 未内建 inert 属性（无类型、传布尔会告警），故用 ref 在 effect 里挂/摘该属性。
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !selecting) return
    el.setAttribute('inert', '')
    return () => el.removeAttribute('inert')
  }, [selecting])

  // 整卡：一层渐变描边（_OPAQUE 垫白底挡红）+ 圆角 16 + overflow-hidden，裹住卡内容。
  // 高度自然（不定高、不卡内滚——产品方定稿）：长句默认 line-clamp-3 +「查看更多」，折叠态各卡行数一致。
  // 选中态：换成主题色实线描边（并显式补 bg-white，否则去掉渐变内联样式后内壁会透出页面底色）。
  const body = (
    <div
      ref={bodyRef}
      className={
        `relative rounded-[16px] overflow-hidden ` +
        (selected ? 'bg-white border-2 border-brand-primary' : '')
      }
      style={selected ? undefined : GRADIENT_BORDER_STYLE_FULL_OPAQUE}
    >
      {/* 选择模式：右上角浮出 checkbox（避开左上角「原句」标签）。纯视觉——选中态由覆盖按钮的 aria-checked 表达 */}
      {selecting && (
        <div
          aria-hidden="true"
          className={
            `absolute top-3 right-3 z-10 w-5 h-5 rounded-full flex items-center justify-center ` +
            (selected ? 'bg-brand-primary' : 'bg-white border-2 border-black/[0.2]')
          }
        >
          {selected && <Check size={14} strokeWidth={3} className="text-white" />}
        </div>
      )}
      {/* 卡内容主体（复刻 feedback 非 plain 版式与间距）：自然高度；长句由 SentenceBlock 内
          line-clamp-3 +「查看更多」控制，折叠态各卡行数一致。 */}
      <div className="px-[16px] pt-[14px] pb-[18px]">
        <div className="mb-1.5">
          <InfoTag text="原句" letterSpacing={2} />
        </div>
        <SentenceBlock text={card.originalSentence} variant="original" />
        <div className="mt-5 mb-1.5">
          <InfoTag text="优化" letterSpacing={5} />
        </div>
        <SentenceBlock text={card.aiOptimized} variant="ai" />
        {/* 「换个说法」解释区：默认折叠「看解释」；空 note 连触发器一起不渲染（宿主层拦空——parseNote('') 会渲染空 <p>） */}
        {card.note && card.note.trim() && <ExplanationBlock note={card.note} />}
        {/* 卡尾显示关键词 + 日期（feedback 同款日期行） */}
        <div className="flex items-center justify-between mt-3">
          <span className="text-[0.75rem] text-v2-text-muted">{(card.keywords ?? []).join(' · ')}</span>
          <span className="text-[0.75rem] text-v2-text-muted">{card.collectedAt}</span>
        </div>
      </div>
    </div>
  )

  // 移动端：外层 rounded+shadow（阴影不被 SwipeToDelete 的 overflow-hidden 裁掉）→ SwipeToDelete 负责裁切 + 左滑删除
  if (enableSwipe) {
    return (
      <div className="rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
        <SwipeToDelete borderRadius={16} onDelete={() => onDelete(card.id)}>
          {body}
        </SwipeToDelete>
      </div>
    )
  }

  // 桌面端：裸渲染，外层 wrapper 提供圆角 + 阴影。
  // 选择模式下叠一个铺满卡面的复选覆盖按钮——它与 body 是兄弟而非后代，避免「可交互套可交互」；
  // 原生 button + role=checkbox：可 Tab 聚焦、Space 切换，焦点环由全局 :focus-visible 提供。
  return (
    <div className="relative rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      {body}
      {selecting && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`选择卡片：${card.aiOptimized}`}
          onClick={() => onSelectToggle?.(card.id)}
          className="absolute inset-0 z-10 rounded-[16px] cursor-pointer"
        />
      )}
    </div>
  )
}
