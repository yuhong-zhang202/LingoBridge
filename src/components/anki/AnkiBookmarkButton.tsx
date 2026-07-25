/**
 * @module   AnkiBookmarkButton
 * @desc     存对子书签按钮（三态）：匹配页桌面详情卡右上角 / 整理页语料卡右上角共用。
 *           三态：
 *             - idle  ：Bookmark 图标，可点存题卡；
 *             - saving：Loader2 转圈 + aria-live 播报「正在存题卡」（读屏可感知进行中）；
 *             - saved ：savedTag=true → 渲染 <Tag green 已存题卡>（桌面详情行有横向空间）；
 *                       savedTag=false → 仅换成 BookmarkCheck 绿图标（角标位无空间放 Tag）。已存态不可再触发。
 *           40×40 命中区（≥WCAG 2.5.5）、focus-visible 焦点环；idle/saving 均为原生 <button>。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react'
import Tag from '@/components/Tag'
import { cn } from '@/lib/utils'

export type AnkiSaveState = 'idle' | 'saving' | 'saved'

interface Props {
  state: AnkiSaveState
  /** 触发存题卡（idle 态点击）。saving/saved 态本组件不调用。 */
  onSave: () => void
  /** saved 态是否渲染「已存题卡」绿 Tag（true=桌面详情行；false=角标图标位只换图标）。默认 false。 */
  savedTag?: boolean
  /** 定位/额外样式（如 absolute top-3 right-3）。 */
  className?: string
}

export default function AnkiBookmarkButton({ state, onSave, savedTag = false, className }: Props) {
  if (state === 'saved') {
    return (
      <div className={cn('flex items-center', className)}>
        {savedTag ? (
          <Tag variant="green" label="已存题卡" icon={<BookmarkCheck size={12} />} />
        ) : (
          <span
            className="w-10 h-10 flex items-center justify-center text-tag-success-text"
            aria-label="已存题卡"
            role="img"
          >
            <BookmarkCheck size={18} />
          </span>
        )}
      </div>
    )
  }

  const saving = state === 'saving'
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!saving) onSave() }}
      disabled={saving}
      aria-label={saving ? '正在存题卡' : '存为题卡'}
      aria-live="polite"
      className={cn(
        'w-10 h-10 flex items-center justify-center rounded-full text-v2-text-muted',
        'hover:text-brand-primary-dark active:opacity-60 transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40',
        className,
      )}
    >
      {saving ? <Loader2 size={18} className="animate-spin" /> : <Bookmark size={18} />}
    </button>
  )
}
