/**
 * @module   SegmentDots
 * @desc     分段胶囊进度 — 渐变色（橙→绿）可视化完成比例
 * @author   LingoBridge
 * @created  2026-06-01
 */

interface Props { total: number; filled: number }

function lerpColor(t: number): string {
  const r = Math.round(212 + (123 - 212) * t)
  const g = Math.round(135 + (166 - 135) * t)
  const b = Math.round(90  + (153 - 90)  * t)
  const a = (0.70 + (0.50 - 0.70) * t).toFixed(2)
  return `rgba(${r},${g},${b},${a})`
}

export default function SegmentDots({ total, filled }: Props) {
  return (
    <div className="flex flex-wrap gap-[3px]">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className="rounded-sm"
          style={{ width: 12, height: 4, background: i < filled ? lerpColor(i / Math.max(filled - 1, 1)) : '#EEEBE6' }}
        />
      ))}
    </div>
  )
}
