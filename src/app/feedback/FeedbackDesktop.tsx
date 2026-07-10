/**
 * @module   FeedbackDesktop
 * @desc     反馈卡片页桌面端「回顾台」—— 三卡 coverflow：中心清晰、两侧模糊缩小（环形取位，两边常有卡）；
 *           hover 侧卡或 ←/→ 把它滑到中心，收藏/跳过作用于中心卡并自动前进，全部处理完显示完成态。
 *           自持数据：直接读 getSessionPolishes() 本场暂存，收藏 addSavedPhrase、收尾 clearSessionPolishes。
 * @author   LingoBridge
 * @created  2026-07-04
 */
'use client'
import { useEffect, useRef, useState } from 'react'
import { X, Heart, Sparkles } from 'lucide-react'
import FeedbackCard from '@/components/FeedbackCard'
import GradientButton from '@/components/GradientButton'
import { formatMonthDay } from '@/lib/date'
import { getSessionPolishes, addSavedPhrase, clearSessionPolishes } from '@/lib/storage'
import type { SessionPolish } from '@/lib/types'
import type { FeedbackViewProps } from './types'

const partLabel = (p: 1 | 2 | 3) => `Part ${p}` as 'Part 1' | 'Part 2' | 'Part 3'

/** 侧卡水平偏移（间距宽度） */
const COVERFLOW_OFFSET = 420

/** 终态（空态 / 完成态）：极简居中 —— 星标图标 + 文案 + 回首页，无卡片盒子。
 *  tone 区分空态（暖橙）/完成态（绿蓝成功感）。*/
function TerminalState({ tone, title, desc, onBackHome }: {
  tone: 'primary' | 'accent'; title: string; desc: string; onBackHome: () => void
}): JSX.Element {
  const iconClass = tone === 'accent' ? 'text-brand-accent' : 'text-brand-primary'
  return (
    <div className="flex flex-col items-center text-center gap-4 max-w-[380px]">
      <Sparkles size={40} className={iconClass} />
      <p className="text-[24px] font-bold text-v2-text-primary">{title}</p>
      <p className="text-[15px] text-v2-text-muted leading-relaxed">{desc}</p>
      <GradientButton onClick={onBackHome} className="mt-3 px-6 py-3 rounded-full text-[15px] font-medium">回首页</GradientButton>
    </div>
  )
}

export default function FeedbackDesktop({ onBackHome }: FeedbackViewProps): JSX.Element {
  const [cards, setCards]      = useState<SessionPolish[]>([])
  const [loaded, setLoaded]    = useState(false)
  const [decided, setDecided]  = useState<Set<number>>(new Set())
  const [center, setCenter]    = useState(0)
  const [savedCount, setSaved] = useState(0)

  // 进页面读本场暂存（客户端读，避免 hydration 不一致）
  useEffect(() => { setCards(getSessionPolishes()); setLoaded(true) }, [])

  const remaining = cards.map((p, id) => ({ p, id })).filter(x => !decided.has(x.id))
  const total   = cards.length
  const isEmpty = loaded && total === 0
  const done    = loaded && total > 0 && remaining.length === 0
  const today = formatMonthDay()

  // 全部处理完清掉本场暂存（避免返回重复），只清一次
  const clearedRef = useRef(false)
  useEffect(() => {
    if (done && !clearedRef.current) { clearedRef.current = true; clearSessionPolishes() }
  }, [done])

  // remaining 收缩后夹紧 center，让被处理卡的下一张顺位居中
  useEffect(() => {
    setCenter(c => Math.min(c, Math.max(0, remaining.length - 1)))
  }, [remaining.length])

  const goPrev = () => setCenter(c => Math.max(0, c - 1))
  const goNext = () => setCenter(c => Math.min(remaining.length - 1, c + 1))
  const decide = (collect: boolean) => {
    const item = remaining[center]
    if (!item) return
    if (collect) {
      // SessionPolish 无 id/createdAt，收藏时补齐成 SavedPhrase（与移动端 addSavedPhrase 一致）
      addSavedPhrase({ ...cards[item.id], id: `${Date.now()}-${item.id}`, createdAt: new Date().toISOString() })
      setSaved(s => s + 1)
    }
    setDecided(prev => { const n = new Set(prev); n.add(item.id); return n })
  }

  // 键盘：←/→ 切换卡片、Esc 退出（仅桌面断点生效）
  const latest = useRef({ goPrev, goNext, onBackHome })
  latest.current = { goPrev, goNext, onBackHome }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return
      if (e.key === 'ArrowLeft')       { e.preventDefault(); latest.current.goPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); latest.current.goNext() }
      else if (e.key === 'Escape')     { latest.current.onBackHome() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 未读完暂存前留空，避免服务端/客户端首帧不一致
  if (!loaded) return <div className="min-h-[calc(100vh-72px)]" />

  if (isEmpty) {
    return (
      <div className="min-h-[calc(100vh-72px)] flex flex-col items-center justify-center px-8 pt-8 pb-40">
        <TerminalState
          tone="primary"
          title="这次没有要回顾的句子"
          desc="练习时点句子左上角的 ✨ 星标，就能把更好的表达攒到这里。"
          onBackHome={onBackHome}
        />
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-[calc(100vh-72px)] flex flex-col items-center justify-center px-8 pt-8 pb-40">
        <TerminalState
          tone="accent"
          title="这次回顾完成啦"
          desc={`你留下了 ${savedCount} 句更好的表达，慢慢就攒成你自己的表达库。`}
          onBackHome={onBackHome}
        />
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-72px)] flex flex-col items-center justify-center px-8 pt-6 pb-24">
      <p className="text-[13px] text-v2-text-muted mb-8 tabular-nums">本场回顾 · 还剩 {remaining.length} / {total}</p>

      {/* 三卡 coverflow：中心清晰、两侧模糊缩小；hover 侧卡滑到中心。
          环形取位——首张左侧显示末张、末张右侧显示首张，保证两边都有虚化卡（remaining≥3 时）。 */}
      <div className="relative w-full h-[480px] flex items-center justify-center overflow-hidden mb-8">
        {remaining.map((item, i) => {
          const n = remaining.length
          let rel = i - center
          if (rel >  n / 2) rel -= n
          if (rel < -n / 2) rel += n
          const isCenter = rel === 0
          const visible  = Math.abs(rel) <= 1
          return (
            <div
              key={item.id}
              onMouseEnter={() => { if (!isCenter && visible) setCenter(i) }}
              className="absolute transition-[transform,filter,opacity] duration-300 ease-out"
              style={{
                transform: `translateX(${rel * COVERFLOW_OFFSET}px) scale(${isCenter ? 1 : 0.82})`,
                filter: isCenter ? 'none' : 'blur(3px)',
                opacity: visible ? (isCenter ? 1 : 0.4) : 0,
                zIndex: isCenter ? 10 : 5,
                pointerEvents: visible ? 'auto' : 'none',
                cursor: isCenter ? 'default' : 'pointer',
              }}
            >
              <div className="w-[400px]">
                <FeedbackCard
                  part={partLabel(item.p.part)}
                  originalSentence={item.p.original}
                  aiOptimized={item.p.optimized}
                  keywords={[]}
                  date={today}
                  compact
                  className={isCenter ? 'shadow-[0_8px_28px_rgba(0,0,0,0.10)]' : 'shadow-[0_2px_12px_rgba(0,0,0,0.06)]'}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* 动作簇：作用于中心卡 */}
      <div className="flex gap-3 w-full max-w-[400px]">
        <button
          onClick={() => decide(false)}
          aria-label="跳过"
          className="btn-ghost flex-1 h-[48px] transition-[border-color,transform] duration-150 hover:border-black/25 active:scale-[0.97]"
        >
          <X size={15} className="text-v2-text-muted" />
        </button>
        <GradientButton
          onClick={() => decide(true)}
          className="flex-1 h-[48px] flex items-center justify-center gap-2 rounded-full transition-[transform,box-shadow] duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_22px_rgba(0,0,0,0.09)]"
        >
          <Heart size={16} className="text-v2-text-secondary" />
          <span className="text-[13px] font-semibold text-v2-text-secondary">收藏</span>
        </GradientButton>
      </div>

      <p className="mt-6 text-[12px] text-v2-text-muted">← → 切换卡片 · Esc 退出</p>
    </div>
  )
}
