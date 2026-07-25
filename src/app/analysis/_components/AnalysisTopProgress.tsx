/**
 * @module   AnalysisTopProgress
 * @desc     题目分析页「落地后页内等 AI 分析」专用的顶部涓流进度条 —— 与全局 NavProgress、练习页
 *           InlineTopProgress 视觉一致（同一 BRAND_GRADIENT、h-[3px]/z-[100]、10s cubic-bezier 涓流爬到 90%）。
 *           这里【不复用 useNav】：分析是落地本页后页内 POST /api/analysis（AI 调用，较慢）触发的等待，
 *           根本不发生路由跳转、点不亮全局条，故必须自渲染一条独立的条（与练习页排队条同理，但那条在 practice
 *           目录且文案是「排队重试」，语义/归属都不同，不共用）。视觉条 aria-hidden，播报交给内嵌 sr-only status。
 *           motion-reduce：不做爬升动画，静态停在 30% 宽。仅在分析加载态（loading）挂载。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { type JSX, useEffect, useState } from 'react'
import { BRAND_GRADIENT } from '@/lib/constants'

/**
 * 分析页页内顶部涓流进度条（AI 生成分析等待时挂载）。
 * @returns  固定视口顶部的涓流条（装饰，aria-hidden）+ sr-only 加载播报
 */
export default function AnalysisTopProgress(): JSX.Element {
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
      {/* 读屏播报：加载时告知「正在分析这道题」；组件仅在 loading 挂载，完成/失败即卸载、播报清空。 */}
      <span role="status" aria-live="polite" className="sr-only">正在分析这道题，请稍候</span>
    </>
  )
}
