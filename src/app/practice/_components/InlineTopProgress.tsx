/**
 * @module   InlineTopProgress
 * @desc     练习页「转写排队自动重试」专用的页内顶部涓流进度条 —— 视觉与全局 NavProgress 一致
 *           （同一 BRAND_GRADIENT、同一 h-[3px]/z-[100]、同一 10s cubic-bezier 涓流爬到 90%），
 *           但【刻意不复用 useNav】：全局条只被路由跳转（useTransition）点亮，本场景是页内自处理的
 *           排队等待、根本不触发导航，故必须自渲染一条独立的条。视觉条 aria-hidden，播报交给内嵌的
 *           sr-only status 区（挂载即播「人多，正在为你重试」，成功/失败时组件卸载、播报随之消失）。
 *           motion-reduce：不做爬升动画，静态停在 30% 宽。仅在 phase='queued' 时挂载。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { type JSX, useEffect, useState } from 'react'
import { BRAND_GRADIENT } from '@/lib/constants'

/**
 * 页内顶部排队进度条（转写自动重试等待时挂载）。
 * @returns  固定视口顶部的涓流条（装饰，aria-hidden）+ sr-only 排队播报
 */
export default function InlineTopProgress(): JSX.Element {
  // 先给非零起点触发 CSS width 过渡，再爬向 90%（长 duration ease-out 形成先快后慢的涓流感，抄 NavProgress）
  const [width, setWidth] = useState(8)
  // 减少动效偏好：不做爬升，静态停 30%（inline width 会盖过 class，故用状态切 transition/width）
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const r = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setReduced(r)
    if (r) { setWidth(30); return undefined }
    const t = window.setTimeout(() => setWidth(90), 60)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[100] h-[3px]"
        style={{
          width: `${width}%`,
          background: BRAND_GRADIENT,
          transition: reduced ? 'none' : 'width 10s cubic-bezier(0.1, 0.9, 0.2, 1)',
        }}
      />
      {/* 读屏播报：排队时告知「人多，正在为你重试」；组件仅在 queued 挂载，成功/失败即卸载、播报清空。 */}
      <span role="status" aria-live="polite" className="sr-only">人多，正在为你重试</span>
    </>
  )
}
