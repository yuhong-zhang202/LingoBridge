/**
 * @module   RequireAccountGate
 * @desc     试用墙守卫 — 已登录永远放行；匿名用户首次免费走完整圈（到达 /feedback 即标记），
 *           标记置位后在被守卫的入口（录音/题库/素材库）整页显示登录引导。
 * @author   LingoBridge
 * @created  2026-06-17
 */
'use client'
import { type JSX, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { getAccount } from '@/lib/auth'
import { isTrialDone } from '@/lib/storage'
import LoginPrompt from '@/app/profile/_components/LoginPrompt'

type GateState = 'loading' | 'allow' | 'block'

interface Props {
  children: ReactNode
}

/**
 * 阻断视图的撑高类。桌面端（lg 及以上）被守卫的三个页面根容器是 `min-h-screen`——普通 block，
 * 不是 flex 容器，`flex-1` 在其中会被浏览器直接丢弃，高度塌成内容高、卡片贴在 TopNav 底下；
 * 移动端根容器是 `h-dvh flex flex-col`，`flex-1` 本就生效，故本类只挂 lg 断点，移动端零变化。
 *
 * 72px = TopNav 桌面高度（TopNav.tsx:40 `lg:h-[72px]`，sticky 仍占正常流），减掉它才是内容区净高。
 * 这里用 min-height 而非 height 是刻意的降级设计：它只是「至少这么高」的下限，
 * 一旦 TopNav 改高或顶部将来多出 UpdateBanner 之类元素，最坏结果只是卡片视觉重心略微偏下、
 * 页面多出几十像素可滚动，不会溢出、不会裁切、不会出现「居中导致顶部滚不到」的 flex 塌陷。
 * 若哪天 TopNav 高度真的变了，此处需同步——已在 TopNav 侧无常量可引用，故以本注释锚定耦合点。
 */
const BLOCK_MIN_H = 'lg:min-h-[calc(100dvh-72px)]'

export default function RequireAccountGate({ children }: Props): JSX.Element {
  const [state, setState] = useState<GateState>('loading')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const acct = await getAccount()
        if (cancelled) return
        const loggedIn = !!acct && !acct.isAnonymous && !!acct.email
        if (loggedIn) {
          setState('allow')
        } else if (isTrialDone()) {
          setState('block')
        } else {
          setState('allow')
        }
      } catch {
        if (!cancelled) setState(isTrialDone() ? 'block' : 'allow')
      }
    })()
    return () => { cancelled = true }
  }, [])

  // loading 占位与 block 视图撑同样的高度，避免桌面端「loading 时 0 高、判定完卡片突然从零高度里弹出」的跳变
  if (state === 'loading') return <div className={`flex-1 ${BLOCK_MIN_H}`} />
  if (state === 'allow') return <>{children}</>

  // block
  return (
    <div className={`flex-1 ${BLOCK_MIN_H} flex flex-col items-center justify-center px-6`}>
      {/* 限宽层：LoginPrompt 自身不设宽度，在 items-center 的列向 flex 里会被收缩到内容宽，
          桌面端显得又窄又飘；包一层定宽让卡片与「返回首页」共享同一视觉栏宽 */}
      <div className="w-full max-w-[400px] lg:max-w-[560px] flex flex-col items-center">
        {/* titleAs="h1"：阻断时 children 未渲染，页面自身的 ManageHeader（唯一 h1 来源）不存在，
            不提升这行就整页零 heading，读屏用户无法靠标题定位当前页面 */}
        <LoginPrompt
          className="w-full"
          title="想继续练习？登录后接着用"
          subtitle="你刚才的故事和收藏都在，登录一条都不会丢"
          titleAs="h1"
        />
        {/* 用 Link 而非 button：它的实际行为就是导航，链接才能中键新标签、右键复制地址，
            读屏也才会播报成「链接」。min-h-[44px] 对齐 EmptyState text 变体的触控命中区（WCAG 2.5.5），
            ChevronLeft 与 /settings 返回键（commit bfc87bb）保持同一视觉范式 */}
        <Link
          href="/"
          className="mt-4 min-h-[44px] inline-flex items-center justify-center gap-1 px-3 text-[13px] text-v2-text-muted"
        >
          <ChevronLeft size={16} />
          返回首页
        </Link>
      </div>
    </div>
  )
}
