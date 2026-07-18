/**
 * @module   OrbSoft
 * @desc     降饱和弥散 Orb — 单 div 多层 radial-gradient，无粒子，用于底栏云团按钮
 * @author   LingoBridge
 * @created  2026-05-31
 */
'use client'


import { type JSX } from 'react'
interface OrbSoftProps {
  size?: number
  className?: string
}

const BG = [
  'radial-gradient(circle at 36% 38%, rgba(145,200,122,.62) 0%, transparent 58%)',
  'radial-gradient(circle at 66% 48%, rgba(112,182,176,.60) 0%, transparent 58%)',
  'radial-gradient(circle at 52% 66%, rgba(248,168,118,.62) 0%, transparent 58%)',
  'radial-gradient(circle at 32% 58%, rgba(210,226,168,.52) 0%, transparent 54%)',
].join(', ')

/**
 * 降饱和弥散 Orb 云团，4 层 radial-gradient 合成单 div，无任何动画
 * @param size      圆形直径（px），默认 50
 * @param className 附加 class
 */
export default function OrbSoft({ size = 50, className }: OrbSoftProps): JSX.Element {
  return (
    <div
      className={className}
      style={{
        width:        size,
        height:       size,
        borderRadius: '50%',
        flexShrink:   0,
        background:   BG,
      }}
    />
  )
}
