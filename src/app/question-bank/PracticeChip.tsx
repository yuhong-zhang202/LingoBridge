/**
 * @module   PracticeChip
 * @desc     题库题目行的「练习」按钮 —— 空闲态即普通 gradient Chip，处理中切为
 *           禁用 + 转圈 + 文案「练习中」。存在的理由：跳转前可能要现查该题最贴合的
 *           语料（见 useGotoPractice），这段等待若无反馈，用户感知为「点了没反应」并重复点击。
 * @author   LingoBridge
 * @created  2026-07-20
 */
'use client'
import { Loader2 } from 'lucide-react'
import Chip from '@/components/Chip'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'

interface Props {
  /** 处理中：禁用点击并显示进度反馈 */
  pending: boolean
  /** 点击回调（处理中不会触发） */
  onClick: () => void
}

/** 处理中态的按钮样式 —— 与 Chip 的 variant="gradient" size="sm" 逐项对齐，
 *  仅去掉 active 缩放、换上等待光标，确保两态之间不发生尺寸/位置跳变 */
const PENDING_CLASS =
  'rounded-full inline-flex items-center gap-1 transition-all duration-150 ' +
  'text-[0.6875rem] px-[10px] py-[3px] bg-white text-v2-text-secondary font-semibold ' +
  'font-medium flex-shrink-0 cursor-wait opacity-90'

/**
 * 题库「练习」按钮
 *
 * 无障碍：处理中不靠颜色表达状态 —— 文案由「练习」变为「练习中」（对读屏与色觉障碍
 * 用户均可感知），并置 aria-busy；同时按钮只会因加了图标而变宽，触控目标不缩小。
 *
 * @param pending  是否处理中
 * @param onClick  点击回调
 */
export default function PracticeChip({ pending, onClick }: Props) {
  if (pending) {
    return (
      <button
        type="button"
        disabled
        aria-busy="true"
        aria-label="正在打开练习"
        className={PENDING_CLASS}
        style={GRADIENT_BORDER_STYLE}
      >
        <Loader2 size={11} className="animate-spin" aria-hidden="true" />
        练习中
      </button>
    )
  }

  return (
    <Chip variant="gradient" size="sm" onClick={onClick} className="font-medium flex-shrink-0">
      练习
    </Chip>
  )
}
