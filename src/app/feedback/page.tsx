/**
 * @module   FeedbackPage
 * @desc     反馈卡片页外壳 — 集中持有卡片数据与交互逻辑（读取本场暂存/收藏/跳过/拖拽），
 *           按 lg 断点分发移动/桌面两套视图。逻辑单实例，两视图仅接收状态与回调做展示。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatMonthDay } from '@/lib/date'
import { getSessionPolishes, clearSessionPolishes, addSavedPhrase, markTrialDone } from '@/lib/storage'
import type { SessionPolish } from '@/lib/types'
import FeedbackMobile from './FeedbackMobile'
import FeedbackDesktop from './FeedbackDesktop'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import type { FeedbackViewProps } from './types'

export default function FeedbackPage(): JSX.Element {
  const router = useRouter()
  const [cards, setCards]      = useState<SessionPolish[]>([])
  const [index, setIndex]      = useState(0)
  const [savedCount, setSaved] = useState(0)
  const [loaded, setLoaded]    = useState(false)

  // 滑动手势状态
  const [offset, setOffset]     = useState(0)
  const [animated, setAnimated] = useState(false)
  const startXRef  = useRef(0)
  const isDragging = useRef(false)

  // 进页面读本场暂存；同时标记「免费一圈走完」给试用墙用
  useEffect(() => { setCards(getSessionPolishes()); setLoaded(true); markTrialDone() }, [])

  const total   = cards.length
  const current = cards[index]
  const done    = loaded && total > 0 && index >= total
  const today   = formatMonthDay()

  // 收尾时清掉本场暂存（避免返回重复）
  useEffect(() => { if (done) clearSessionPolishes() }, [done])

  const collect = () => {
    if (!current) return
    addSavedPhrase({ ...current, id: `${Date.now()}-${index}`, createdAt: new Date().toISOString() })
    setSaved(c => c + 1)
    setIndex(i => i + 1)
  }
  const skip = () => setIndex(i => i + 1)

  const dragStart = (x: number) => { startXRef.current = x; isDragging.current = true; setAnimated(false) }
  const dragMove  = (x: number) => { if (isDragging.current) setOffset(x - startXRef.current) }
  const dragEnd = () => {
    if (!isDragging.current) return
    isDragging.current = false
    setAnimated(true)
    setOffset(cur => {
      if (cur > 60)  { setTimeout(() => { collect(); setAnimated(false); setOffset(0) }, 180); return 500 }
      if (cur < -60) { setTimeout(() => { skip();    setAnimated(false); setOffset(0) }, 180); return -500 }
      setTimeout(() => setAnimated(false), 180)
      return 0
    })
  }

  const viewProps: FeedbackViewProps = {
    loaded,
    total,
    index,
    savedCount,
    done,
    current,
    today,
    offset,
    animated,
    onDragStart: dragStart,
    onDragMove: dragMove,
    onDragEnd: dragEnd,
    onCollect: collect,
    onSkip: skip,
    onBackHome: () => router.push('/'),
  }

  return (
    <>
      <div className="lg:hidden"><FeedbackMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 外壳（practice 激活）+ FeedbackDesktop 回顾舞台 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="practice" onExit={() => router.push('/')}>
          <FeedbackDesktop {...viewProps} />
        </FlowShellDesktop>
      </div>
    </>
  )
}
