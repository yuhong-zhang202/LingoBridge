/**
 * @module   Reveal
 * @desc     滚动进入视口时的淡入 + 上浮动画（scroll-reveal）。只播一次、可选 delay 做 stagger 错落。
 *           只动 opacity/transform（不触发重排）。尊重 prefers-reduced-motion：开启时瞬时显示、不位移。
 * @author   LingoBridge
 * @created  2026-07-11
 */
'use client'
import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  /** 错落延迟（秒），用于同组元素依次入场 */
  delay?: number
  /** 透传到外层 motion 元素 */
  className?: string
  /** 渲染标签，默认 div */
  as?: 'div' | 'section' | 'li' | 'span'
}

/**
 * 滚进视口才播放一次的淡入上浮
 * @param children 被包裹内容（样式/布局不受影响，仅整体 opacity+transform）
 * @param delay    入场延迟秒数（做 stagger）
 * @param className 外层类名透传
 * @param as       渲染标签
 */
export default function Reveal({ children, delay = 0, className, as = 'div' }: RevealProps): JSX.Element {
  const reduce = useReducedMotion()
  const MotionTag = motion[as]

  // 减弱动效：不位移、瞬时显示（与项目 globals.css 的 reduced-motion 策略一致）
  if (reduce) {
    return <MotionTag className={className}>{children}</MotionTag>
  }

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, ease: [0.22, 0.7, 0.2, 1], delay }}
    >
      {children}
    </MotionTag>
  )
}
