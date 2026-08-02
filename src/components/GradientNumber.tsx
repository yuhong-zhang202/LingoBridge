/**
 * @module   GradientNumber
 * @desc     渐变描边圆形序号 — 外层渐变 1px + 内层白底 + 渐变色数字
 * @author   LingoBridge
 * @created  2026-05-28
 */

import { BRAND_GRADIENT } from '@/lib/constants'

export default function GradientNumber({ n }: { n: number }) {
  return (
    <div
      style={{ background: BRAND_GRADIENT, padding: 1, borderRadius: '50%', width: 20, height: 20, flexShrink: 0 }}
    >
      <div
        className="w-full h-full rounded-full bg-white flex items-center justify-center"
      >
        <span
          className="text-[0.6875rem] font-bold leading-none"
          style={{ background: BRAND_GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
        >
          {n}
        </span>
      </div>
    </div>
  )
}
