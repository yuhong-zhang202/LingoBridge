/**
 * @module   OrbAvatar
 * @desc     静态 Orb 头像 — 4 层径向渐变光晕，省略 42 粒子 rAF 循环，用于 Profile 头像
 * @author   LingoBridge
 * @created  2026-05-31
 */
'use client'


import { type JSX } from 'react'
interface OrbAvatarProps {
  size?: number
  className?: string
}

/**
 * 静态头像 Orb，复用 Orb 的 4 层 radial-gradient 但去除粒子动画
 * @param size      容器边长（px），默认 84
 * @param className 附加 class
 */
export default function OrbAvatar({ size = 84, className }: OrbAvatarProps): JSX.Element {
  const s = size / 300

  return (
    <div
      className={className}
      style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}
    >
      {/* 绿色 左上 */}
      <div
        className="absolute rounded-full"
        style={{
          width:     175 * s,
          height:    175 * s,
          left:      '50%',
          top:       '50%',
          transform: `translate(calc(-50% - ${28 * s}px), calc(-50% - ${28 * s}px))`,
          background: 'radial-gradient(circle, rgba(145,200,122,0.95) 0%, rgba(145,200,122,0) 70%)',
          filter:    `blur(${28 * s}px)`,
        }}
      />
      {/* 蓝青 右侧 */}
      <div
        className="absolute rounded-full"
        style={{
          width:     155 * s,
          height:    155 * s,
          left:      '50%',
          top:       '50%',
          transform: `translate(calc(-50% + ${25 * s}px), calc(-50% - ${5 * s}px))`,
          background: 'radial-gradient(circle, rgba(112,182,176,0.95) 0%, rgba(112,182,176,0) 70%)',
          filter:    `blur(${28 * s}px)`,
        }}
      />
      {/* 橙色 下方 */}
      <div
        className="absolute rounded-full"
        style={{
          width:     165 * s,
          height:    165 * s,
          left:      '50%',
          top:       '50%',
          transform: `translate(calc(-50% - ${5 * s}px), calc(-50% + ${33 * s}px))`,
          background: 'radial-gradient(circle, rgba(248,168,118,0.95) 0%, rgba(248,168,118,0) 70%)',
          filter:    `blur(${28 * s}px)`,
        }}
      />
      {/* 黄绿 左侧 */}
      <div
        className="absolute rounded-full"
        style={{
          width:     130 * s,
          height:    130 * s,
          left:      '50%',
          top:       '50%',
          transform: `translate(calc(-50% - ${31 * s}px), calc(-50% + ${5 * s}px))`,
          background: 'radial-gradient(circle, rgba(210,226,168,0.80) 0%, rgba(210,226,168,0) 70%)',
          filter:    `blur(${28 * s}px)`,
        }}
      />
    </div>
  )
}
