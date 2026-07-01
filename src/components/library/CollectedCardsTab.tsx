'use client'
import { useState, useRef } from 'react'
import { Trash2, Shuffle } from 'lucide-react'
import FeedbackCard from '@/components/FeedbackCard'
import Chip from '@/components/Chip'
import SentenceOrderGame from '@/components/library/SentenceOrderGame'
import type { CollectedCard } from '@/lib/types'
import EmptyState from '@/components/EmptyState'
import { removeSavedPhrase } from '@/lib/storage'
import { chunkSentence } from '@/lib/phrase-chunk'

interface Props { cards: CollectedCard[] }

// 渐变从透明到 #D4534F，左边缘自然"渗"出，无硬切边
const DEL_BG = 'linear-gradient(to right, rgba(212,83,79,0.0) 0%, rgba(212,83,79,0.6) 15%, #D4534F 40%)'

function SwipeCard({ card, onDelete }: { card: CollectedCard; onDelete: () => void }) {
  const [offset, setOffset] = useState(0)
  const [gameOpen, setGameOpen] = useState(false)
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
    <div className="relative overflow-hidden rounded-[16px]">
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
          date={card.collectedAt}
          collected
        />

        {/* 拼句练习入口：优化句 FeedbackCard 下方 */}
        {canPlay && (
          <div className="mt-2 flex justify-end">
            <Chip variant="ghost" size="sm" onClick={() => setGameOpen(true)}>
              <Shuffle size={12} />拼句练习
            </Chip>
          </div>
        )}
      </div>

      <SentenceOrderGame
        open={gameOpen}
        originalSentence={card.originalSentence}
        aiOptimized={card.aiOptimized}
        onClose={() => setGameOpen(false)}
      />
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
