/**
 * @module   AnkiBookmarkButton
 * @desc     存对子书签按钮（三态）：匹配页桌面详情卡右上角 / 整理页语料卡右上角共用。
 *           图标用 lucide Puzzle（拼图＝结对语义），idle 描边 + 弱色、saved 实心 + 绿。
 *           三态：
 *             - idle  ：Puzzle 描边图标，可点存题卡；hover / 键盘 focus 均弹 tooltip 解释，aria-label 兜底；
 *             - saving：Loader2 转圈 + aria-live 播报「正在存题卡」（读屏可感知进行中）；
 *             - saved ：savedTag=true → 渲染 <Tag green 已存题卡>（桌面详情行有横向空间）；
 *                       savedTag=false → 换成实心绿 Puzzle（角标位无空间放 Tag）。已存态不可再触发、不带 tooltip。
 *           40×40 命中区（≥WCAG 2.5.5）、focus-visible 焦点环；idle/saving 均为原生 <button>。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { Puzzle, Loader2 } from 'lucide-react'
import Tag from '@/components/Tag'
import { cn } from '@/lib/utils'

export type AnkiSaveState = 'idle' | 'saving' | 'saved'

/** tooltip 文案：解释「存为题卡」到底做什么，降低产品方反馈的「不明显」。 */
const SAVE_TOOLTIP = '存为题卡：把这条语料绑到这道题，卡片分析将围绕你的语料展开'

interface Props {
  state: AnkiSaveState
  /** 触发存题卡（idle 态点击）。saving/saved 态本组件不调用。 */
  onSave: () => void
  /** saved 态是否渲染「已存题卡」绿 Tag（true=桌面详情行；false=角标位只换图标）。默认 false。 */
  savedTag?: boolean
  /** 定位/额外样式（如 absolute top-3 right-3）——挂在外层 group 容器上，tooltip 随之定位。 */
  className?: string
}

export default function AnkiBookmarkButton({ state, onSave, savedTag = false, className }: Props) {
  if (state === 'saved') {
    return (
      <div className={cn('flex items-center', className)}>
        {savedTag ? (
          <Tag variant="green" label="已存题卡" icon={<Puzzle size={12} className="fill-current" />} />
        ) : (
          <span
            className="w-10 h-10 flex items-center justify-center text-tag-success-text"
            aria-label="已存题卡"
            role="img"
          >
            <Puzzle size={18} className="fill-current" />
          </span>
        )}
      </div>
    )
  }

  const saving = state === 'saving'
  return (
    // group 容器承接定位；tooltip 在 hover 与 group-focus-within（键盘聚焦按钮）两路触发
    <div className={cn('group relative inline-flex', className)}>
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
        )}
      >
        {saving ? <Loader2 size={18} className="animate-spin" /> : <Puzzle size={18} />}
      </button>
      {/* 视觉 tooltip：aria-hidden（无障碍名已由 button 的 aria-label 提供）；在按钮下方右对齐、朝卡片内侧展开不溢出 */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-full right-0 mt-1 z-20 w-[210px]',
          'rounded-[10px] bg-surface-inverse px-2.5 py-1.5',
          'text-[11px] font-medium leading-relaxed text-white',
          'opacity-0 transition-opacity duration-150',
          'group-hover:opacity-100 group-focus-within:opacity-100',
        )}
      >
        {SAVE_TOOLTIP}
      </span>
    </div>
  )
}
