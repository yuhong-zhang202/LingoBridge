/**
 * @module   CollectedCardsTab
 * @desc     素材库「收藏卡片」tab —— 渲染收藏句子卡列表。卡片视觉两端对齐 feedback 桌面版（见 CollectedCard）。
 *           按断点分两份渲染：移动端单列 flex + 左滑删除；桌面端两列 grid、无滑删（多选删除下次专项做）。
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState } from 'react'
import CollectedCard from '@/components/CollectedCard'
import EmptyState from '@/components/EmptyState'
import { removeSavedPhrase } from '@/lib/storage'
import type { CollectedCard as CollectedCardData } from '@/lib/types'

interface Props { cards: CollectedCardData[] }

export default function CollectedCardsTab({ cards: initialCards }: Props) {
  const [cards, setCards] = useState(initialCards)

  const handleDelete = (id: string) => {
    removeSavedPhrase(id)
    setCards(prev => prev.filter(c => c.id !== id))
  }

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
    <>
      {/* 移动端：单列 flex + 左滑删除 */}
      <div className="lg:hidden flex flex-col gap-3 pt-3 px-1">
        {cards.map(card => (
          <CollectedCard key={card.id} card={card} enableSwipe onDelete={handleDelete} />
        ))}
      </div>
      {/* 桌面端：两列 grid，无滑删 */}
      <div className="hidden lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start pt-3 px-1">
        {cards.map(card => (
          <CollectedCard key={card.id} card={card} enableSwipe={false} onDelete={handleDelete} />
        ))}
      </div>
    </>
  )
}
