/**
 * @module   RestructureViewTypes
 * @desc     整理确认页移动/桌面两视图共享 props —— 由 page.tsx 统一持逻辑（AI 整理/编辑/重整/保存跳转）后下发
 * @author   LingoBridge
 * @created  2026-07-08
 */
export interface RestructureViewProps {
  /** 原始语料（用户口述转写文本） */
  rawStory: string
  /** AI 整理后文本（可编辑） */
  aiText: string
  isEditing: boolean
  isLoading: boolean
  error: string | null
  /** AI 判断素材是否够用；null=未判定 */
  usable: boolean | null
  isSaving: boolean
  saveError: string | null
  /** 有 qid 走雅思流（CTA=开始分析），无则故事流（CTA=开始匹配题目） */
  qid: string | null
  onAiChange: (v: string) => void
  onToggleEdit: () => void
  /** 重新整理 / 出错重试（同一动作，含防重入守卫） */
  onReRestructure: () => void
  /** 保存语料并跳转（匹配 / 分析） */
  onMatch: () => void
  /** 退出回首页（桌面 ✕ / Esc 一致，走 router.push('/')） */
  onExit: () => void
}
