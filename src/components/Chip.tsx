/**
 * @module   Chip
 * @desc     交互型胶囊按钮 — 可点击，gradient / ghost / default 三种样式，sm / md 两种尺寸。
 *           两个分支都显式 type="button"：默认 type 是 submit，放进 <form> 会误触发提交。
 * @author   LingoBridge
 * @created  2026-05-29
 */
'use client'
import type { ReactNode, MouseEventHandler } from 'react'
import { cn } from '@/lib/utils'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'

interface ChipProps {
  children: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
  active?: boolean
  variant?: 'gradient' | 'ghost' | 'default'
  /** 尺寸档，见 SIZES 注释：sm 紧凑动作 / md 筛选切换（默认）/ lg 卡片级主动作 */
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** 透传给 button 的 aria-pressed（筛选/切换场景标注按压态）；不传 = undefined 不渲染该属性 */
  ariaPressed?: boolean
  /** 透传给 button 的 aria-label（同屏多颗同文字胶囊时用来区分，如「题目分析：<题面>」）；
   *  不传 = undefined 不渲染该属性，可访问名回落到 children 文本 */
  ariaLabel?: string
}

/**
 * 三档尺寸。⚠️【别在调用点用 px-/py-/min-h- 覆盖它们】——`cn()` 是 twMerge，覆盖会真的生效，
 * 结果是同类胶囊各长各的。2026-09-01 匹配卡那两颗就是这么被 `px-3 py-1.5 min-h-[44px]`
 * 弄成「比同屏筛选 chip 高 47%、左右还各窄 2px」的，产品方真机一眼看出不是一套。
 * 尺寸不够用就来这里加一档，不要在调用点改。
 *
 * 选档依据是【这颗胶囊的语义分量】，不是它在哪个页面：
 *   sm  紧凑动作（列表行内的次要操作）
 *   md  筛选 / 切换（如匹配页的 Part 全部/Part1/Part2）
 *   lg  卡片级主动作（如匹配卡的「题目分析」「开始练习」）—— 2026-09-01 新增：
 *       md 是按筛选胶囊的分量设计的，用在卡片主动作上偏轻，产品方真机判「组件和字体都有点小」。
 *       取值让它在标准字体档【自然长到 44px 高】（14px 字 × 1.5 行高 + py-2.5×2 + 描边 3px），
 *       触控目标基本靠自身满足，不再靠撑高可见盒子。
 */
const SIZES = {
  sm: 'text-[0.6875rem] px-[10px] py-[3px]',
  md: 'text-[0.75rem] px-3.5 py-[5px]',
  lg: 'text-[0.875rem] px-5 py-2.5',
}
const BASE = 'rounded-full inline-flex items-center gap-1 transition-all duration-150 active:scale-[0.97]'

/**
 * 交互型胶囊按钮
 * @param children  按钮内容
 * @param onClick   点击回调（接收鼠标事件）
 * @param active    激活态（ghost 时切换为 gradient 样式）
 * @param variant   样式变体，默认 gradient
 * @param size      尺寸，默认 md（sm 用于紧凑动作 chip）
 * @param className 额外 class
 * @param ariaPressed 透传 aria-pressed（不传则不渲染该属性，对现有调用零影响）
 * @param ariaLabel 透传 aria-label（不传则不渲染该属性，对现有调用零影响）
 */
export default function Chip({ children, onClick, active, variant = 'gradient', size = 'md', className, ariaPressed, ariaLabel }: ChipProps) {
  const useGradient = variant === 'gradient' || (variant === 'ghost' && active)

  if (useGradient) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={ariaPressed}
        aria-label={ariaLabel}
        className={cn(BASE, SIZES[size], 'bg-white text-v2-text-secondary font-semibold', className)}
        style={GRADIENT_BORDER_STYLE}
      >
        {children}
      </button>
    )
  }

  const variantClass = variant === 'ghost'
    ? 'bg-transparent border border-neutral-border text-v2-text-muted'
    : 'bg-white border border-neutral-border text-v2-text-secondary'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ariaPressed}
      className={cn(BASE, SIZES[size], variantClass, className)}
    >
      {children}
    </button>
  )
}
