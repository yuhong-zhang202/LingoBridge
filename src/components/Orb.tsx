'use client'
import { cn } from '@/lib/utils'

interface OrbProps {
  size?: number
  pulse?: boolean
  className?: string
}

const DOTS = [
  { s:7,  c:'rgba(240,188,160,0.60)', t:-8,  l:42  },
  { s:5,  c:'rgba(168,210,196,0.60)', t:-4,  l:62  },
  { s:9,  c:'rgba(188,210,168,0.55)', t:5,   l:88  },
  { s:5,  c:'rgba(240,188,160,0.55)', t:22,  l:96  },
  { s:7,  c:'rgba(168,210,196,0.60)', t:48,  l:100 },
  { s:5,  c:'rgba(188,210,168,0.55)', t:72,  l:94  },
  { s:9,  c:'rgba(240,188,160,0.60)', t:90,  l:72  },
  { s:5,  c:'rgba(168,210,196,0.55)', t:98,  l:50  },
  { s:7,  c:'rgba(188,210,168,0.60)', t:94,  l:24  },
  { s:5,  c:'rgba(240,188,160,0.55)', t:80,  l:2   },
  { s:9,  c:'rgba(168,210,196,0.60)', t:52,  l:-4  },
  { s:5,  c:'rgba(188,210,168,0.55)', t:22,  l:-2  },
  { s:7,  c:'rgba(240,188,160,0.60)', t:4,   l:16  },
]

export default function Orb({
  size = 200,
  pulse = false,
  className,
}: OrbProps) {
  return (
    <div
      className={cn('relative flex-shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {DOTS.map((d, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: d.s, height: d.s,
            background: d.c,
            top: `${d.t}%`, left: `${d.l}%`,
          }}
        />
      ))}
      <div
        className={cn(
          'absolute inset-0 rounded-full',
          pulse ? 'animate-orb-pulse' : 'animate-orb-breathe'
        )}
        style={{ overflow: 'visible' }}
      >
        <div className="absolute rounded-full" style={{
          width:'65%', height:'65%',
          background:'rgba(240,188,160,0.90)',
          filter:'blur(28px)', top:'15%', left:'15%',
        }} />
        <div className="absolute rounded-full" style={{
          width:'52%', height:'52%',
          background:'rgba(168,210,196,0.85)',
          filter:'blur(24px)', top:'28%', left:'4%',
        }} />
        <div className="absolute rounded-full" style={{
          width:'50%', height:'50%',
          background:'rgba(188,210,168,0.80)',
          filter:'blur(24px)', top:'10%', left:'38%',
        }} />
      </div>
    </div>
  )
}
