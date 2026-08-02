/**
 * @module   RadarChart
 * @desc     六边形雷达图 — 展示六维度覆盖分布
 * @author   LingoBridge
 * @created  2026-06-01
 */

interface Props {
  dimensions: { name: string; value: number }[]
  size?: number
}

const CX = 100, CY = 100, R = 65, LABEL_R = 83

function xy(a: number, r: number): [number, number] {
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)]
}

export default function RadarChart({ dimensions, size = 200 }: Props) {
  const N = dimensions.length
  const angles = dimensions.map((_, i) => i * (2 * Math.PI / N) - Math.PI / 2)
  const gridPath = (l: number) =>
    angles.map(a => xy(a, R * l)).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('') + 'Z'
  const dataPath =
    dimensions.map((d, i) => xy(angles[i], R * Math.max(d.value, 0.04))).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('') + 'Z'

  // aria-hidden：右侧维度网格已把每个维度的名称与 lit/total 以文本呈现，图形无需重复播报
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className="mx-auto block" aria-hidden="true">
      {[0.33, 0.66, 1].map((l, i) => <path key={i} d={gridPath(l)} fill="none" className="stroke-bg-muted" strokeWidth="0.5" />)}
      {angles.map((a, i) => {
        const [x, y] = xy(a, R)
        return <line key={i} x1={CX} y1={CY} x2={x.toFixed(1)} y2={y.toFixed(1)} className="stroke-bg-muted" strokeWidth="0.5" />
      })}
      <path d={dataPath} className="fill-brand-primary/[0.08] stroke-brand-primary" strokeWidth="1.2" />
      {dimensions.map((d, i) => {
        const [x, y] = xy(angles[i], R * Math.max(d.value, 0.04))
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3" className={d.value > 0 ? 'fill-brand-primary' : 'fill-v2-text-muted'} />
      })}
      {dimensions.map((d, i) => {
        const [x, y] = xy(angles[i], LABEL_R)
        return <text key={i} x={x.toFixed(1)} y={y.toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize="0.5625rem" className={`font-sans ${d.value > 0 ? 'fill-v2-text-primary' : 'fill-v2-text-muted'}`}>{d.name}</text>
      })}
    </svg>
  )
}
