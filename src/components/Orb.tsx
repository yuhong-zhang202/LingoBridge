'use client'
import { cn } from '@/lib/utils'

interface OrbProps {
  size?: number
  audioLevel?: number
  pulse?: boolean   // kept for API compatibility, unused
  className?: string
}

const PARTICLES = [
  { angle: 3.9,   dist: 0.833, r: 5.5,  color: '#FCDABB' },
  { angle: 11.6,  dist: 0.897, r: 3.5,  color: '#C2DED8' },
  { angle: 19.0,  dist: 0.850, r: 5.0,  color: '#EDF2D3' },
  { angle: 22.7,  dist: 0.750, r: 3.4,  color: '#C6DFD4' },
  { angle: 38.5,  dist: 0.853, r: 3.5,  color: '#C3DED8' },
  { angle: 52.0,  dist: 0.850, r: 3.1,  color: '#FADEC1' },
  { angle: 59.2,  dist: 0.827, r: 3.6,  color: '#EDF2D4' },
  { angle: 68.2,  dist: 0.837, r: 3.0,  color: '#FBDDC0' },
  { angle: 73.2,  dist: 0.713, r: 3.0,  color: '#F9DFC4' },
  { angle: 82.5,  dist: 0.867, r: 3.4,  color: '#C2DFD9' },
  { angle: 89.8,  dist: 0.813, r: 5.5,  color: '#FBDBBC' },
  { angle: 103.7, dist: 0.843, r: 3.5,  color: '#EDF2D4' },
  { angle: 116.4, dist: 0.900, r: 4.0,  color: '#FBDCBD' },
  { angle: 120.8, dist: 0.800, r: 4.8,  color: '#EEF2D8' },
  { angle: 126.9, dist: 0.900, r: 4.1,  color: '#FBDDBF' },
  { angle: 134.8, dist: 0.890, r: 4.9,  color: '#C2DED8' },
  { angle: 155.1, dist: 0.903, r: 3.0,  color: '#FADFC3' },
  { angle: 162.8, dist: 0.890, r: 3.4,  color: '#EEF2D5' },
  { angle: 185.0, dist: 0.923, r: 2.4,  color: '#EEF2D6' },
  { angle: 191.6, dist: 0.913, r: 4.9,  color: '#C4DED7' },
  { angle: 202.0, dist: 0.910, r: 4.0,  color: '#FBDEC3' },
  { angle: 217.0, dist: 0.920, r: 3.4,  color: '#EFF1D5' },
  { angle: 230.0, dist: 0.927, r: 4.1,  color: '#FBDEC3' },
  { angle: 237.1, dist: 0.913, r: 1.8,  color: '#C8E0DA' },
  { angle: 250.7, dist: 0.877, r: 4.9,  color: '#EEF3D6' },
  { angle: 256.2, dist: 0.963, r: 3.0,  color: '#FADDC1' },
  { angle: 262.4, dist: 0.903, r: 3.3,  color: '#C2DED8' },
  { angle: 268.3, dist: 0.777, r: 3.1,  color: '#C8E0D5' },
  { angle: 271.0, dist: 0.950, r: 3.5,  color: '#C2DED8' },
  { angle: 276.7, dist: 0.883, r: 5.5,  color: '#FBDBBB' },
  { angle: 277.2, dist: 1.003, r: 3.0,  color: '#FBDCBE' },
  { angle: 282.3, dist: 0.990, r: 3.4,  color: '#C2DED8' },
  { angle: 285.3, dist: 0.913, r: 3.5,  color: '#EDF2D5' },
  { angle: 287.6, dist: 0.803, r: 4.9,  color: '#EFF3D8' },
  { angle: 293.0, dist: 0.930, r: 3.4,  color: '#C3DED9' },
  { angle: 298.9, dist: 0.857, r: 4.9,  color: '#EEF3D6' },
  { angle: 303.4, dist: 0.983, r: 5.7,  color: '#F0EED0' },
  { angle: 306.5, dist: 0.823, r: 3.1,  color: '#FBDFC3' },
  { angle: 313.5, dist: 0.890, r: 3.5,  color: '#C2DED8' },
  { angle: 327.5, dist: 0.850, r: 3.1,  color: '#FBDEC0' },
  { angle: 336.1, dist: 0.930, r: 3.5,  color: '#C1DDD8' },
  { angle: 349.1, dist: 0.863, r: 2.0,  color: '#EDF2D4' },
]

export default function Orb({ size = 200, audioLevel = 0, className }: OrbProps) {
  const s = size / 300 // scale factor relative to the 300px reference design
  const cx = size / 2  // center

  return (
    <div
      className={cn('relative flex-shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {/* 绿色 左上 */}
      <div className="absolute rounded-full" style={{
        width:  (175 + audioLevel * 18) * s,
        height: (175 + audioLevel * 18) * s,
        left: '50%', top: '50%',
        transform: `translate(calc(-50% - ${28 * s}px), calc(-50% - ${28 * s}px))`,
        background: 'radial-gradient(circle, rgba(145,200,122,0.95) 0%, rgba(145,200,122,0) 70%)',
        filter: `blur(${28 * s}px)`,
        transition: 'width 0.08s ease, height 0.08s ease',
      }} />

      {/* 蓝青 右侧 */}
      <div className="absolute rounded-full" style={{
        width:  (155 + audioLevel * 18) * s,
        height: (155 + audioLevel * 18) * s,
        left: '50%', top: '50%',
        transform: `translate(calc(-50% + ${25 * s}px), calc(-50% - ${5 * s}px))`,
        background: 'radial-gradient(circle, rgba(112,182,176,0.95) 0%, rgba(112,182,176,0) 70%)',
        filter: `blur(${28 * s}px)`,
        transition: 'width 0.08s ease, height 0.08s ease',
      }} />

      {/* 橙色 下方 */}
      <div className="absolute rounded-full" style={{
        width:  (165 + audioLevel * 18) * s,
        height: (165 + audioLevel * 18) * s,
        left: '50%', top: '50%',
        transform: `translate(calc(-50% - ${5 * s}px), calc(-50% + ${33 * s}px))`,
        background: 'radial-gradient(circle, rgba(248,168,118,0.95) 0%, rgba(248,168,118,0) 70%)',
        filter: `blur(${28 * s}px)`,
        transition: 'width 0.08s ease, height 0.08s ease',
      }} />

      {/* 黄绿 左侧 */}
      <div className="absolute rounded-full" style={{
        width:  (130 + audioLevel * 18) * s,
        height: (130 + audioLevel * 18) * s,
        left: '50%', top: '50%',
        transform: `translate(calc(-50% - ${31 * s}px), calc(-50% + ${5 * s}px))`,
        background: 'radial-gradient(circle, rgba(210,226,168,0.80) 0%, rgba(210,226,168,0) 70%)',
        filter: `blur(${28 * s}px)`,
        transition: 'width 0.08s ease, height 0.08s ease',
      }} />

      {/* 粒子层 */}
      {PARTICLES.map((p, i) => {
        const rad = (p.angle - 90) * Math.PI / 180
        const dist = p.dist * 145 * s + audioLevel * 10 * s
        const px = cx + dist * Math.cos(rad)
        const py = cx + dist * Math.sin(rad)
        const radius = p.r * s * (1 + audioLevel * 0.12)
        return (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width:  radius * 2,
              height: radius * 2,
              left:   px - radius,
              top:    py - radius,
              backgroundColor: p.color,
              opacity: 0.88 + audioLevel * 0.12,
              transition: 'all 0.08s ease',
              pointerEvents: 'none',
            }}
          />
        )
      })}
    </div>
  )
}
