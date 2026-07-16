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
    // 纯装饰：进度数字在相邻的「已收集 n / m」文本里，无需重复播报
    <div className="flex flex-wrap gap-[3px]" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          // 未填充段用 token 类；已填充段是插值色（数据可视化，非主题色值），只能内联
          className={`rounded-sm ${i < filled ? '' : 'bg-bg-muted'}`}
          style={{ width: 12, height: 4, background: i < filled ? lerpColor(i / Math.max(filled - 1, 1)) : undefined }}
        />
      ))}
    </div>
  )
}
