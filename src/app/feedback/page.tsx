/**
 * @module   FeedbackPage
 * @desc     反馈卡片页外壳 — 唯一真源持有卡片数据与「该单源的」逻辑（唯一一次读暂存、唯一收藏写入点、
 *           唯一 savedCount、唯一清场点、唯一 Toast），按 lg 断点分发移动/桌面两套视图。
 *           两视图各自的「导航状态」留在各视图内（移动端 index 单卡、桌面端 center+decided 轮播），
 *           视图判定本视图处理完时回调 onAllDone，外壳据此清场（ref 守卫只清一次）。
 *           ⚠️ savedCount 只在【落库成功】后加（2026-08-07）：此前无条件累加，收藏失败也照加照翻卡，
 *           用户以为收藏成功、实际一条没进库。收藏的落库/归因/埋点见同目录 collect.ts。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { type JSX, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useNav } from '@/components/NavProgress'
import { formatMonthDay } from '@/lib/date'
import { getSessionPolishes, clearSessionPolishes } from '@/lib/storage'
import {
  consumePracticeRecordFailure,
  PRACTICE_RECORD_FAILED_EVENT,
  PRACTICE_RECORD_FAILED_MESSAGE,
} from '@/lib/practice-session-record'
import Toast from '@/components/Toast'
import { track } from '@/lib/client-events'
import type { CollectView } from '@/lib/event-schema'
import { makeCollectHandler } from './collect'
import type { SessionPolish } from '@/lib/types'
import FeedbackMobile from './FeedbackMobile'
import FeedbackDesktop from './FeedbackDesktop'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import type { FeedbackViewProps } from './types'

/**
 * 当前生效的是哪一套视图。两套 DOM 同时挂载、靠 `lg:hidden` / `hidden lg:block` 决定谁可见，
 * 组件自己是不知道的 —— 故按【同一条断点线】实测：lg = 1024px（tailwind 默认，本项目未覆写 screens）。
 * ⚠️ 改动布局的断点时这里必须跟着改，否则移动/桌面两格的口径会与实际可见的视图对不上。
 * matchMedia 在极老/异常环境可能缺失，取不到时按 'mobile' 记（本产品移动端占绝对多数，
 * 猜错的方向也与真实分布一致，不会把桌面那格灌大）。
 * @returns 'desktop' 或 'mobile'
 */
function currentView(): CollectView {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'mobile'
  return window.matchMedia('(min-width: 1024px)').matches ? 'desktop' : 'mobile'
}

export default function FeedbackPage(): JSX.Element {
  const { navigate } = useNav() // 回首页/退出跳首页走 navigate → 点击即亮顶部进度条（消冷缓存空窗）
  const [cards, setCards]      = useState<SessionPolish[]>([])
  const [index, setIndex]      = useState(0)
  const [savedCount, setSaved] = useState(0)
  const [loaded, setLoaded]    = useState(false)

  // 移动端滑动手势状态（桌面端不使用）
  const [offset, setOffset]     = useState(0)
  const [animated, setAnimated] = useState(false)
  const startXRef  = useRef(0)
  const isDragging = useRef(false)

  // 唯一一次读取本场暂存
  useEffect(() => {
    const list = getSessionPolishes()
    setCards(list)
    setLoaded(true)
    // 分母事件：收藏成败两条事件的「有多少次机会」。**空态（list.length === 0）照发**——
    // 那说明用户练完了却一句都没攒下，是本事件最重要的一格信号，不是「没数据不用发」。
    // try/catch 的理由同 collect.ts 的 safeTrack：这段跑在 effect 里，抛出去会直接把整页打崩，
    // 而它只是一条埋点 —— 埋点永远不许影响用户看到的东西。
    try {
      track('flow.feedback_rendered', { cardCount: list.length, view: currentView() })
    } catch (e) {
      console.error('[feedback] 展示埋点失败', e)
    }
  }, [])

  // 本页只有【一条】Toast，两个来源共用同一个 message 状态：打卡没存上 / 收藏没存上。
  // 为什么合并而不是挂两个 Toast：Toast 是 fixed bottom-6 居中的浮层，两个实例会重叠在同一位置互相压住，
  // 用户只看得到上面那条、还不知道底下压了什么。合并后「后来的覆盖先前的」，符合「最新那件事最要紧」。
  // 代价是同时发生时先前那条会被顶掉 —— 两件事各自独立、都不影响用户已优化的句子，可接受。
  const [toast, setToast] = useState<string | null>(null)

  // 打卡记录写失败的告知落点。练习页点「结束」就跳到这里，提示放在那边会被跳转直接冲掉，故收在本页：
  // 重试早于本页挂载就结束 → 挂载时消费标记；晚于挂载才结束 → 事件接住。两条路都指向同一条 Toast。
  useEffect(() => {
    if (consumePracticeRecordFailure()) setToast(PRACTICE_RECORD_FAILED_MESSAGE)
    // 事件路径也顺手消费掉标记：否则那枚标记会留到下一次进本页，弹一条已经提示过的陈旧提醒。
    const onFailed = (): void => { consumePracticeRecordFailure(); setToast(PRACTICE_RECORD_FAILED_MESSAGE) }
    window.addEventListener(PRACTICE_RECORD_FAILED_EVENT, onFailed)
    return () => window.removeEventListener(PRACTICE_RECORD_FAILED_EVENT, onFailed)
  }, [])

  const total   = cards.length
  const current = cards[index]
  const done    = loaded && total > 0 && index >= total   // 移动端 index 模型的完成判定
  const today   = formatMonthDay()

  // 唯一收藏写入点（两视图共用，视图内不许另写一份）：落库成功才加计数，失败弹 Toast 告知用户。
  // 落库/归因/埋点全在 ./collect 里，本处只接结果 → UI（那边可单测，见 __tests__/collect.test.ts）。
  // useMemo 空依赖：handler 内部持有「本场第几条」的计数器，重建会把序号清零。
  const onCollect = useMemo(
    () => makeCollectHandler({
      onSaved: () => setSaved((c) => c + 1),
      onFailed: (message) => setToast(message),
    }),
    [],
  )

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
      // 右滑收藏：走同一收藏真源 onCollect 后前进；左滑仅前进。
      // 手势收藏发生在外壳里，但它只可能来自移动端视图（桌面端没有拖拽手势），故这里代传 'mobile'。
      if (cur > 60)  { setTimeout(() => { if (current) onCollect(current, 'mobile'); skip(); setAnimated(false); setOffset(0) }, 180); return 500 }
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
    onBackHome: () => navigate('/'),
  }

  return (
    <>
      <div className="lg:hidden"><FeedbackMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 外壳（practice 激活）+ FeedbackDesktop 回顾舞台 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="practice" onExit={() => navigate('/')}>
          <FeedbackDesktop {...viewProps} />
        </FlowShellDesktop>
      </div>
      {/* 全页唯一一条 Toast：fixed 浮层，只渲染一次（移动/桌面共用），承载「打卡没存上」与
          「收藏没存上」两种提示。比默认 3.5s 长一些 —— 两句话都要读完两层意思
          （没存上 / 后果与还能怎么办），扫一眼的时间不够。 */}
      <Toast
        message={toast}
        onDismiss={() => setToast(null)}
        duration={6000}
      />
    </>
  )
}
