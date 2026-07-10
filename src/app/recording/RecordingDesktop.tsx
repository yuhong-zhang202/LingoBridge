/**
 * @module   RecordingDesktop
 * @desc     录音页桌面端「聆听舞台」—— focus 档居中单列：放大 Orb(340) + 氛围光 + 宽波形
 *           + 计时器（满 30s 转 success 色）+ 居中动作簇（完成/重录）+ 键盘控制。
 *           纯展示组件，录音逻辑由 page.tsx 外壳持有并经 props 传入。
 * @author   LingoBridge
 * @created  2026-07-04
 */
'use client'
import { useEffect, useRef } from 'react'
import { RotateCcw, Pencil } from 'lucide-react'
import Orb from '@/components/Orb'
import Waveform from '@/components/Waveform'
import Toast from '@/components/Toast'
import RequireAccountGate from '@/components/RequireAccountGate'
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
    <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-8 py-8">
      <div className="w-full max-w-[600px] flex flex-col items-center">

        <div className="contents" aria-hidden="true">
          <Orb size={340} audioLevel={transcribing ? 0 : audioLevel} pulse={transcribing} />
        </div>

        {!transcribing ? (
          <>
            <div className="mt-10 flex flex-col items-center gap-3">
              <div className="h-7 flex items-center">
                <Waveform active className="scale-[1.55]" />
              </div>
              <span className="text-[13px] text-v2-text-muted italic">listening…</span>
            </div>

            <div className="surface px-5 py-3.5 max-w-[360px] text-center mt-7">
              <p className="text-[14px] text-v2-text-secondary leading-relaxed">
                正在聆听，说完点「完成录音」自动转写
              </p>
            </div>

            {/* 满 30s 进入推荐时长区间，计时器转 success 色轻点一下 */}
            <span
              className={
                `mt-7 text-[22px] font-semibold tracking-[2px] tabular-nums transition-colors duration-500 ` +
                (seconds >= 30 ? 'text-success' : 'text-v2-text-primary')
              }
            >
              {fmt(seconds)}
            </span>
            <p className="mt-3 text-[12px] text-v2-text-muted text-center leading-relaxed">
              建议说 30–60 秒，说得越具体效果越好 ✨
            </p>
          </>
        ) : (
          <p className="mt-10 text-[14px] text-v2-text-muted">正在转写你的录音…</p>
        )}

        {error && (
          <p role="alert" className="mt-7 text-center text-[13px] text-error">{error}</p>
        )}

        {/* 居中动作簇（不再 fixed 贴底） */}
        <div className="mt-12 flex flex-col items-center gap-4">
          <button
            onClick={onFinish}
            disabled={transcribing}
            className="btn-gradient w-[280px] h-[56px] text-[16px] font-semibold disabled:opacity-50 transition-[transform,box-shadow] duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_22px_rgba(0,0,0,0.09)]"
          >
            <div aria-hidden="true" className="w-[15px] h-[15px] bg-v2-text-secondary rounded-[3px]" />
            {transcribing ? '转写中…' : '完成录音'}
          </button>
          <div className="flex items-center gap-5">
            <button
              onClick={onRerecord}
              disabled={transcribing}
              className="flex items-center gap-1.5 text-[13px] font-medium text-v2-text-muted opacity-60 hover:opacity-100 transition-opacity duration-200 disabled:opacity-30"
            >
              <RotateCcw size={15} />
              重录
            </button>
            {/* 改用文字：对称 /write 的「改用录音」，跳 /write（带 qid） */}
            <button
              onClick={onSwitchToText}
              className="inline-flex items-center gap-1.5 text-[14px] text-v2-text-muted hover:text-v2-text-secondary hover:-translate-y-[1px] transition-[color,transform] duration-200"
            >
              <Pencil size={15} />改用文字
            </button>
          </div>
        </div>

        {!transcribing && (
          <p className="mt-8 text-[12px] text-v2-text-muted">
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
      <RequireAccountGate>
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
      </RequireAccountGate>
      <Toast message={toastMsg} onDismiss={onDismissToast} />
    </div>
  )
}
