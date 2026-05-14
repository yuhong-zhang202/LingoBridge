'use client'
import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useSpring, animate } from 'framer-motion'

interface GlowOrbProps {
  audioLevel?: number // 0~1
  size?: number
}

// Irregular floating particles — NOT in a circle
const PARTICLES = [
  { x: '12%',  y: '18%',  w: 44, h: 52,  color: 'rgba(196,218,196,0.55)', blur: 22 },
  { x: '62%',  y: '8%',   w: 36, h: 38,  color: 'rgba(200,220,210,0.45)', blur: 18 },
  { x: '80%',  y: '30%',  w: 28, h: 34,  color: 'rgba(164,210,228,0.40)', blur: 16 },
  { x: '72%',  y: '68%',  w: 38, h: 44,  color: 'rgba(180,218,200,0.45)', blur: 20 },
  { x: '20%',  y: '74%',  w: 32, h: 40,  color: 'rgba(242,206,170,0.38)', blur: 18 },
  { x: '6%',   y: '52%',  w: 24, h: 28,  color: 'rgba(210,228,168,0.40)', blur: 14 },
  { x: '44%',  y: '86%',  w: 40, h: 32,  color: 'rgba(192,216,208,0.42)', blur: 18 },
  { x: '88%',  y: '56%',  w: 26, h: 36,  color: 'rgba(168,214,232,0.38)', blur: 15 },
  { x: '34%',  y: '4%',   w: 20, h: 24,  color: 'rgba(230,210,180,0.35)', blur: 12 },
  { x: '54%',  y: '76%',  w: 22, h: 26,  color: 'rgba(196,228,196,0.38)', blur: 13 },
]

// Seed-deterministic "random-ish" float ranges per particle
const FLOAT_CONFIGS = [
  { dx: [-8, 6],  dy: [-10, 8],  dur: 6.2 },
  { dx: [5, -7],  dy: [-6, 10],  dur: 7.4 },
  { dx: [-6, 9],  dy: [7, -9],   dur: 5.8 },
  { dx: [8, -5],  dy: [-8, 6],   dur: 8.1 },
  { dx: [-9, 7],  dy: [9, -7],   dur: 6.6 },
  { dx: [6, -8],  dy: [-5, 9],   dur: 7.0 },
  { dx: [-7, 5],  dy: [8, -10],  dur: 5.5 },
  { dx: [9, -6],  dy: [-9, 5],   dur: 8.4 },
  { dx: [-5, 8],  dy: [6, -8],   dur: 6.9 },
  { dx: [7, -9],  dy: [-7, 7],   dur: 7.2 },
]

export default function GlowOrb({ audioLevel = 0, size = 260 }: GlowOrbProps) {
  // Smooth audio-driven scale spring
  const scaleBase = useMotionValue(1)
  const scale = useSpring(scaleBase, { stiffness: 60, damping: 18, mass: 1.2 })

  // Breathing animation via loop
  const breathRef = useRef<ReturnType<typeof animate> | null>(null)

  useEffect(() => {
    // Continuous 4s breathe in/out
    const ctrl = animate(scaleBase, [1, 1.045, 1], {
      duration: 4,
      ease: 'easeInOut',
      repeat: Infinity,
      repeatType: 'loop',
    })
    breathRef.current = ctrl
    return () => ctrl.stop()
  }, [scaleBase])

  // Audio boost layered on top of breathing
  useEffect(() => {
    scaleBase.set(1 + audioLevel * 0.10)
  }, [audioLevel, scaleBase])

  const innerSize = size * 0.62 // ~161px at size=260
  const audioOpacity = 0.82 + audioLevel * 0.18

  return (
    <motion.div
      style={{
        width: size,
        height: size,
        position: 'relative',
        scale,
        willChange: 'transform',
      }}
    >
      {/* ── Irregular floating particle fog ── */}
      {PARTICLES.map((p, i) => {
        const fc = FLOAT_CONFIGS[i]
        return (
          <motion.div
            key={i}
            style={{
              position: 'absolute',
              left: p.x,
              top:  p.y,
              width:  p.w,
              height: p.h,
              borderRadius: '50%',
              background: p.color,
              filter: `blur(${p.blur}px)`,
              opacity: audioOpacity,
              mixBlendMode: 'normal',
            }}
            animate={{
              x: fc.dx,
              y: fc.dy,
            }}
            transition={{
              duration: fc.dur,
              repeat: Infinity,
              repeatType: 'reverse',
              ease: 'easeInOut',
            }}
          />
        )
      })}

      {/* ── Core glow orb ── */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top:  '50%',
          transform: 'translate(-50%, -50%)',
          width:  innerSize,
          height: innerSize,
          borderRadius: '50%',
          overflow: 'hidden',
        }}
      >
        {/* Layer 1 – left-leaning sage green */}
        <motion.div
          style={{
            position: 'absolute',
            left: '4%', top: '10%',
            width: '58%', height: '75%',
            borderRadius: '50%',
            background: 'rgba(205,224,148,0.90)',
            filter: 'blur(38px)',
          }}
          animate={{ x: [-4, 4, -4], y: [-3, 5, -3], scale: [1, 1.04, 1] }}
          transition={{ duration: 5.1, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Layer 2 – bottom warm peach */}
        <motion.div
          style={{
            position: 'absolute',
            left: '20%', bottom: '5%',
            width: '62%', height: '52%',
            borderRadius: '50%',
            background: 'rgba(248,200,152,0.88)',
            filter: 'blur(34px)',
          }}
          animate={{ x: [3, -5, 3], y: [-2, 4, -2], scale: [1, 1.05, 1] }}
          transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
        />

        {/* Layer 3 – right aqua / sky blue */}
        <motion.div
          style={{
            position: 'absolute',
            right: '6%', top: '25%',
            width: '42%', height: '62%',
            borderRadius: '50%',
            background: 'rgba(164,218,234,0.88)',
            filter: 'blur(32px)',
          }}
          animate={{ x: [-3, 5, -3], y: [4, -3, 4], scale: [1, 1.03, 1] }}
          transition={{ duration: 6.4, repeat: Infinity, ease: 'easeInOut', delay: 1.1 }}
        />

        {/* Layer 4 – top-right lime highlight */}
        <motion.div
          style={{
            position: 'absolute',
            top: '0%', left: '52%',
            width: '40%', height: '40%',
            borderRadius: '50%',
            background: 'rgba(182,218,120,0.90)',
            filter: 'blur(28px)',
          }}
          animate={{ x: [2, -4, 2], y: [-4, 3, -4], scale: [1, 1.06, 1] }}
          transition={{ duration: 4.7, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
        />

        {/* Layer 5 – center diffuse white-fog haze */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.68) 65%, rgba(255,255,255,0.96) 100%)',
            filter: 'blur(10px)',
          }}
        />
      </div>

      {/* ── Outer environmental glow ring ── */}
      <div
        style={{
          position: 'absolute',
          inset: '-12%',
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(200,224,196,0.18) 0%, rgba(200,224,196,0.00) 70%)',
          filter: 'blur(28px)',
          opacity: 0.6 + audioLevel * 0.4,
          pointerEvents: 'none',
        }}
      />
    </motion.div>
  )
}
