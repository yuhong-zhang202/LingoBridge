/**
 * @module   Card
 * @desc     标准内容卡 — 白底 + 0.5px 边框 + 轻阴影 + 圆角 16
 * @author   LingoBridge
 * @created  2026-06-16
 */
'use client'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CardProps {
  children: ReactNode
  className?: string
}

/**
 * 标准内容卡
 * @param children  卡片内容
 * @param className 额外 class（内边距、margin、布局等）
 */
export default function Card({ children, className }: CardProps) {
  return (
    <div className={cn(
      'bg-white rounded-[16px] border border-black/[0.05] shadow-[0_2px_12px_rgba(0,0,0,0.06)]',
      className,
    )}>
      {children}
    </div>
  )
}
