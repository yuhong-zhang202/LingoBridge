/**
 * @module   PolishNote
 * @desc     「换个说法」note 解释区公用组件 —— 把模型输出的单 string note 解析成
 *           「语法：」「词组优化：」两段并前端补装饰（圆点 + 原词弱化→改法加重 + 淡箭头）。
 *           命中契约格式 → 两段渲染；未命中（老格式）→ 整段普通 <p> 兜底不崩。
 *           供练习页「换个说法」弹窗、反馈卡、素材库收藏卡三处共用；样式与原弹窗内实现逐字一致。
 * @author   LingoBridge
 * @created  2026-07-31
 */
import { type JSX } from 'react'
import { cn } from '@/lib/utils'
import { parseNote, type NoteItem } from '@/lib/polish-note'

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

interface PolishNoteProps {
  /** 模型输出的单 string note */
  note: string
  /** 外层水平内边距等微调（弹窗传 'px-1' 保持原观感；卡片不传以与句子框左缘齐平） */
  className?: string
}

/**
 * note 解释区：契约命中 → 两段渲染；未命中 → 整段普通 <p>（= 老格式兜底）。
 * ⚠️ 空 note（parseNote('') 会渲染空 <p>）须由宿主层用 `note && note.trim()` 拦掉，本组件不判空。
 */
export default function PolishNote({ note, className }: PolishNoteProps): JSX.Element {
  const sections = parseNote(note)
  if (!sections) {
    return <p className={cn('text-[12px] text-v2-text-muted leading-[1.45]', className)}>{note}</p>
  }
  return (
    <div className={cn('flex flex-col gap-[7px]', className)}>
      {sections.map((sec) => (
        <div key={sec.kind} className="flex flex-col gap-[3px]">
          <span className="text-[11px] font-semibold text-v2-text-muted tracking-wide">
            {sec.kind === 'grammar' ? '语法：' : '词组优化：'}
          </span>
          {sec.items.map((item, i) => (
            <NoteItemRow key={i} item={item} />
          ))}
        </div>
      ))}
    </div>
  )
}
