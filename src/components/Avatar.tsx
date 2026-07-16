/**
 * @module   Avatar
 * @desc     共享头像 — 有 avatarUrl 渲染圆形 <Image>（object-cover，解码完成后淡入），
 *           无则渲染调用方传入的回退（Orb / 邮箱首字母等，与各处现状一致）。
 *           unoptimized：头像是小图且存于 Supabase 外域，跳过优化器即无需在 next.config 配置 remotePatterns。
 * @author   LingoBridge
 * @created  2026-07-10
 */
'use client'
import Image from 'next/image'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface AvatarProps {
  /** 头像公开 URL；null/undefined 时渲染 fallback */
  avatarUrl: string | null | undefined
  /** 边长（px） */
  size: number
  /** 无头像时的回退渲染（Orb / 首字母） */
  fallback: ReactNode
  /** 附加 class（作用于 img） */
  className?: string
  /** 图片替代文本；容器已带 aria-label 时保持默认空串避免重复播报 */
  alt?: string
}

/** 内层：key 绑定 url，换头像时组件重建、loaded 自动回到 false，新图同样淡入 */
function AvatarImage({ avatarUrl, size, className, alt }: Omit<AvatarProps, 'fallback'>): JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // 图片若已在浏览器缓存里，挂载时 complete 已为 true，React 的 onLoad 不会再触发 —— 头像会永久停在 opacity-0。
  useEffect(() => {
    if (imgRef.current?.complete) setLoaded(true)
  }, [])

  return (
    <Image
      ref={imgRef}
      src={avatarUrl!}
      alt={alt ?? ''}
      width={size}
      height={size}
      unoptimized
      onLoad={() => setLoaded(true)}
      className={cn(
        'rounded-full object-cover flex-shrink-0 transition-opacity duration-200',
        loaded ? 'opacity-100' : 'opacity-0',
        className,
      )}
      style={{ width: size, height: size }}
    />
  )
}

/**
 * 头像（有图 / 回退两态）
 * @param avatarUrl 头像 URL
 * @param size      边长 px
 * @param fallback  回退内容
 */
export default function Avatar({ avatarUrl, size, fallback, className, alt = '' }: AvatarProps): JSX.Element {
  if (!avatarUrl) return <>{fallback}</>
  return <AvatarImage key={avatarUrl} avatarUrl={avatarUrl} size={size} className={className} alt={alt} />
}
