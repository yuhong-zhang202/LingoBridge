/**
 * @module   FlashCard
 * @desc     单张词组记忆卡：正面中文、点击翻面看英文、左右滑动（或点底部）评估记住与否
 * @author   LingoBridge
 * @created  2026-06-12
 */
'use client'
import { useState, useRef } from 'react'
import { RotateCw, ArrowLeft, ArrowRight } from 'lucide-react'
import type { PhraseCard } from '@/lib/types'

// 超过此位移（px）判定为一次有效滑动
const SWIPE_THRESHOLD = 90
// 顶部渐变细条（品牌橙→绿），V3 识别感；与 SwipeToDelete 的 DEL_BG 同为模块常量
const STRIP = 'linear-gradient(90deg, rgba(212,135,90,0.9), rgba(123,166,153,0.9))'

interface Props {
  card: PhraseCard
  onGrade: (remembered: boolean) => void
}

function Dots({ box }: { box: number }): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 mt-[22px]">
      <span className="text-[11px] text-v2-text-muted">记忆进度</span>
      <span className="flex gap-[5px]">
        {[1, 2, 3, 4, 5].map(i => (
          <span key={i} className={`w-[7px] h-[7px] rounded-full ${i <= box ? 'bg-brand-primary' : 'bg-[#E5DED7]'}`} />
        ))}
      </span>
    </div>
  )
}

export default function FlashCard({ card, onGrade }: Props): JSX.Element {
  const [flipped, setFlipped] = useState(false)
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const startX = useRef(0)
  const moved = useRef(false)

  // 飞出 + 回调（留出动画时间）
  const fly = (remembered: boolean): void => {
    setLeaving(true)
    setDx(remembered ? 520 : -520)
    window.setTimeout(() => onGrade(remembered), 200)
  }

  const onClick = (): void => { if (!moved.current) setFlipped(f => !f) }            // 轻点翻面（拖动则忽略）
  const onTouchStart = (e: React.TouchEvent): void => { startX.current = e.touches[0].clientX; moved.current = false }
  const onTouchMove = (e: React.TouchEvent): void => {
    const d = e.touches[0].clientX - startX.current
    if (Math.abs(d) > 6) moved.current = true
    if (flipped) setDx(d)                                                            // 仅翻面后允许滑动评估
  }
  const onTouchEnd = (): void => {
    if (!flipped) { setDx(0); return }
    if (Math.abs(dx) > SWIPE_THRESHOLD) fly(dx > 0)
    else setDx(0)
  }

  const Face = ({ back }: { back: boolean }): JSX.Element => (
    <div
      className={`${back ? 'absolute inset-0' : ''} rounded-[20px] bg-white shadow-[0_2px_14px_rgba(0,0,0,0.06)] overflow-hidden`}
      style={{ backfaceVisibility: 'hidden', transform: back ? 'rotateY(180deg)' : undefined }}
    >
      <div className="h-1" style={{ background: STRIP }} />
      <div className="px-[22px] pt-[18px] pb-5 min-h-[256px] flex flex-col">
        {card.group && (
          <span className="self-start text-[11px] text-[#3D7A38] bg-[#EDF6EB] border border-[#C0DDB9] rounded-full px-2.5 py-[3px]">{card.group}</span>
        )}
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          {back ? (
            <>
              <p className="text-[19px] font-medium text-v2-text-primary leading-[1.4]">{card.text}</p>
              <p className="text-[15px] text-v2-text-secondary mt-3">{card.meaning}</p>
              {card.scene && <p className="text-[12px] text-v2-text-muted mt-1.5">{card.scene}</p>}
            </>
          ) : (
            <>
              <p className="text-[21px] font-medium text-v2-text-primary leading-[1.5]">{card.meaning}</p>
              <p className="text-[13px] text-brand-accent mt-3.5">想想英文怎么说?</p>
            </>
          )}
        </div>
        <Dots box={card.box} />
      </div>
    </div>
  )

  return (
    <div className="w-full select-none">
      <div
        className={leaving ? 'transition-all duration-200 ease-out' : 'transition-transform duration-200 ease-out'}
        style={{ transform: `translateX(${dx}px) rotate(${dx * 0.03}deg)`, opacity: leaving ? 0 : 1 }}
        onClick={onClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div style={{ perspective: 1000 }}>
          <div className="relative transition-transform duration-300" style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'none' }}>
            <Face back={false} />
            <Face back={true} />
          </div>
        </div>
      </div>

      {!flipped ? (
        <p className="text-center text-[13px] text-v2-text-secondary mt-[18px] flex items-center justify-center gap-1.5">
          <RotateCw size={14} />点击卡片翻面看英文
        </p>
      ) : (
        <div className="flex items-center justify-center gap-5 mt-[18px]">
          <button onClick={() => fly(false)} className="flex items-center gap-1 text-[13px] text-[#C47A6A] active:opacity-60">
            <ArrowLeft size={15} />没记住
          </button>
          <span className="text-[12px] text-[#D8D2CA]">左右滑动</span>
          <button onClick={() => fly(true)} className="flex items-center gap-1 text-[13px] text-[#3D7A38] active:opacity-60">
            记住了<ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
