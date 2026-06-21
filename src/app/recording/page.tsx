/**
 * @module   RecordingPage
 * @desc     录音页 — 真实采集音频，完成后调 Whisper 转写并进入整理流程
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { X, RotateCcw } from 'lucide-react'
import Waveform from '@/components/Waveform'
import Orb from '@/components/Orb'
import Toast from '@/components/Toast'
import RequireAccountGate from '@/components/RequireAccountGate'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { isGarbageInput, GARBAGE_TOAST_MSG } from '@/lib/utils'
import { putHandoff } from '@/lib/handoff'

function RecordingContent() {
  const router = useRouter()
  const qid = useSearchParams().get('qid')
  const [seconds, setSeconds] = useState(0)
  const secondsRef = useRef(0)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const { audioLevel, start, stop } = useAudioRecorder()

  // 计时（转写时暂停）
  useEffect(() => {
    if (transcribing) return
    const t = setInterval(() => setSeconds((s) => { secondsRef.current = s + 1; return s + 1 }), 1000)
    return () => clearInterval(t)
  }, [transcribing])

  // 进页面即开始录音
  useEffect(() => { void start() }, [start])

  // 卸载（用户跳页）时中断未完成的转写/整理请求，防护卸载后 setState
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const handleFinish = useCallback(async () => {
    setError(null)
    // 第一层：录音过短，提示继续说而非上传（保持录音中）
    if (secondsRef.current < 5) {
      setError('还想再说点什么吗？目前语料可能有点短哦')
      return
    }
    setTranscribing(true)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const blob = await stop()
      if (!blob) throw new Error('没有录到声音，请重试')
      if (blob.size > 10 * 1024 * 1024) throw new Error('录音过长，请分段录制') // ENGINEERING §9
      const form = new FormData()
      form.append('audio', blob, 'recording.webm')
      const res = await fetch('/api/transcribe', { method: 'POST', body: form, signal: ac.signal })
      if (!res.ok) {
        const errData = (await res.json()) as { error?: string; code?: string }
        throw new Error(
          errData.code === 'EMPTY_TRANSCRIPT'
            ? '好像没太听清，要不要再说一次？'
            : '转写失败，请重试'
        )
      }
      const data = (await res.json()) as { text: string }
      if (ac.signal.aborted) return
      // 第一层：即时预检（不调 API）
      if (isGarbageInput(data.text)) {
        setToastMsg(GARBAGE_TOAST_MSG)
        setTranscribing(false)
        return
      }
      // 第二层：让 restructure 判断 usable
      try {
        const checkRes = await fetch('/api/restructure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawText: data.text }),
          signal: ac.signal,
        })
        if (checkRes.ok) {
          const checkData = (await checkRes.json()) as { cleanedText: string; usable: boolean }
          if (!checkData.usable) {
            setToastMsg(GARBAGE_TOAST_MSG)
            setTranscribing(false)
            return
          }
        }
      } catch { /* API 错误（含中断）放行，restructure 页面兜底 */ }
      if (ac.signal.aborted) return          // 已跳页则不再导航
      router.push(`/restructure?h=${putHandoff(data.text)}${qid ? `&qid=${qid}` : ''}`)
    } catch (e) {
      if (ac.signal.aborted) return          // 中断不算错误，忽略
      setError(e instanceof Error ? e.message : '转写失败，请重试')
      setTranscribing(false)
    }
  }, [stop, router, qid])

  const handleRerecord = useCallback(async () => {
    await stop()
    secondsRef.current = 0
    setSeconds(0)
    setError(null)
    void start()
  }, [stop, start])

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      <div className="ambient-light" />

      {/* 顶部栏 */}
      <div className="flex-shrink-0 flex items-center justify-between h-[52px] px-5 relative z-10">
        <button
          onClick={() => router.back()}
          aria-label="返回"
          className="w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center"
        >
          <X size={14} className="text-v2-text-primary" />
        </button>
        <span className="text-[15px] font-semibold text-v2-text-primary">{transcribing ? '转写中' : '正在录音'}</span>
        <div className="w-[30px]" />
      </div>

      <RequireAccountGate>
      {/* 中心内容 */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-7 relative z-10 gap-4 py-4">

        <Orb size={260} audioLevel={transcribing ? 0 : audioLevel} pulse={transcribing} />

        {!transcribing ? (
          <>
            <div className="flex flex-col items-center gap-2.5">
              <Waveform active />
              <span className="text-[13px] text-v2-text-muted italic">listening...</span>
            </div>

            <div className="surface px-4 py-3 max-w-[260px] text-center">
              <p className="text-[13px] text-v2-text-secondary leading-relaxed">
                正在聆听，说完点下方「完成录音」自动转写
              </p>
            </div>

            <span className="text-[22px] font-semibold text-v2-text-primary tracking-[2px]">{fmt(seconds)}</span>

            <p className="text-[12px] text-[#CCCCCC] text-center px-8 leading-relaxed">
              建议说 30–60 秒，说得越具体效果越好 ✨
            </p>
          </>
        ) : (
          <p className="text-[13px] text-v2-text-muted">正在转写你的录音…</p>
        )}
      </div>

      {/* 底部控制 */}
      <div
        className="flex-shrink-0 px-8 relative z-10"
        style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom))', paddingTop: 20 }}
      >
        {error && <p className="text-center text-[12px] text-v2-text-muted mb-2">{error}</p>}
        <button
          onClick={handleFinish}
          disabled={transcribing}
          className="btn-gradient w-full h-[56px] text-[16px] font-semibold disabled:opacity-50"
        >
          <div className="w-[15px] h-[15px] bg-[#555] rounded-[3px]" />
          {transcribing ? '转写中…' : '完成录音'}
        </button>
        <div className="flex justify-center mt-3">
          <button
            onClick={handleRerecord}
            disabled={transcribing}
            className="flex items-center gap-1.5 text-[12px] font-medium text-v2-text-muted disabled:opacity-50"
          >
            <RotateCcw size={15} />
            重录
          </button>
        </div>
      </div>
      </RequireAccountGate>
      <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />
    </div>
  )
}

export default function RecordingPage() {
  return <Suspense><RecordingContent /></Suspense>
}
