/**
 * @module   FeedbackViewProps
 * @desc     反馈卡片页移动/桌面两套展示视图共享的 props —— 卡片数据与「唯一真源」逻辑集中在 page.tsx
 *           外壳持有（读取暂存、收藏写入、计数、清场）；两个视图仅接收状态与回调做展示。
 *           字段分两层：「共享数据」两视图共用同一真源；「移动端导航专用」只服务移动端 index 单卡模型，
 *           桌面端多卡轮播（center + decided）不使用（其导航状态是桌面私有，不进本契约）。
 * @author   LingoBridge
 * @created  2026-07-04
 */
import type { SessionPolish } from '@/lib/types'

export interface FeedbackViewProps {
  // ── 共享数据（外壳单源持有，两视图共用） ──
  /** 共享数据：本场全部反馈卡（外壳唯一一次 getSessionPolishes 读取的结果） */
  cards: SessionPolish[]
  /** 共享数据：本场暂存是否已读取完成 */
  loaded: boolean
  /** 共享数据：卡片总数 */
  total: number
  /** 共享数据：已收藏累计数（唯一真源） */
  savedCount: number
  /** 共享数据：卡片日期文案（如 7/4） */
  today: string
  /** 共享数据：收藏一张卡 —— 仅做 addSavedPhrase（补 id/createdAt）+ 计数，与导航模型解耦，两视图都调 */
  onCollect: (polish: SessionPolish) => void
  /** 共享数据：本视图判定「已全部处理完」时调用，外壳据此清场（ref 守卫只清一次） */
  onAllDone: () => void
  /** 共享数据：回首页 */
  onBackHome: () => void

  // ── 移动端导航专用（index 单卡模型 + 拖拽；桌面端轮播不使用） ──
  /** 移动端导航专用：当前卡片下标 */
  index: number
  /** 移动端导航专用：是否已回顾完成（index >= total 判定） */
  done: boolean
  /** 移动端导航专用：当前卡片（越界为 undefined） */
  current: SessionPolish | undefined
  /** 移动端导航专用：拖拽横向位移 px（驱动卡片 translateX） */
  offset: number
  /** 移动端导航专用：是否启用位移过渡动画 */
  animated: boolean
  /** 移动端导航专用：拖拽开始，传入起始 x */
  onDragStart: (x: number) => void
  /** 移动端导航专用：拖拽移动，传入当前 x */
  onDragMove: (x: number) => void
  /** 移动端导航专用：拖拽结束 */
  onDragEnd: () => void
  /** 移动端导航专用：跳过当前卡片 / 前进到下一张 */
  onSkip: () => void
}
