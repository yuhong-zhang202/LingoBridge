/**
 * @module   Skeleton
 * @desc     通用骨架块 — 渲染一个带 .skeleton（暖灰 shimmer）的占位 div，尺寸/圆角由 className 控制。
 *           用法：<Skeleton className="w-3/4 h-[15px]" /> / <Skeleton className="w-12 h-[18px] rounded-full" />
 * @author   LingoBridge
 * @created  2026-06-22
 */
'use client'

export default function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}
