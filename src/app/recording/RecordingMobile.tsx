/**
 * @module   RecordingMobile
 * @desc     录音页移动端视图 —— 与拆分前 RecordingContent 的渲染完全一致，仅改为接收 props 展示。
 *           录音逻辑（useAudioRecorder / 转写 / 计时）统一由 page.tsx 外壳持有，本组件不含副作用。
 * @author   LingoBridge
 * @created  2026-07-04
 */
'use client'
import { type JSX } from 'react'
import GradientButton from '@/components/GradientButton'
import { X, RotateCcw } from 'lucide-react'
import Waveform from '@/components/Waveform'
import Orb from '@/components/Orb'
import Toast from '@/components/Toast'
import type { RecordingViewProps } from './types'

/** 秒数格式化为 mm:ss */
function fmt(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function RecordingMobile({
  transcribing,
  error,
  seconds,
  audioLevel,
  toastMsg,
  onFinish,
  onRerecord,
  onBack,
  onDismissToast,
}: RecordingViewProps): JSX.Element {
  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      <div className="ambient-light" />

      {/* 顶部栏（桌面端居中约束，沉浸流程无侧栏） */}
      <div className="flex-shrink-0 flex items-center justify-between h-[52px] px-5 relative z-10 lg:h-16 lg:max-w-3xl lg:w-full lg:mx-auto">
        {/* 44px 命中区（外层按钮透明撑满），内层 span 保持原 30px 白圆视觉不变；右侧占位同步 44px 保标题居中 */}
        <button
          onClick={onBack}
          aria-label="返回"
          className="w-11 h-11 flex items-center justify-center"
        >
          <span className="w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center">
            <X size={14} className="text-v2-text-primary" />
          </span>
        </button>
        <span className="text-[1rem] font-semibold text-v2-text-primary">{transcribing ? '转写中' : '正在录音'}</span>
        <div className="w-11" />
      </div>

      {/* 中心内容（桌面端居中沉浸列，加大间距） */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center px-7 relative z-10 gap-4 py-4 lg:gap-6">

        <Orb size={260} audioLevel={transcribing ? 0 : audioLevel} pulse={transcribing} />

        {!transcribing ? (
          <>
            <div className="flex flex-col items-center gap-2.5">
              <Waveform active />
              <span className="text-[0.8125rem] text-v2-text-muted italic">listening...</span>
            </div>

            <div className="surface px-4 py-3 max-w-[260px] text-center">
              <p className="text-[0.875rem] text-v2-text-secondary leading-relaxed">
                正在聆听，说完点下方「完成录音」自动转写
              </p>
            </div>

            <span className="text-[1.375rem] font-semibold text-v2-text-primary tracking-[2px]">{fmt(seconds)}</span>

            <p className="text-[0.75rem] text-neutral-mute text-center px-8 leading-relaxed">
              建议说 30–60 秒，说得越具体效果越好 ✨
            </p>
          </>
        ) : (
          <p className="text-[0.8125rem] text-v2-text-muted">正在转写你的录音…</p>
        )}
      </div>

      {/* 底部控制（桌面端居中约束宽度，避免按钮拉满整屏） */}
      <div
        className="flex-shrink-0 px-8 relative z-10 lg:max-w-[440px] lg:w-full lg:mx-auto"
        style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom))', paddingTop: 20 }}
      >
        {/* role=alert：视觉保持灰色温柔基调不变色，仅让读屏即时播报错误（对齐 Desktop 可访问性） */}
        {error && <p role="alert" className="text-center text-[0.75rem] text-v2-text-muted mb-2">{error}</p>}
        {/* GradientButton（升级自原裸 btn-gradient，2026-08-15 收口）：loading 时自带 spinner + 禁用
            + aria-busy。⚠️ 皮肤同时从三色停换成两色停 —— 原 .btn-gradient 等价于
            GRADIENT_BORDER_STYLE_FULL，而基准页 feedback 与首页/登录用的都是 GradientButton
            （内部 GRADIENT_BORDER_STYLE，两色停）。此前本页与它们长得不一样，本次对齐基准页。 */}
        <GradientButton
          onClick={onFinish}
          loading={transcribing}
          className="w-full h-[56px] flex items-center justify-center gap-2 rounded-full text-[1rem] font-semibold"
        >
          <div aria-hidden="true" className="w-[15px] h-[15px] bg-neutral-slate rounded-[3px]" />
          {transcribing ? '转写中…' : '完成录音'}
        </GradientButton>
        <div className="flex justify-center mt-3">
          <button
            onClick={onRerecord}
            disabled={transcribing}
            className="flex items-center gap-1.5 text-[0.75rem] font-medium text-v2-text-muted disabled:opacity-50"
          >
            <RotateCcw size={15} />
            重录
          </button>
        </div>
      </div>
      <Toast message={toastMsg} onDismiss={onDismissToast} />
    </div>
  )
}
