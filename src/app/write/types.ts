/**
 * @module   WriteViewTypes
 * @desc     文字模式「故事」页移动/桌面两视图共享 props —— page.tsx 外壳持有 textStory 状态与提交逻辑
 *           （复用共享 useStorySubmit：/api/restructure 查 usable → putHandoff → 跳 /restructure，带上 ?qid），两视图纯展示。
 *           WRITE_PLACEHOLDER 单一真源在 StoryTextPanel，本文件仅 re-export 供本目录沿用。
 * @author   LingoBridge
 * @created  2026-07-09
 */

/** 文字面板占位文案（单一真源在共享面板，re-export 保持本目录导入路径不变） */
export { WRITE_PLACEHOLDER } from '@/components/StoryTextPanel'

/** ?qid 存在时的雅思题目上下文（安静 caption 展示） */
export interface WriteQuestionContext {
  part: number
  en: string
  zh: string
}

export interface WriteViewProps {
  textStory: string
  onChangeText: (v: string) => void
  /** 文本达标（trim 长度 ≥ 10）可提交 */
  canSubmit: boolean
  submitting: boolean
  /** 提交：查 usable → 跳 /restructure（逻辑在外壳的 useStorySubmit） */
  onSubmit: () => void
  /** 改用录音：跳 /recording（带 qid，逻辑在外壳） */
  onSwitchToVoice: () => void
  /** ?qid 对应题目上下文；无 qid 或取不到为 null */
  questionContext: WriteQuestionContext | null
  /** 退出（桌面 Esc / 外壳 ✕ / 移动端返回，走 router.back()） */
  onExit: () => void
}
