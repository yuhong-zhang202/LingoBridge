/**
 * @module   FeedbackPage
 * @desc     反馈卡片页外壳 — 唯一真源持有卡片数据与「该单源的」逻辑（唯一一次读暂存、唯一收藏写入点、
 *           唯一 savedCount、唯一清场点），按 lg 断点分发移动/桌面两套视图。
 *           两视图各自的「导航状态」留在各视图内（移动端 index 单卡、桌面端 center+decided 轮播），
 *           视图判定本视图处理完时回调 onAllDone，外壳据此清场（ref 守卫只清一次）。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { type JSX, useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatMonthDay } from '@/lib/date'
import { getSessionPolishes, clearSessionPolishes, markTrialDone } from '@/lib/storage'
import { addSavedPhrase } from '@/lib/db/saved-phrases'
import { refreshSavedPhrases } from '@/hooks/library-data'
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

  // 移动端滑动手势状态（桌面端不使用）
  const [offset, setOffset]     = useState(0)
  const [animated, setAnimated] = useState(false)
  const startXRef  = useRef(0)
  const isDragging = useRef(false)

  // 唯一一次读取本场暂存；同时标记「免费一圈走完」给试用墙用
  useEffect(() => { setCards(getSessionPolishes()); setLoaded(true); markTrialDone() }, [])

  const total   = cards.length
  const current = cards[index]
  const done    = loaded && total > 0 && index >= total   // 移动端 index 模型的完成判定
  const today   = formatMonthDay()

  // 唯一收藏写入点：接收「要收藏的那张卡」，异步落库（id/createdAt 由 DB 生成）并累加计数（与导航模型解耦）。
  // 写入直接依赖网络，失败仅记日志、不回滚本地计数（离线降级）；成功后失效收藏缓存供素材库读到最新。
  const onCollect = (polish: SessionPolish): void => {
    void addSavedPhrase(polish)
      .then(() => refreshSavedPhrases())
      .catch((e) => console.error('[feedback] 收藏落库失败', e))
    setSaved((c) => c + 1)
  }

  // 唯一清场点：某视图判定本视图处理完时调用，ref 守卫保证只清一次（两视图共用此回调）
  const clearedRef = useRef(false)
  const onAllDone = useCallback((): void => {
    if (clearedRef.current) return
    clearedRef.current = true
    clearSessionPolishes()
  }, [])

  // 移动端导航：跳过 / 前进到下一张
  const skip = (): void => setIndex((i) => i + 1)

  const dragStart = (x: number): void => { startXRef.current = x; isDragging.current = true; setAnimated(false) }
  const dragMove  = (x: number): void => { if (isDragging.current) setOffset(x - startXRef.current) }
  const dragEnd = (): void => {
    if (!isDragging.current) return
    isDragging.current = false
    setAnimated(true)
    setOffset((cur) => {
      // 右滑收藏：走同一收藏真源 onCollect 后前进；左滑仅前进
      if (cur > 60)  { setTimeout(() => { if (current) onCollect(current); skip(); setAnimated(false); setOffset(0) }, 180); return 500 }
      if (cur < -60) { setTimeout(() => { skip(); setAnimated(false); setOffset(0) }, 180); return -500 }
      setTimeout(() => setAnimated(false), 180)
      return 0
    })
  }

  const viewProps: FeedbackViewProps = {
    cards,
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
    onCollect,
    onSkip: skip,
    onAllDone,
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
