/**
 * @module   RephrasePopup
 * @desc     练习页"换个说法"弹窗 — 展示 🔨 优化后的句子 + 改进说明
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { type JSX, type RefObject } from 'react'
import { X, Check } from 'lucide-react'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'
import type { PolishResult } from '@/lib/types'

/** 解释区一条改动项 */
interface NoteItem {
  /** 类型前缀（仅语法段有，如「时态」）；无则 undefined */
  type?: string
  /** 原片段（弱化显示） */
  from: string
  /** 改法（最重显示） */
  to: string
  /** 无箭头无法切分时的整行原文（此时 from/to 留空，raw 直接展示） */
  raw?: string
}

/** 解释区一段（语法 / 词组） */
interface NoteSection {
  kind: 'grammar' | 'phrase'
  items: NoteItem[]
}

// 段头容错集：模型可能带全角/半角冒号或用长名
const GRAMMAR_HEADS = new Set(['语法', '语法：', '语法:'])
const PHRASE_HEADS = new Set(['词组', '词组：', '词组:', '词组表达优化', '表达'])

/**
 * 把 note 契约字符串解析成两段结构；无法识别契约格式时返回 null（调用方回退整段 <p>）
 * @param note  模型输出的单 string（内部以 \n 组织成「语法」「词组」两段）
 * @returns     命中契约 → 非空 NoteSection 数组；未命中 / 解析后皆空 → null
 */
function parseNote(note: string): NoteSection[] | null {
  const lines = note.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  // 无任何行命中段头 → 判定非契约格式，交回调用方按普通段落渲染
  const hasHead = lines.some((l) => GRAMMAR_HEADS.has(l) || PHRASE_HEADS.has(l))
  if (!hasHead) return null

  const grammar: NoteItem[] = []
  const phrase: NoteItem[] = []
  let current: 'grammar' | 'phrase' | null = null

  for (const line of lines) {
    if (GRAMMAR_HEADS.has(line)) {
      current = 'grammar'
      continue
    }
    if (PHRASE_HEADS.has(line)) {
      current = 'phrase'
      continue
    }
    if (current === null) continue // 段头之前的游离行，忽略
    const arrowIdx = line.search(/→|->/)
    if (arrowIdx < 0) {
      // 无箭头：整行 raw 兜底展示
      ;(current === 'grammar' ? grammar : phrase).push({ from: '', to: '', raw: line })
      continue
    }
    const arrowLen = line[arrowIdx] === '→' ? 1 : 2
    const left = line.slice(0, arrowIdx).trim()
    const to = line.slice(arrowIdx + arrowLen).trim()
    if (current === 'grammar') {
      // 语法段左侧再按第一个中/英文冒号切「类型 / 原片段」
      const colonIdx = left.search(/：|:/)
      if (colonIdx >= 0) {
        grammar.push({ type: left.slice(0, colonIdx).trim(), from: left.slice(colonIdx + 1).trim(), to })
      } else {
        grammar.push({ from: left, to })
      }
    } else {
      phrase.push({ from: left, to })
    }
  }

  const sections: NoteSection[] = []
  if (grammar.length > 0) sections.push({ kind: 'grammar', items: grammar })
  if (phrase.length > 0) sections.push({ kind: 'phrase', items: phrase })
  // 解析后两段皆空 → 回退整段 <p>
  return sections.length > 0 ? sections : null
}

/** 一条改动项渲染：前端补装饰圆点 + 类型/原/箭头/改 分色 */
function NoteItemRow({ item }: { item: NoteItem }): JSX.Element {
  return (
    <div className="flex gap-1.5 text-[12px] leading-[1.4]">
      <span className="text-warm-taupe select-none">·</span>
      <span className="flex-1 min-w-0">
        {item.raw !== undefined ? (
          <span className="text-v2-text-muted">{item.raw}</span>
        ) : (
          <>
            {item.type && <span className="text-v2-text-secondary font-medium">{item.type}：</span>}
            <span className="text-v2-text-muted">{item.from}</span>
            <span className="text-warm-taupe mx-1">→</span>
            <span className="text-v2-text-primary font-medium">{item.to}</span>
          </>
        )}
      </span>
    </div>
  )
}

/** note 解释区：契约命中 → 两段渲染；未命中 → 整段普通 <p>（= 原状） */
function NoteBlock({ note }: { note: string }): JSX.Element {
  const sections = parseNote(note)
  if (!sections) {
    return <p className="text-[12px] text-v2-text-muted leading-[1.45] px-1">{note}</p>
  }
  return (
    <div className="px-1 flex flex-col gap-[7px]">
      {sections.map((sec) => (
        <div key={sec.kind} className="flex flex-col gap-[3px]">
          <span className="text-[11px] font-semibold text-v2-text-muted tracking-wide">
            {sec.kind === 'grammar' ? '语法' : '词组表达优化'}
          </span>
          {sec.items.map((item, i) => (
            <NoteItemRow key={i} item={item} />
          ))}
        </div>
      ))}
    </div>
  )
}

interface RephrasePopupProps {
  loading: boolean
  result: PolishResult | null
  onClose: () => void
  popupRef: RefObject<HTMLDivElement | null>
  /** 定位变体：mobile = fixed 贴视口左右（默认，移动端原样）；desktop = absolute 收进 600px 对话列内，避免横跨全屏 */
  variant?: 'mobile' | 'desktop'
}

export default function RephrasePopup({ loading, result, onClose, popupRef, variant = 'mobile' }: RephrasePopupProps): JSX.Element {
  const desktop = variant === 'desktop'
  return (
    <div
      ref={popupRef}
      className={
        desktop
          ? 'absolute z-[40] rounded-[16px] left-0 right-0 bottom-[118px]'
          : 'fixed z-[40] rounded-[16px]'
      }
      style={
        desktop
          ? { ...GRADIENT_BORDER_STYLE_FULL, padding: '11px 13px 12px' }
          : { ...GRADIENT_BORDER_STYLE_FULL, left: 14, right: 14, bottom: 100, padding: '11px 13px 12px' }
      }
    >
      {/* 向下三角，指向左下角云团 */}
      <div
        className="absolute bg-white"
        style={{ bottom: -7, left: 18, width: 12, height: 12, transform: 'rotate(45deg)', borderRight: '1px solid rgba(168,210,196,.80)', borderBottom: '1px solid rgba(188,210,168,.75)' }}
      />

      <div className="flex justify-between items-center mb-2">
        <span className="text-[13px] font-semibold text-v2-text-primary">换个说法</span>
        {/* 触控目标 44px：负 margin 抵消视觉外扩，不改变原有留白观感 */}
        <button onClick={onClose} aria-label="关闭" className="w-11 h-11 -mr-3 -my-3 flex items-center justify-center active:opacity-60 transition-opacity"><X size={14} color="#A89990" /></button>
      </div>

      {loading ? (
        <p className="text-[13px] text-v2-text-muted px-1 py-2">优化中…</p>
      ) : result ? (
        result.needsWork && result.optimized ? (
          <div className="flex flex-col gap-2">
            <div className="bg-cream-soft" style={{ padding: '9px 11px', border: '1px solid rgba(168,153,144,.14)', borderRadius: 11 }}>
              <p className="text-[11px] text-v2-text-muted mb-1">Do you wanna try:</p>
              <p className="text-[13px] leading-[1.5] text-v2-text-primary font-medium">{result.optimized}</p>
            </div>
            {result.note && <NoteBlock note={result.note} />}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-1 py-1.5">
            <Check size={14} className="text-brand-accent flex-shrink-0" />
            <p className="text-[13px] text-v2-text-secondary">{result.note || '回答无需优化'}</p>
          </div>
        )
      ) : null}
    </div>
  )
}
