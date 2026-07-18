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

export type PracticePhase = 'init' | 'idle' | 'recording' | 'transcribing' | 'replying' | 'error'

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
