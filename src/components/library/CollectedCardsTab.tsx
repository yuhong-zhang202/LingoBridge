'use client'
import { useState, useRef } from 'react'
import Link from 'next/link'
import { Trash2, Shuffle } from 'lucide-react'
import FeedbackCard from '@/components/FeedbackCard'
import Chip from '@/components/Chip'
import type { CollectedCard } from '@/lib/types'
import EmptyState from '@/components/EmptyState'
import { removeSavedPhrase } from '@/lib/storage'
import { chunkSentence } from '@/lib/phrase-chunk'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'

interface Props { cards: CollectedCard[] }

// 渐变从透明到 #D4534F，左边缘自然"渗"出，无硬切边
const DEL_BG = 'linear-gradient(to right, rgba(212,83,79,0.0) 0%, rgba(212,83,79,0.6) 15%, #D4534F 40%)'

function SwipeCard({ card, onDelete }: { card: CollectedCard; onDelete: () => void }) {
  const [offset, setOffset] = useState(0)
  const startX = useRef(0)
  const isLocked = useRef(false)

  // 优化句切不出至少 3 块（短句）时不显示拼句练习入口，玩着意义不大
  const canPlay = chunkSentence(card.aiOptimized).length >= 3

  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX }

  const onTouchMove = (e: React.TouchEvent) => {
    const diff = e.touches[0].clientX - startX.current
    if (isLocked.current && diff > 0) setOffset(Math.min(-130 + diff, 0))
    else if (!isLocked.current && diff < 0) setOffset(Math.max(diff, -130))
  }

  const onTouchEnd = () => {
    setOffset(prev => {
      if (isLocked.current) {
        const keep = prev <= -80
        if (!keep) isLocked.current = false
        return keep ? -130 : 0
      }
      const lock = prev < -65
      if (lock) isLocked.current = true
      return lock ? -130 : 0
    })
  }

  return (
    // 白底渐变描边（同「今日复习」卡 GRADIENT_BORDER_STYLE_FULL）；边框在不被裁的外层，内部白卡+入口行连成整块
    <div className="relative overflow-hidden rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)]" style={GRADIENT_BORDER_STYLE_FULL}>
      {/* 删除区域：铺满容器，圆角由外层 overflow-hidden 统一裁切，无独立圆角 */}
      <button
        className="absolute inset-0 flex items-center justify-end"
        style={{ background: DEL_BG }}
        onClick={onDelete}
      >
        <div className="w-[130px] flex items-center justify-center gap-1.5 text-white text-[14px] font-medium">
          <Trash2 size={16} />删除
        </div>
      </button>
      {/* 卡片层：z-10 盖住删除区域，左滑时右侧自然露出红色 */}
      <div
        className="relative z-10 transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <FeedbackCard
          part={card.part}
          originalSentence={card.originalSentence}
          aiOptimized={card.aiOptimized}
          keywords={card.keywords ?? []}
          // 有拼句练习入口时时间戳挪到下方入口行，避免和入口行重复展示
          date={canPlay ? '' : card.collectedAt}
          // 极简白卡样式（对齐设计稿）；边框/阴影由外层容器统一负责，卡与入口行连成整块白面
          plain
        />

        {/* 拼句练习入口行：对齐设计稿 .practice-entry-row（padding 11/18/14、1px 虚线上分隔）；顶边与卡片直角下沿 0 间距贴合，无透明缝、不透红 */}
        {canPlay && (
          <div className="px-[18px] pt-[11px] pb-[14px] bg-white rounded-b-[16px] border-t border-dashed border-black/[0.08] flex items-center justify-between">
            <span className="text-[11px] text-v2-text-muted">{card.collectedAt}</span>
            <Link href={`/library/collected/${card.id}/practice`}>
              {/* 对齐设计稿 .practice-chip：12px / padding 7×14 / gap 6，覆盖 Chip sm 内置小尺寸 */}
              <Chip variant="gradient" size="sm" className="text-[12px] px-[14px] py-[7px] gap-1.5">
                <Shuffle size={13} className="text-brand-accent" />拼句练习
              </Chip>
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CollectedCardsTab({ cards: initialCards }: Props) {
  const [cards, setCards] = useState(initialCards)

  if (cards.length === 0) {
    return (
      <EmptyState
        title="还没有收藏卡片"
        subtitle="练习后左滑卡片即可收藏，随时复习"
      />
    )
  }

  // px-1（4px/side）补偿 library px-5 与 feedback px-6 的宽度差，使卡片内文字换行一致
  return (
    <div className="flex flex-col gap-3 pt-3 px-1 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start">
      {cards.map(card => (
        <SwipeCard
          key={card.id}
          card={card}
          onDelete={() => { removeSavedPhrase(card.id); setCards(prev => prev.filter(c => c.id !== card.id)) }}
        />
      ))}
    </div>
  )
}
