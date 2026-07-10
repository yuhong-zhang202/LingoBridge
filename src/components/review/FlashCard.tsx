/**
 * @module   FlashCard
 * @desc     单张词组记忆卡：正面中文、点击翻面看英文、左右滑动（或点底部）评估记住与否
 * @author   LingoBridge
 * @created  2026-06-12
 */
'use client'
import { useState, useRef, useEffect } from 'react'
import { RotateCw, ArrowLeft, ArrowRight, Volume2 } from 'lucide-react'
import Tag from '@/components/Tag'
import type { PhraseCard } from '@/lib/types'

// 超过此位移（px）判定为一次有效滑动
const SWIPE_THRESHOLD = 90
// 左侧竖渐变条（橙→绿）—— 与题目匹配页题卡左侧条同色
const STRIP = 'linear-gradient(to bottom, rgba(240,188,160,0.85), rgba(168,210,196,0.80))'

// 朗读英文（系统语音）
function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  window.speechSynthesis.speak(u)
}

interface Props {
  card: PhraseCard
  onGrade: (remembered: boolean) => void
}

// 记忆进度圆点（box 1~5）
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

// 单面（正面中文 / 背面英文）。提到组件外，避免随父组件每次渲染而被卸载重挂导致拖动卡顿
function Face({ card, back }: { card: PhraseCard; back: boolean }): JSX.Element {
  return (
    <div
      className={`${back ? 'absolute inset-0' : 'relative'} rounded-[22px] bg-white shadow-[0_10px_30px_-8px_rgba(180,120,70,0.20),0_3px_10px_rgba(120,90,60,0.06)] overflow-hidden`}
      style={{ backfaceVisibility: 'hidden', transform: back ? 'rotateX(180deg)' : undefined }}
    >
      {/* 左侧竖渐变条 */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[5px] z-[3]"
        style={{ background: STRIP }}
        aria-hidden="true"
      />
      {back && (
        <button
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); speak(card.text) }}
          aria-label="播放发音"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-[#F4F2EE] flex items-center justify-center active:opacity-50"
        >
          <Volume2 size={16} className="text-v2-text-muted" />
        </button>
      )}
      <div className="px-[22px] pt-[18px] pb-[18px] min-h-[300px] flex flex-col">
        {card.group && (
          <Tag variant="green" label={card.group} className="self-start" />
        )}
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          {back ? (
            <>
              <p className="text-[25px] font-bold text-v2-text-primary tracking-[-0.3px]">{card.text}</p>
              <p className="text-[15px] text-v2-text-secondary mt-3">{card.meaning}</p>
              {card.scene && (
                <div className="w-full bg-bg-page rounded-[12px] px-3 py-2.5 mt-3.5 text-left text-[12px] leading-[1.6] text-v2-text-secondary">
                  {card.scene}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-[23px] font-semibold text-v2-text-primary leading-[1.4]">{card.meaning}</p>
              <p className="text-[13px] text-brand-accent mt-3.5">想想英文怎么说?</p>
            </>
          )}
        </div>
        <Dots box={card.box} />
      </div>
    </div>
  )
}

export default function FlashCard({ card, onGrade }: Props): JSX.Element {
  const [flipped, setFlipped] = useState(false)
  const [dx, setDx] = useState(0)
  const [animated, setAnimated] = useState(false)
  const startX = useRef(0)
  const dragging = useRef(false)
  const moved = useRef(false)
  // 防重入：一张卡只评一次（挡按键重复/连按/双击；FlashCard 每卡按 key 重挂，下一张自动复位）
  const fired = useRef(false)

  // 直接飞出并回调（底部按钮 / 键盘 ←→ 用）
  const flyOut = (remembered: boolean): void => {
    if (fired.current) return
    fired.current = true
    setAnimated(true)
    setDx(remembered ? 520 : -520)
    window.setTimeout(() => onGrade(remembered), 180)
  }

  // 键盘快捷键：→ 熟知、← 重复（与底部按钮/滑动等价）。监听随本卡挂载/卸载，天然只作用于当前卡。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); flyOut(true) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); flyOut(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onClick = (): void => { if (!moved.current) setFlipped(f => !f) }   // 轻点翻面（拖动则忽略）
  const onTouchStart = (e: React.TouchEvent): void => {
    startX.current = e.touches[0].clientX
    dragging.current = true
    moved.current = false
    setAnimated(false)
  }
  const onTouchMove = (e: React.TouchEvent): void => {
    if (!dragging.current) return
    const d = e.touches[0].clientX - startX.current
    if (Math.abs(d) > 6) moved.current = true
    setDx(d)
  }
  const onTouchEnd = (): void => {
    if (!dragging.current) return
    dragging.current = false
    setAnimated(true)
    // 用函数式更新读「最新」位移，避免闭包里的 dx 落后导致飞不走
    setDx(cur => {
      if (cur > SWIPE_THRESHOLD)  { window.setTimeout(() => onGrade(true), 180);  return 520 }
      if (cur < -SWIPE_THRESHOLD) { window.setTimeout(() => onGrade(false), 180); return -520 }
      window.setTimeout(() => setAnimated(false), 180)
      return 0
    })
  }

  return (
    <div className="w-full select-none">
      <div
        style={{ transform: `translateX(${dx}px) rotate(${dx * 0.03}deg)`, transition: animated ? 'transform 0.2s ease' : 'none' }}
        onClick={onClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div style={{ perspective: 1000 }}>
          <div className="relative transition-transform duration-300" style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateX(180deg)' : 'none' }}>
            <Face card={card} back={false} />
            <Face card={card} back={true} />
          </div>
        </div>
      </div>

      {!flipped ? (
        <p className="text-center text-[13px] text-v2-text-secondary mt-[18px] flex items-center justify-center gap-1.5">
          <RotateCw size={14} />点击卡片翻面看英文
        </p>
      ) : (
        <div className="flex items-center justify-center gap-5 mt-[18px]">
          <button onClick={() => flyOut(false)} className="flex items-center gap-1 text-[13px] text-error active:opacity-60">
            <ArrowLeft size={15} />重复
          </button>
          <span className="text-[12px] text-[#D8D2CA]">左右滑动</span>
          <button onClick={() => flyOut(true)} className="flex items-center gap-1 text-[13px] text-[#3D7A38] active:opacity-60">
            熟知<ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
