/**
 * @module   PortraitRadar
 * @desc     五维画像雷达图 SVG 组件，用于 Profile「我的画像」卡
 * @author   LingoBridge
 * @created  2026-05-31
 */
'use client'

const CX = 120
const CY = 91
const R  = 73

const ANGLE_RADS = [-90, -18, 54, 126, 198].map(d => d * Math.PI / 180)

const LABELS: { text: string; x: number; y: number; anchor: 'middle' | 'start' | 'end' }[] = [
  { text: '情绪内核', x: 120,  y: 10,  anchor: 'middle' },
  { text: '人际羁绊', x: 199,  y: 64,  anchor: 'start'  },
  { text: '场域',     x: 169,  y: 167, anchor: 'start'  },
  { text: '精神角落', x: 71,   y: 167, anchor: 'end'    },
  { text: '成长演进', x: 41,   y: 64,  anchor: 'end'    },
]

const GRID_STROKE = 'rgba(168,153,144,0.18)'

/**
 * 将 fraction 数组转换为 SVG polygon points 字符串
 * @param fractions 每个顶点的填充比例，0–1
 * @returns SVG points 属性字符串
 */
function polyPts(fractions: number[]): string {
  return ANGLE_RADS.map((a, i) =>
    `${(CX + R * fractions[i] * Math.cos(a)).toFixed(2)},${(CY + R * fractions[i] * Math.sin(a)).toFixed(2)}`
  ).join(' ')
}

/**
 * 等比网格层 points
 * @param level 0–1 比例
 */
function gridPts(level: number): string {
  return polyPts(new Array<number>(5).fill(level))
}

export interface PortraitRadarProps {
  /** 5 维数据，顺序：情绪内核 / 人际羁绊 / 场域 / 精神角落 / 成长演进，值域 0–1 */
  values: readonly [number, number, number, number, number]
}

/**
 * 五维雷达图
 * @param values 5 个维度的得分，0–1
 */
export default function PortraitRadar({ values }: PortraitRadarProps): JSX.Element {
  const dataPoints = polyPts([...values])

  return (
    <svg
      viewBox="-24 -6 288 188"
      width={288}
      height={188}
      style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}
    >
      {/* 4 层网格五边形 */}
      {[0.25, 0.5, 0.75, 1.0].map(level => (
        <polygon
          key={level}
          points={gridPts(level)}
          fill="none"
          stroke={GRID_STROKE}
          strokeWidth={0.8}
        />
      ))}

      {/* 5 根轴线 */}
      {ANGLE_RADS.map((a, i) => (
        <line
          key={i}
          x1={CX}
          y1={CY}
          x2={(CX + R * Math.cos(a)).toFixed(2)}
          y2={(CY + R * Math.sin(a)).toFixed(2)}
          stroke={GRID_STROKE}
          strokeWidth={0.8}
        />
      ))}

      {/* 数据填充五边形 */}
      <polygon
        points={dataPoints}
        fill="rgba(212,135,90,0.18)"
        stroke="#D4875A"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />

      {/* 数据顶点圆 */}
      {ANGLE_RADS.map((a, i) => (
        <circle
          key={i}
          cx={(CX + R * values[i] * Math.cos(a)).toFixed(2)}
          cy={(CY + R * values[i] * Math.sin(a)).toFixed(2)}
          r={2.4}
          fill="#D4875A"
        />
      ))}

      {/* 标签 */}
      {LABELS.map(({ text, x, y, anchor }) => (
        <text
          key={text}
          x={x}
          y={y}
          textAnchor={anchor}
          fontSize={10}
          fill="#6B5B52"
          fontFamily="'Plus Jakarta Sans', 'PingFang SC', sans-serif"
          fontWeight={500}
        >
          {text}
        </text>
      ))}
    </svg>
  )
}
