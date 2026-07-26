/**
 * @module   CollectedCard
 * @desc     素材库「收藏卡片」单卡 —— 手写复刻 feedback 桌面版卡片视觉（胶囊描边标签 + 白底原句框 +
 *           绿底优化框 + 播放按钮），并用一条 GRADIENT_BORDER_STYLE_FULL_OPAQUE 渐变描边一次裹住
 *           「卡内容 + 拼句练习行」，内部以中性虚线隔开。不复用 FeedbackCard（其描边只裹卡主体、
 *           且半透明描边在 SwipeToDelete 红底上会透棕，故本卡自画不透明描边）。
 *           enableSwipe=true 时外层包 SwipeToDelete 支持移动端左滑删除；false 时裸渲染（桌面端）。
 *           桌面选择模式：卡体 inert（不可点、不可 Tab、移出无障碍树）+ 同级 stretched 复选覆盖按钮。
 * @author   LingoBridge
 * @created  2026-07-05
 */
'use client'
import { type JSX, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Shuffle, Volume2, Check } from 'lucide-react'
import Chip from '@/components/Chip'
import SwipeToDelete from '@/components/library/SwipeToDelete'
import { chunkSentence } from '@/lib/phrase-chunk'
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
        <span className="text-brand-primary-dark" style={{ fontSize: 11, fontWeight: 500, lineHeight: 1, letterSpacing }}>
          {text}
        </span>
      </div>
    </div>
  )
}

/** 句子框 + 播放按钮（复刻 FeedbackCard 非 plain：原句白底、优化绿底） */
/**
 * 句子框（原句/优化）：定高卡内由父层 flex 分配高度（className 传 flex-1 min-h-0），
 * 超长句子在【框内】滚动下滑（产品方定稿：不是整卡滚，是原句/优化句各自框内滚）；
 * 播放按钮绝对定位钉在框右下、不随文本滚走。
 */
function SentenceBlock({ text, variant, className = '' }: { text: string; variant: 'original' | 'ai'; className?: string }) {
  const isAi = variant === 'ai'
  const box = isAi ? 'bg-tag-success-bg border border-tag-success-border' : 'bg-white border border-black/[0.07]'
  return (
    <div className={`relative rounded-[14px] ${box} flex flex-col ${className}`}>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2.5">
        <p className={`text-[14px] leading-relaxed pr-7 ${isAi ? 'text-v2-text-primary' : 'text-v2-text-secondary'}`}>
          {text}
        </p>
      </div>
      {/* 命中区扩到 40×40（右下对齐 + p-2.5 使图标可视位置仍等效 right-2.5 bottom-2.5）；钉框右下不随滚 */}
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

export default function CollectedCard({
  card,
  enableSwipe,
  onDelete,
  selecting = false,
  selected = false,
  onSelectToggle,
}: CollectedCardProps): JSX.Element {
  // 优化句切不出至少 3 块（短句）时不显示拼句练习入口，玩着意义不大
  const canPlay = chunkSentence(card.aiOptimized).length >= 3

  // 选择模式下把卡体整体设为 inert：内部播放按钮 / 拼句 Link 既不可点、也不可 Tab 聚焦，并移出无障碍树，
  // 使同级的覆盖复选按钮成为唯一交互点（旧的 pointer-events-none 只挡鼠标、挡不住键盘）。
  // React 18 未内建 inert 属性（无类型、传布尔会告警），故用 ref 在 effect 里挂/摘该属性。
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !selecting) return
    el.setAttribute('inert', '')
    return () => el.removeAttribute('inert')
  }, [selecting])

  // 整卡：一层渐变描边（_OPAQUE 垫白底挡红）+ 圆角 16 + overflow-hidden，一次裹住卡内容 + 拼句行。
  // 统一定高（移动 340 / 桌面 300，值只落在这一处 class）：长句卡不再撑破网格，超出部分卡内滚动。
  // 选中态：换成主题色实线描边（并显式补 bg-white，否则去掉渐变内联样式后内壁会透出页面底色）。
  const body = (
    <div
      ref={bodyRef}
      className={
        `relative rounded-[16px] overflow-hidden flex flex-col h-[340px] lg:h-[300px] ` +
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
      {/* 卡内容主体（复刻 feedback 非 plain 版式与间距）：定高下纵向 flex——标签行钉住、
          两个句子框 flex-1 平分余高，超长句子在【各自框内】滚动下滑（产品方定稿：非整卡滚）。 */}
      <div className="flex-1 min-h-0 flex flex-col px-[16px] pt-[14px] pb-[14px]">
        <div className="mb-1.5 shrink-0">
          <InfoTag text="原句" letterSpacing={2} />
        </div>
        <SentenceBlock text={card.originalSentence} variant="original" className="flex-1 min-h-0" />
        <div className="mt-3 mb-1.5 shrink-0">
          <InfoTag text="优化" letterSpacing={5} />
        </div>
        <SentenceBlock text={card.aiOptimized} variant="ai" className="flex-1 min-h-0" />
        {/* 不可拼句时，卡尾显示日期（feedback 同款日期行） */}
        {!canPlay && (
          <div className="flex items-center justify-between mt-3 shrink-0">
            <span className="text-[12px] text-v2-text-muted">{(card.keywords ?? []).join(' · ')}</span>
            <span className="text-[12px] text-v2-text-muted">{card.collectedAt}</span>
          </div>
        )}
      </div>

      {/* 拼句练习入口行：中性虚线分隔 + 左日期右 Chip；与卡内容同在一条描边内 */}
      {canPlay && (
        <div className="shrink-0 px-[16px] pt-[11px] pb-[14px] bg-white border-t border-dashed border-black/[0.08] flex items-center justify-between">
          <span className="text-[11px] text-v2-text-muted">{card.collectedAt}</span>
          <Link href={`/library/collected/${card.id}/practice`}>
            <Chip variant="gradient" size="sm" className="text-[12px] px-[14px] py-[7px] gap-1.5">
              <Shuffle size={13} className="text-brand-accent" />拼句练习
            </Chip>
          </Link>
        </div>
      )}
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
