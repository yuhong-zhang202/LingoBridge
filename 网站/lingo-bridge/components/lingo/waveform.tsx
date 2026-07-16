'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export function Waveform({ bars = 48, active = true, className }: { bars?: number; active?: boolean; className?: string }) {
  const [seed, setSeed] = useState(0)

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setSeed((s) => s + 1), 140)
    return () => clearInterval(id)
  }, [active])

  return (
    <div className={cn('flex h-16 items-center justify-center gap-[3px]', className)}>
      {Array.from({ length: bars }).map((_, i) => {
        // deterministic-ish pseudo random height driven by seed
        const h = active
          ? 18 + Math.abs(Math.sin(i * 0.6 + seed * 0.5) * Math.cos(i + seed)) * 44
          : 10
        return (
          <span
            key={i}
            className="w-[3px] rounded-full bg-ink/30 transition-[height] duration-150 ease-out"
            style={{ height: `${h}%` }}
          />
        )
      })}
    </div>
  )
}
