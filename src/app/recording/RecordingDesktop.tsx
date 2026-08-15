/**
 * @module   RecordingDesktop
 * @desc     录音页桌面端「聆听舞台」—— focus 档居中单列：Orb(240) + 氛围光 + 宽波形
 *           + 计时器（满 30s 转 success 色）+ 键盘控制。
 *           布局同移动端：展示区可滚动（flex-1 min-h-0 overflow-y-auto），动作区 shrink-0 钉底，
 *           保证矮屏（1080p 实际可视高约 900px）下「完成录音」始终在首屏内。
 *           纯展示组件，录音逻辑由 page.tsx 外壳持有并经 props 传入。
 * @author   LingoBridge
 * @created  2026-07-04
 */
'use client'
import { type JSX, useEffect, useRef } from 'react'
import GradientButton from '@/components/GradientButton'
import { RotateCcw, Pencil } from 'lucide-react'
import Orb from '@/components/Orb'
import Waveform from '@/components/Waveform'
import Toast from '@/components/Toast'
import type { RecordingViewProps } from './types'

/** 秒数格式化为 mm:ss */
function fmt(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

type StageProps = Pick<
  RecordingViewProps,
  'transcribing' | 'error' | 'seconds' | 'audioLevel' | 'onFinish' | 'onRerecord' | 'onSwitchToText' | 'onExit'
>

/** 舞台主体：仅在账号闸门放行后挂载，键盘监听随之只在可练习时生效。 */
function ListeningStage({
  transcribing,
  error,
  seconds,
  audioLevel,
  onFinish,
  onRerecord,
  onSwitchToText,
  onExit,
}: StageProps): JSX.Element {
  // 键盘控制：用 ref 持有最新回调，监听只订阅一次、无闭包过期
  const latest = useRef({ transcribing, onFinish, onRerecord, onExit })
  latest.current = { transcribing, onFinish, onRerecord, onExit }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 仅桌面断点生效：本组件在 hidden lg:block 里也会挂载，需按视口宽度过滤
      if (!window.matchMedia('(min-width: 1024px)').matches) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const s = latest.current
      if (e.key === 'Escape') { s.onExit(); return }
      if (s.transcribing) return
      if (e.code === 'Space') { e.preventDefault(); s.onFinish() }
      else if (e.key === 'r' || e.key === 'R') { s.onRerecord() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    // 展示区滚动 + 动作区钉底（对齐 RecordingMobile 的正确结构）：矮屏下「完成录音」始终可见
    <div className="relative z-10 flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center px-8 py-6">
        <div className="w-full max-w-[600px] flex flex-col items-center">

        <div className="contents" aria-hidden="true">
          <Orb size={240} audioLevel={transcribing ? 0 : audioLevel} pulse={transcribing} />
        </div>

        {!transcribing ? (
          <>
            <div className="mt-6 flex flex-col items-center gap-3">
              <div className="h-7 flex items-center">
                <Waveform active className="scale-[1.55]" />
              </div>
              <span className="text-[0.8125rem] text-v2-text-muted italic">listening…</span>
            </div>

            <div className="surface px-5 py-3.5 max-w-[360px] text-center mt-5">
              <p className="text-[0.875rem] text-v2-text-secondary leading-relaxed">
                正在聆听，说完点「完成录音」自动转写
              </p>
            </div>

            {/* 满 30s 进入推荐时长区间，计时器转 success 色轻点一下 */}
            <span
              className={
                `mt-5 text-[1.375rem] font-semibold tracking-[2px] tabular-nums transition-colors duration-500 ` +
                (seconds >= 30 ? 'text-success' : 'text-v2-text-primary')
              }
            >
              {fmt(seconds)}
            </span>
            <p className="mt-3 text-[0.75rem] text-v2-text-muted text-center leading-relaxed">
              建议说 30–60 秒，说得越具体效果越好 ✨
            </p>
          </>
        ) : (
          <p className="mt-6 text-[0.875rem] text-v2-text-muted">正在转写你的录音…</p>
        )}

        {error && (
          <p role="alert" className="mt-5 text-center text-[0.8125rem] text-error">{error}</p>
        )}

        </div>
      </div>

      {/* 动作区：移出滚动区、shrink-0 钉底，矮屏也不会被挤出首屏 */}
      <div className="shrink-0 flex flex-col items-center gap-4 px-8 pb-8 pt-4">
          {/* GradientButton（升级自原裸 btn-gradient，2026-08-15 收口，同 RecordingMobile）：
              皮肤由三色停对齐到基准页的两色停；hover 位移/阴影是本页独有的桌面态，留在 className 里。 */}
          <GradientButton
            onClick={onFinish}
            loading={transcribing}
            className="w-[280px] h-[56px] flex items-center justify-center gap-2 rounded-full text-[1rem] font-semibold transition-[transform,box-shadow] duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_22px_rgba(0,0,0,0.09)]"
          >
            <div aria-hidden="true" className="w-[15px] h-[15px] bg-v2-text-secondary rounded-[3px]" />
            {transcribing ? '转写中…' : '完成录音'}
          </GradientButton>
          <div className="flex items-center gap-5">
            <button
              onClick={onRerecord}
              disabled={transcribing}
              className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-v2-text-muted opacity-60 hover:opacity-100 transition-opacity duration-200 disabled:opacity-30"
            >
              <RotateCcw size={15} />
              重录
            </button>
            {/* 改用文字：对称 /write 的「改用录音」，跳 /write（带 qid） */}
            <button
              onClick={onSwitchToText}
              className="inline-flex items-center gap-1.5 text-[0.875rem] text-v2-text-muted hover:text-v2-text-secondary hover:-translate-y-[1px] transition-[color,transform] duration-200"
            >
              <Pencil size={15} />改用文字
            </button>
          </div>

        {!transcribing && (
          <p className="text-[0.75rem] text-v2-text-muted">
            空格 完成录音 · R 重录 · Esc 退出
          </p>
        )}
      </div>
    </div>
  )
}

export default function RecordingDesktop({
  transcribing,
  error,
  seconds,
  audioLevel,
  toastMsg,
  onFinish,
  onRerecord,
  onSwitchToText,
  onExit,
  onDismissToast,
}: RecordingViewProps): JSX.Element {
  return (
    <div className="relative h-full flex flex-col">
      <div className="ambient-light" />
      <ListeningStage
        transcribing={transcribing}
        error={error}
        seconds={seconds}
        audioLevel={audioLevel}
        onFinish={onFinish}
        onRerecord={onRerecord}
        onSwitchToText={onSwitchToText}
        onExit={onExit}
      />
      <Toast message={toastMsg} onDismiss={onDismissToast} />
    </div>
  )
}
