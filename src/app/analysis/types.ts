/**
 * @module   AnalysisViewTypes
 * @desc     题目分析页移动/桌面两视图共享 props —— page.tsx 外壳集中持有取数/换词/收藏/跳转逻辑（含 savedSet 的 localStorage 单一真源）后下发，两视图仅接收状态与回调做纯展示。
 * @author   LingoBridge
 * @created  2026-07-09
 */
import type { AnalysisResponse, AnalysisPhrase } from '@/lib/types'

export interface AnalysisViewProps {
  /** 分析结果（题目 + 侧重点 + 词组）；null=未就绪 */
  data: AnalysisResponse | null
  loading: boolean
  error: string | null
  /** 当前雅思目标水平 */
  level: string
  /** 词组水平下拉是否展开 */
  levelMenuOpen: boolean
  /** 换词请求进行中 */
  phrasesLoading: boolean
  /** 当前展开的词组 key（`groupIndex-itemIndex`）；null=全收起 */
  openPhrase: string | null
  /** 已收藏词组文本集合（localStorage 单一真源在外壳） */
  savedSet: Set<string>
  /** error 态重试（含防重入守卫） */
  onRetry: () => void
  /** 展开 / 收起水平下拉 */
  onToggleLevelMenu: () => void
  /** 选择目标水平（触发换词；同值不请求） */
  onSelectLevel: (lv: string) => void
  /** 展开 / 收起某词组详情（传入目标 key 或 null） */
  onTogglePhrase: (key: string | null) => void
  /** 收藏 / 取消收藏某词组 */
  onToggleSave: (item: AnalysisPhrase, group: string) => void
  /** 进入练习 */
  onStartPractice: () => void
  /** 退出回首页（桌面 Esc 用；与外壳顶栏 ✕ 一致） */
  onExit: () => void
}
