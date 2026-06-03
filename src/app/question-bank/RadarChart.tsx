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

  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className="mx-auto block">
      {[0.33, 0.66, 1].map((l, i) => <path key={i} d={gridPath(l)} fill="none" stroke="#EEEBE6" strokeWidth="0.5" />)}
      {angles.map((a, i) => {
        const [x, y] = xy(a, R)
        return <line key={i} x1={CX} y1={CY} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="#EEEBE6" strokeWidth="0.5" />
      })}
      <path d={dataPath} fill="rgba(212,135,90,0.08)" stroke="#D4875A" strokeWidth="1.2" />
      {dimensions.map((d, i) => {
        const [x, y] = xy(angles[i], R * Math.max(d.value, 0.04))
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3" fill={d.value > 0 ? '#D4875A' : '#CCC'} />
      })}
      {dimensions.map((d, i) => {
        const [x, y] = xy(angles[i], LABEL_R)
        return <text key={i} x={x.toFixed(1)} y={y.toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill={d.value > 0 ? '#2C2420' : '#A89990'} fontFamily="'PingFang SC',sans-serif">{d.name}</text>
      })}
    </svg>
  )
}
