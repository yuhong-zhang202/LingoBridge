/**
 * @module   SwipeToDelete
 * @desc     移动端左滑删除容器 —— 子内容左滑露出红底删除按钮，越过阈值锁定、点删除触发回调。
 *           带方向锁：首次位移 >6px 时按 |dx|>|dy| 定轴，判定为纵向手势（卡内滚动）则整段忽略横移，
 *           避免卡内滚动时误拖出删除底。
 * @author   LingoBridge
 * @created  2026-05-20
 */
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
  const startY = useRef(0)
  const isLocked = useRef(false)
  // 方向锁：本次触摸判定的手势轴。null=未定轴；'v'=纵向（卡内滚动，忽略横移）；'h'=横向（左滑删除）
  const axis = useRef<'h' | 'v' | null>(null)

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    axis.current = null
  }

  const onTouchMove = (e: React.TouchEvent) => {
    const diff = e.touches[0].clientX - startX.current
    // 首次位移超过 6px 死区时定轴，一次触摸内不再改判——防止卡内纵向滚动带出横移
    if (axis.current === null) {
      const dy = e.touches[0].clientY - startY.current
      if (Math.abs(diff) > 6 || Math.abs(dy) > 6) axis.current = Math.abs(diff) > Math.abs(dy) ? 'h' : 'v'
    }
    if (axis.current !== 'h') return
    if (isLocked.current && diff > 0) setOffset(Math.min(-130 + diff, 0))
    else if (!isLocked.current && diff < 0) setOffset(Math.max(diff, -130))
  }

  const onTouchEnd = () => {
    axis.current = null
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
        <div className="w-[130px] flex items-center justify-center gap-1.5 text-white text-[0.875rem] font-medium">
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
