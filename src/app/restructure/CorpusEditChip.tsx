/**
 * @module   CorpusEditChip
 * @desc     整理确认页「编辑整理后语料」入口 —— 移动/桌面 AiResultCard 共用。定位在语料卡右下角（与
 *           右上角的存对子拼图分处两角、不挤）；hover 与键盘 focus 均弹 tooltip 解释，Chip 文案「编辑/完成」
 *           本身即无障碍名，tooltip 标 aria-hidden 不重复播报。tooltip 朝卡内上方展开、不溢出卡底。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { Pencil, Check } from 'lucide-react'
import Chip from '@/components/Chip'
import { cn } from '@/lib/utils'

/** tooltip 文案：说明这个入口编辑的是 AI 整理后的语料。 */
const EDIT_TOOLTIP = '编辑整理后的语料'

interface Props {
  /** 是否处于编辑态（决定 Chip 显「完成」还是「编辑」）。 */
  isEditing: boolean
  /** 切换编辑/完成。 */
  onToggle: () => void
  /** 额外定位样式（默认 absolute bottom-3 right-3 z-[1]）。 */
  className?: string
}

export default function CorpusEditChip({ isEditing, onToggle, className }: Props) {
  return (
    <div className={cn('group absolute bottom-3 right-3 z-[1]', className)}>
      <Chip onClick={onToggle} variant="default">
        {isEditing ? <><Check size={12} />完成</> : <><Pencil size={12} />编辑</>}
      </Chip>
      {/* 视觉 tooltip：aria-hidden（无障碍名已由 Chip 文案提供）；在 Chip 上方右对齐、朝卡内展开不溢出卡底 */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute bottom-full right-0 mb-1 z-20 w-max',
          'rounded-[10px] bg-surface-inverse px-2.5 py-1.5',
          'text-[11px] font-medium leading-relaxed text-white',
          'opacity-0 transition-opacity duration-150',
          'group-hover:opacity-100 group-focus-within:opacity-100',
        )}
      >
        {EDIT_TOOLTIP}
      </span>
    </div>
  )
}
