/**
 * @module   HomeViewTypes
 * @desc     首页移动/桌面两视图共享类型 —— page.tsx 外壳集中持有全部 state/hook/handler
 *           （雅思切换题、文字提交、账户额度、Hero 打字机等），组装成一份 HomeViewProps 下发，
 *           两视图纯展示、无副作用。对齐 matching/types.ts 的 ViewProps 模式。
 * @author   LingoBridge
 * @created  2026-07-12
 */
import type { SwitchQuestion } from '@/lib/types'

export interface HomeViewProps {
  /** 分段模式：false=我的故事，true=雅思题 */
  ieltsMode: boolean
  /** 移动端：是否切到文字输入面板 */
  showTextInput: boolean
  /** 登录用户当月语料达上限 → 主区切「额度用完」态 */
  storyQuotaReached: boolean

  /** 雅思切换题（含加载/错误态） */
  question: SwitchQuestion | null
  loading: boolean
  error: string | null

  /** 文字输入内容（移动端 StoryTextPanel） */
  textStory: string
  /** 文字提交进行中 */
  submitting: boolean
  /** 当前文本是否达到可提交丰富度（computeRichness 结果，外壳预算） */
  canSubmit: boolean

  /** 桌面 Hero 标题第二行打字机逐字文本 */
  typed: string
  /** 桌面「信息复用」Tab 舞台当前功能索引 */
  reuseTab: number

  /** 移动端切换文字输入面板显隐 */
  onSetShowTextInput: (v: boolean) => void
  /** 选「我的故事」段 */
  onSelectMyStory: () => void
  /** 选「雅思题」段（首次切入时拉一道题） */
  onSelectIelts: () => void
  /** 换一题 */
  onNext: () => void
  /** 开始录音（先探测麦克风权限） */
  onStartRecording: () => void
  /** 文字输入内容变更 */
  onChangeTextStory: (v: string) => void
  /** 提交文字故事 */
  onSubmitStory: () => void
  /** 桌面切换「信息复用」Tab */
  onSelectReuseTab: (i: number) => void
}
