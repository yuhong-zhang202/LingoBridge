'use client'
import { cn } from '@/lib/utils'

interface WaveformProps {
  active?: boolean
  className?: string
}

const IDLE_H   = [8,  14, 20, 14, 8 ]
const ACTIVE_H = [10, 18, 28, 18, 10]
const IDLE_A   = ['animate-wave-1','animate-wave-2',
  'animate-wave-3','animate-wave-4','animate-wave-5']
const ACTIVE_A = ['animate-wave-a1','animate-wave-a2',
  'animate-wave-a3','animate-wave-a4','animate-wave-a5']

export default function Waveform({
  active = false,
  className,
}: WaveformProps) {
  const heights = active ? ACTIVE_H : IDLE_H
  const anims   = active ? ACTIVE_A : IDLE_A
  return (
    <div className={cn('flex items-end gap-[4px]', className)}>
      {heights.map((h, i) => (
        <div
          key={i}
          className={cn('waveform-bar', anims[i])}
          style={{
            height: h,
            background: active
              ? 'rgba(0,0,0,0.28)'
              : 'rgba(0,0,0,0.18)',
          }}
        />
      ))}
    </div>
  )
}
