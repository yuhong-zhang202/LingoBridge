/**
 * @module   PortraitRadar
 * @desc     六维画像雷达图 SVG 组件，用于 Profile「我的画像」卡（桌面 PortraitCard / 移动 LoggedInView 共用）。
 *           维度名称与顺序同 getDimensionScores 的 ALL_DIMENSIONS、题库 DimensionTab 对齐。
 * @author   LingoBridge
 * @created  2026-05-31
 */
'use client'

const CX = 120
const CY = 95
const R  = 73
/** 标签落在数据区外侧 12px 处 */
const LABEL_R = 85

/** 六维顺序必须与 getDimensionScores 返回顺序一致（emotion→value），否则轴与值错位 */
const DIMENSIONS = ['情绪内核', '人际羁绊', '空间感知', '精神栖所', '成长演进', '价值底色'] as const

/** 六边形顶点朝上：-90° 起每 60° 一个轴 */
const ANGLE_RADS = [-90, -30, 30, 90, 150, 210].map(d => d * Math.PI / 180)

/** 标签位置由角度推导：正上/正下居中，右侧左对齐、左侧右对齐；侧向标签下移半个字高做垂直居中 */
const LABELS: { text: string; x: number; y: number; anchor: 'middle' | 'start' | 'end' }[] =
  ANGLE_RADS.map((a, i) => {
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const vertical = Math.abs(cos) < 1e-6
    return {
      text: DIMENSIONS[i],
      x: Number((CX + LABEL_R * cos).toFixed(1)),
      y: Number((CY + LABEL_R * sin + (vertical ? 0 : 3.5)).toFixed(1)),
      anchor: vertical ? 'middle' : cos > 0 ? 'start' : 'end',
    }
  })

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
  return polyPts(new Array<number>(DIMENSIONS.length).fill(level))
}

export interface PortraitRadarProps {
  /** 6 维数据，顺序：情绪内核 / 人际羁绊 / 空间感知 / 精神栖所 / 成长演进 / 价值底色，值域 0–1 */
  values: readonly [number, number, number, number, number, number]
}

/**
 * 六维雷达图
 * @param values 6 个维度的得分，0–1
 */
export default function PortraitRadar({ values }: PortraitRadarProps): JSX.Element {
  const dataPoints = polyPts([...values])

  return (
    <>
      <svg
        role="img"
        aria-label="个人画像六维雷达"
        viewBox="-24 -6 288 196"
        width={288}
        height={196}
        style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}
      >
        {/* 4 层网格六边形 */}
        {[0.25, 0.5, 0.75, 1.0].map(level => (
          <polygon
            key={level}
            points={gridPts(level)}
            fill="none"
            className="stroke-v2-text-muted/[0.18]"
            strokeWidth={0.8}
          />
        ))}

        {/* 6 根轴线 */}
        {ANGLE_RADS.map((a, i) => (
          <line
            key={i}
            x1={CX}
            y1={CY}
            x2={(CX + R * Math.cos(a)).toFixed(2)}
            y2={(CY + R * Math.sin(a)).toFixed(2)}
            className="stroke-v2-text-muted/[0.18]"
            strokeWidth={0.8}
          />
        ))}

        {/* 数据填充六边形 */}
        <polygon
          points={dataPoints}
          className="fill-brand-primary/[0.18] stroke-brand-primary"
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
            className="fill-brand-primary"
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
            className="fill-v2-text-secondary"
            fontFamily="'Plus Jakarta Sans', 'PingFang SC', sans-serif"
            fontWeight={500}
          >
            {text}
          </text>
        ))}
      </svg>

      {/* 图形的文本等价：读屏用户从这里拿到六维数值 */}
      <p className="sr-only">
        {DIMENSIONS.map((d, i) => `${d} ${Math.round(values[i] * 100)}%`).join('，')}
      </p>
    </>
  )
}
