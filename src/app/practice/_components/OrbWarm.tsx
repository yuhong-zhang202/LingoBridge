/**
 * @module   OrbWarm
 * @desc     暖色弥散 Orb — 与 OrbSoft 结构一致，换暖色调，用作练习页用户头像（与 Lior 冷色 Orb 对称）
 * @author   LingoBridge
 * @created  2026-06-07
 */
'use client'

interface OrbWarmProps {
  size?: number
  className?: string
}

const BG = [
  'radial-gradient(circle at 36% 38%, rgba(248,168,118,.66) 0%, transparent 58%)',
  'radial-gradient(circle at 66% 48%, rgba(235,150,95,.58) 0%, transparent 58%)',
  'radial-gradient(circle at 52% 66%, rgba(246,206,140,.62) 0%, transparent 58%)',
  'radial-gradient(circle at 30% 60%, rgba(232,176,150,.50) 0%, transparent 54%)',
].join(', ')

/**
 * 暖色弥散 Orb，4 层 radial-gradient 合成单 div，无动画；用作练习页用户头像
 * @param size      圆形直径（px），默认 34
 * @param className 附加 class
 */
export default function OrbWarm({ size = 34, className }: OrbWarmProps): JSX.Element {
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
