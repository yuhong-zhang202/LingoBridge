/**
 * @module   CorpusEditChip
 * @desc     整理确认页「编辑整理后语料」入口 —— 移动/桌面 AiResultCard 共用。定位在语料卡右下角（与
 *           右上角的存对子拼图分处两角、不挤）。Chip 文案「编辑/完成」本身即够清楚，产品方反馈无需悬停
 *           解释，故不带 tooltip（存对子那个拼图 tooltip 另在 AnkiBookmarkButton，保留、不受影响）。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { Pencil, Check } from 'lucide-react'
import Chip from '@/components/Chip'
import { cn } from '@/lib/utils'

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
    <div className={cn('absolute bottom-3 right-3 z-[1]', className)}>
      <Chip onClick={onToggle} variant="default">
        {isEditing ? <><Check size={12} />完成</> : <><Pencil size={12} />编辑</>}
      </Chip>
    </div>
  )
}
