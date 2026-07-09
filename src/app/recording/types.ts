/**
 * @module   RecordingViewProps
 * @desc     录音页移动/桌面两套展示视图共享的 props —— 录音状态与逻辑集中在 page.tsx 外壳持有，
 *           两个视图仅接收状态与回调做展示，保证全页只有一个 useAudioRecorder 实例（单麦克风流）。
 * @author   LingoBridge
 * @created  2026-07-04
 */

export interface RecordingViewProps {
  /** 是否正在转写（转写期间暂停计时、Orb 停止响应） */
  transcribing: boolean
  /** 当前错误提示（录音过短 / 转写失败等），无错误为 null */
  error: string | null
  /** 已录制秒数 */
  seconds: number
  /** 实时电平（0–1），驱动 Orb / 波形 */
  audioLevel: number
  /** 垃圾输入 Toast 文案，无则 null */
  toastMsg: string | null
  /** 点击「完成录音」 */
  onFinish: () => void
  /** 点击「重录」 */
  onRerecord: () => void
  /** 点击返回（移动端 TopBar 返回，= router.back()，保持移动端行为不变） */
  onBack: () => void
  /** 改用文字：跳 /write（带 qid，对称 /write 的改用录音；桌面动作簇用） */
  onSwitchToText: () => void
  /** 退出回首页（桌面 ✕ / Esc 一致，= router.push('/')） */
  onExit: () => void
  /** 关闭 Toast */
  onDismissToast: () => void
}
