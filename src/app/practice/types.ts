/**
 * @module   PracticeViewTypes
 * @desc     练习对话页移动/桌面两视图共享 props —— page.tsx 外壳集中持有全部对话逻辑（单实例录音器、
 *           phase 状态机、转写/回复/优化/发音捕捉、计时收尾、4 个 DOM ref 与其 effect）后下发，两视图纯展示。
 *           注意：全页只有外壳一个 useAudioRecorder 实例；start/stop/audioLevel 只经 props 下传，视图绝不自建录音器。
 * @author   LingoBridge
 * @created  2026-07-09
 */
import type { RefObject } from 'react'
import type { PracticeScaffold, PracticeMessage, PolishResult } from '@/lib/types'

export type PracticePhase =
  | 'init' | 'idle' | 'recording' | 'transcribing' | 'replying' | 'error'
  // —— 转写「排队自动重试 / 失败双选 / 文字输入」三态 ——
  /** ASR 并发闸 503（人多）→ 自动重试等待中；挂顶部涓流进度条 + sr-only 安抚播报 */
  | 'queued'
  /** 重试到顶/超时后进失败态：底部给「重试转写 / 改用文字输入」双选（blob 仍留存供重发） */
  | 'transcribeFailed'
  /** 用户改用文字输入：底部换 textarea，提交后与转写成功走完全相同的下游（sendReply） */
  | 'textInput'
  /** 教练回复失败（POST /api/practice 非额度/同意类错误）：底部给「再试一次」，用当前 messages 重发、不追加用户气泡 */
  | 'replyFailed'

/** 发音捕捉态：点某个词后挂在该气泡下方的纠错卡数据 */
export interface PracticeCapture {
  heard: string
  context: string
  msgIndex: number
  savedIds: string[]
}

export interface PracticeViewProps {
  scaffold: PracticeScaffold | null
  messages: PracticeMessage[]
  phase: PracticePhase
  error: string | null
  showPolish: boolean
  polishLoading: boolean
  polishResult: PolishResult | null
  capture: PracticeCapture | null
  /** 实时电平（0–1），来自外壳单实例 useAudioRecorder */
  audioLevel: number
  // —— 外壳算好的派生展示值 ——
  /** 录音计时 mm:ss */
  recTime: string
  /** 临近录音上限（剩余 ≤20s） */
  nearLimit: boolean
  /** 点击说话胶囊文案（点击说话 / 转写中… / 思考中…） */
  micLabel: string
  /** 临近上限提示文案（Part 2 含「2 分钟喊停」） */
  capHint: string
  /** 满 8 轮温柔收尾 */
  isCapped: boolean
  // —— 4 个 DOM ref（外壳持有 effect，单挂载下只绑一次） ——
  popupRef: RefObject<HTMLDivElement | null>
  orbRef: RefObject<HTMLButtonElement | null>
  bottomRef: RefObject<HTMLDivElement | null>
  pronounceRef: RefObject<HTMLDivElement | null>
  // —— 回调（全部走外壳，绝不新建录音器/业务逻辑） ——
  onStartRecord: () => void
  onCancelRecord: () => void
  /** 停录 → 转写 → 追加 → 回复 */
  onSend: () => void
  /** 转写失败态：用同一段留存的 blob 重发（重置重试计数） */
  onRetryTranscribe: () => void
  /** 转写失败态：放弃语音、改走文字输入（→ textInput） */
  onUseTextInput: () => void
  /** 文字输入态：提交这段文字当作本轮用户发言，走与转写成功完全相同的下游 */
  onSubmitText: (text: string) => void
  /** 文字输入态：返回失败双选（→ transcribeFailed） */
  onCancelText: () => void
  /** 回复失败态：用当前 messages（末条为用户气泡）重发，成功只追加教练回复、绝不再追加用户气泡 */
  onRetryReply: () => void
  /** 已进回复失败态的次数（≥2 换更强安抚文案），默认 1 */
  replyFailAttempt?: number
  onWordTap: (word: string, content: string, index: number) => void
  onPolish: (content: string, index: number) => void
  onReopenPolish: () => void
  onClosePolish: () => void
  onSavePronunciation: (intended: string) => void
  onCloseCapture: () => void
  onEnd: () => void
  onRetry: () => void
  /** 退出（桌面外壳 ✕ / Esc 未用；走 router.back()） */
  onExit: () => void
}
