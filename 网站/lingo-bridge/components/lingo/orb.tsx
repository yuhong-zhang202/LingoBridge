import { cn } from '@/lib/utils'

interface OrbProps {
  size?: number
  /** 0-1, drives the diffusion/expansion when listening */
  level?: number
  active?: boolean
  className?: string
}

/**
 * LingoBridge Orb — a diffuse soft-light sphere built from 4 blurred color
 * blobs (teal / blue-teal / orange / yellow-green) plus floating particles.
 * The brand's soul visual: warm orange-to-teal glow.
 */
export function Orb({ size = 220, level = 0, active = false, className }: OrbProps) {
  const expand = 1 + level * 0.18
  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* outer ambient halo */}
      <div
        className="absolute inset-0 rounded-full blur-2xl"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(212,135,90,0.28), rgba(123,166,153,0.18) 55%, transparent 72%)',
          transform: `scale(${1.15 * expand})`,
          transition: 'transform 120ms ease-out',
        }}
      />

      {/* color blobs */}
      <div
        className="absolute rounded-full blur-2xl"
        style={{
          inset: '14%',
          background: 'radial-gradient(circle at 35% 30%, rgba(123,166,153,0.85), transparent 65%)',
          animation: 'orb-drift 9s ease-in-out infinite',
          transform: `scale(${expand})`,
        }}
      />
      <div
        className="absolute rounded-full blur-2xl"
        style={{
          inset: '18%',
          background: 'radial-gradient(circle at 70% 35%, rgba(200,221,217,0.9), transparent 60%)',
          animation: 'orb-drift 11s ease-in-out infinite reverse',
          transform: `scale(${expand})`,
        }}
      />
      <div
        className="absolute rounded-full blur-2xl"
        style={{
          inset: '20%',
          background: 'radial-gradient(circle at 60% 70%, rgba(212,135,90,0.8), transparent 62%)',
          animation: 'orb-drift 8s ease-in-out infinite',
          transform: `scale(${expand})`,
        }}
      />
      <div
        className="absolute rounded-full blur-2xl"
        style={{
          inset: '24%',
          background: 'radial-gradient(circle at 30% 65%, rgba(188,210,168,0.7), transparent 60%)',
          animation: 'orb-drift 13s ease-in-out infinite reverse',
          transform: `scale(${expand})`,
        }}
      />

      {/* glossy core */}
      <div
        className="absolute rounded-full"
        style={{
          inset: '30%',
          background:
            'radial-gradient(circle at 38% 32%, rgba(255,255,255,0.85), rgba(255,255,255,0.15) 45%, transparent 70%)',
          animation: active ? 'orb-breathe 2.4s ease-in-out infinite' : 'orb-breathe 5s ease-in-out infinite',
        }}
      />

      {/* floating particles */}
      {[
        { top: '12%', left: '52%', d: '0s', s: 5 },
        { top: '28%', left: '20%', d: '1.2s', s: 4 },
        { top: '70%', left: '30%', d: '0.6s', s: 6 },
        { top: '64%', left: '74%', d: '1.8s', s: 4 },
        { top: '40%', left: '84%', d: '0.3s', s: 5 },
      ].map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-surface/80"
          style={{
            top: p.top,
            left: p.left,
            width: p.s,
            height: p.s,
            animation: `float-particle ${4 + i}s ease-in-out infinite`,
            animationDelay: p.d,
            boxShadow: '0 0 8px rgba(255,255,255,0.7)',
          }}
        />
      ))}
    </div>
  )
}
