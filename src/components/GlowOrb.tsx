'use client'
import { motion } from 'framer-motion'

interface GlowOrbProps {
  audioLevel?: number // 0~1
  size?: number
}

// Each layer is an independent diffuse color cloud.
// cx/cy = offset of the cloud center from the container center (px)
// All layers overflow the container freely — no circular boundary.
const LAYERS = [
  {
    // Sage green — upper-left
    gradient: 'radial-gradient(ellipse at 50% 50%, rgba(178,215,146,1) 0%, transparent 62%)',
    w: 340, h: 280, cx: -70, cy: -55,
    blur: 100, opacity: 0.28,
    dx: [-20, 16], dy: [-14, 20], scale: [1, 1.08, 1],
    dur: 7.2, delay: 0,
  },
  {
    // Warm peach — lower-right
    gradient: 'radial-gradient(ellipse at 50% 50%, rgba(248,194,144,1) 0%, transparent 60%)',
    w: 300, h: 260, cx: 60, cy: 70,
    blur: 88, opacity: 0.25,
    dx: [18, -22], dy: [-12, 18], scale: [1, 1.06, 1],
    dur: 8.5, delay: 0.9,
  },
  {
    // Sky aqua — right-center
    gradient: 'radial-gradient(ellipse at 50% 50%, rgba(144,208,228,1) 0%, transparent 62%)',
    w: 285, h: 320, cx: 85, cy: -10,
    blur: 112, opacity: 0.22,
    dx: [-16, 22], dy: [14, -20], scale: [1, 1.07, 1],
    dur: 6.8, delay: 1.5,
  },
  {
    // Lime — upper-center
    gradient: 'radial-gradient(ellipse at 50% 50%, rgba(172,218,104,1) 0%, transparent 56%)',
    w: 260, h: 220, cx: -10, cy: -100,
    blur: 118, opacity: 0.20,
    dx: [16, -20], dy: [-22, 16], scale: [1, 1.09, 1],
    dur: 5.7, delay: 0.3,
  },
  {
    // Warm cream — center, barely moves
    gradient: 'radial-gradient(ellipse at 50% 50%, rgba(248,230,206,1) 0%, transparent 50%)',
    w: 230, h: 230, cx: 8, cy: 8,
    blur: 140, opacity: 0.18,
    dx: [-10, 10], dy: [-8, 12], scale: [1, 1.04, 1],
    dur: 9.2, delay: 2.1,
  },
  {
    // Soft coral — lower-left
    gradient: 'radial-gradient(ellipse at 50% 50%, rgba(228,168,148,1) 0%, transparent 58%)',
    w: 200, h: 240, cx: -55, cy: 80,
    blur: 95, opacity: 0.17,
    dx: [20, -14], dy: [-18, 14], scale: [1, 1.05, 1],
    dur: 7.8, delay: 3.0,
  },
]

export default function GlowOrb({ audioLevel = 0, size = 260 }: GlowOrbProps) {
  return (
    // Plain container — no rounded-full, no overflow:hidden, no background
    <div style={{ width: size, height: size, position: 'relative' }}>
      {LAYERS.map((layer, i) => {
        // Position each cloud center at (size/2 + cx, size/2 + cy)
        const left = size / 2 + layer.cx - layer.w / 2
        const top  = size / 2 + layer.cy - layer.h / 2

        return (
          <motion.div
            key={i}
            style={{
              position: 'absolute',
              left,
              top,
              width: layer.w,
              height: layer.h,
              background: layer.gradient,
              filter: `blur(${layer.blur}px)`,
              // Audio lifts opacity; clamp just below 1 to stay diffuse
              opacity: Math.min(layer.opacity * (1 + audioLevel * 0.7), 0.60),
              willChange: 'transform',
              pointerEvents: 'none',
            }}
            animate={{
              x:     [layer.dx[0], layer.dx[1], layer.dx[0]],
              y:     [layer.dy[0], layer.dy[1], layer.dy[0]],
              scale: layer.scale,
            }}
            transition={{
              duration:   layer.dur,
              repeat:     Infinity,
              repeatType: 'loop',
              ease:       'easeInOut',
              delay:      layer.delay,
            }}
          />
        )
      })}
    </div>
  )
}
