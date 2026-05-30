/**
 * @module   GradientNumber
 * @desc     渐变描边圆形序号 — 外层渐变 1px + 内层白底 + 渐变色数字
 * @author   LingoBridge
 * @created  2026-05-28
 */

const GRAD = 'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80))'

export default function GradientNumber({ n }: { n: number }) {
  return (
    <div
      style={{ background: GRAD, padding: 1, borderRadius: '50%', width: 20, height: 20, flexShrink: 0 }}
    >
      <div
        className="w-full h-full rounded-full bg-white flex items-center justify-center"
      >
        <span
          className="text-[11px] font-bold leading-none"
          style={{ background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
        >
          {n}
        </span>
      </div>
    </div>
  )
}
