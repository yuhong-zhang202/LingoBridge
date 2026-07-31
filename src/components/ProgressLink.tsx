/**
 * @module   ProgressLink
 * @desc     内部导航 <Link> + 顶部进度条反馈的一体件 —— 替代裸 <Link href="/...">，消除「点击 → 目标页
 *           挂载」空窗的无反馈感（无痕/冷缓存下这段更长，易被当成卡死/bug）。
 *           左键普通点击 → 走 navigate()（点击当帧点亮 NavProgress 进度条，复用其 useTransition 自动收尾）；
 *           修饰键(⌘/Ctrl/Shift/Alt)/中键/target=_blank/外部或对象 href 一律【不拦截】→ 保留原生 anchor 语义
 *           （新标签打开、右键复制链接等）。href 仍渲染在 <a> 上，SEO/可访问性不受影响。
 * @author   LingoBridge
 * @created  2026-07-31
 */
'use client'
import Link from 'next/link'
import { type ComponentProps, type MouseEvent } from 'react'
import { useNav } from './NavProgress'

type Props = ComponentProps<typeof Link>

export default function ProgressLink({ href, onClick, target, ...rest }: Props): React.JSX.Element {
  const { navigate } = useNav()
  const handleClick = (e: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(e) // 先跑调用方自己的 onClick；它若 preventDefault 则完全让位
    if (e.defaultPrevented) return
    // 只接管「普通左键、无修饰键、非新标签意图」的【内部字符串 href】；其余交还浏览器原生（新标签/复制等）。
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (target && target !== '_self') return
    if (typeof href !== 'string' || !href.startsWith('/')) return
    e.preventDefault()
    navigate(href) // 点击当帧 isNavigating=true → 顶部进度条立刻亮（含慢跳转安抚文案）
  }
  return <Link href={href} target={target} onClick={handleClick} {...rest} />
}
