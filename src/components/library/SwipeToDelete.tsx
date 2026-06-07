'use client'
import { useState, useRef } from 'react'
import { Trash2 } from 'lucide-react'

const DEL_BG = 'linear-gradient(to right, rgba(212,83,79,0.0) 0%, rgba(212,83,79,0.6) 15%, #D4534F 40%)'

interface Props {
  onDelete: () => void
  borderRadius?: number
  children: React.ReactNode
}

export default function SwipeToDelete({ onDelete, borderRadius = 20, children }: Props) {
  const [offset, setOffset] = useState(0)
  const startX = useRef(0)
  const isLocked = useRef(false)

  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX }

  const onTouchMove = (e: React.TouchEvent) => {
    const diff = e.touches[0].clientX - startX.current
    if (isLocked.current && diff > 0) setOffset(Math.min(-130 + diff, 0))
    else if (!isLocked.current && diff < 0) setOffset(Math.max(diff, -130))
  }

  const onTouchEnd = () => {
    setOffset(prev => {
      if (isLocked.current) {
        const keep = prev <= -80
        if (!keep) isLocked.current = false
        return keep ? -130 : 0
      }
      const lock = prev < -65
      if (lock) isLocked.current = true
      return lock ? -130 : 0
    })
  }

  return (
    <div className="relative overflow-hidden" style={{ borderRadius }}>
      <button
        className="absolute inset-0 flex items-center justify-end"
        style={{ background: DEL_BG }}
        onClick={onDelete}
      >
        <div className="w-[130px] flex items-center justify-center gap-1.5 text-white text-[14px] font-medium">
          <Trash2 size={16} />删除
        </div>
      </button>
      <div
        className="relative z-10 transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  )
}
