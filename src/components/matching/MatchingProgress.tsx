/**
 * @module   MatchingProgress
 * @desc     匹配等待期的分阶段进度提示（桌面 + 移动共用）—— 在骨架屏之上加一句随时间推进的文案
 *           和一条进度条。匹配是一次 20–47 秒的真实模型调用（萃取 + 重排），此前这段时间里
 *           界面上只有一块不动的灰色骨架，一个字都没有，用户无从判断是在跑还是卡死了。
 *           纯前端计时，不依赖后端返回任何进度信号；文案/百分比的计算在 lib/matching-progress。
 * @author   LingoBridge
 * @created  2026-07-20
 */
'use client'
import { useEffect, useState } from 'react'
import { BRAND_GRADIENT } from '@/lib/constants'
import { progressPct, stageText } from '@/lib/matching-progress'

/** 刷新节拍：文案与进度条都靠它推进；配合 CSS transition 视觉上是连续的 */
const TICK_MS = 250

/**
 * 匹配等待进度：一句分阶段文案 + 一条渐近进度条。
 * 挂载即开始计时（父组件仅在 loading 时渲染它），卸载清理 interval。
 */
export default function MatchingProgress({ className = '' }: { className?: string }) {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    // 用起始时刻做差而非累加计数：标签页被切到后台时 interval 会被节流，累加会越走越慢。
    const startedAt = Date.now()
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  const pct = progressPct(elapsedMs)

  return (
    <div className={className}>
      {/* aria-live=polite：文案切换时读屏播报，但不打断用户当前操作 */}
      <p className="text-[13px] text-v2-text-secondary" aria-live="polite">
        {stageText(elapsedMs)}
      </p>
      <div
        className="mt-2.5 h-1 w-full rounded-full bg-black/[0.06] overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label="匹配进度"
      >
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-linear motion-reduce:transition-none"
          style={{ width: `${pct}%`, backgroundImage: BRAND_GRADIENT }}
        />
      </div>
    </div>
  )
}
