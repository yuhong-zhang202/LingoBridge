/**
 * @module   FeedbackViewProps
 * @desc     反馈卡片页移动/桌面两套展示视图共享的 props —— 卡片数据与交互逻辑集中在 page.tsx 外壳持有，
 *           两个视图仅接收状态与回调做展示（page.tsx 取数、Mobile/Desktop 只画 UI）。
 * @author   LingoBridge
 * @created  2026-07-04
 */
import type { SessionPolish } from '@/lib/types'

export interface FeedbackViewProps {
  /** 本场暂存是否已读取完成 */
  loaded: boolean
  /** 卡片总数 */
  total: number
  /** 当前卡片下标 */
  index: number
  /** 已收藏数 */
  savedCount: number
  /** 是否已回顾完成 */
  done: boolean
  /** 当前卡片（越界为 undefined） */
  current: SessionPolish | undefined
  /** 卡片日期文案（如 7/4） */
  today: string
  /** 拖拽横向位移 px（驱动卡片 translateX） */
  offset: number
  /** 是否启用位移过渡动画 */
  animated: boolean
  /** 拖拽开始，传入起始 x */
  onDragStart: (x: number) => void
  /** 拖拽移动，传入当前 x */
  onDragMove: (x: number) => void
  /** 拖拽结束 */
  onDragEnd: () => void
  /** 收藏当前卡片 */
  onCollect: () => void
  /** 跳过当前卡片 */
  onSkip: () => void
  /** 回首页 */
  onBackHome: () => void
}
