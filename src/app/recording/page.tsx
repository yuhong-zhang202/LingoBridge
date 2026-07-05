/**
 * @module   RecordingPage
 * @desc     录音页外壳 — 集中持有录音逻辑（采集/转写/计时），按 lg 断点分发移动/桌面两套视图。
 *           逻辑单实例保证全页只有一个 useAudioRecorder（单麦克风流），两视图仅接收状态与回调。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { isGarbageInput, GARBAGE_TOAST_MSG } from '@/lib/utils'
import { putHandoff } from '@/lib/handoff'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import RecordingMobile from './RecordingMobile'
import RecordingDesktop from './RecordingDesktop'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import type { RecordingViewProps } from './types'

function RecordingContent(): JSX.Element {
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

  const viewProps: RecordingViewProps = {
    transcribing,
    error,
    seconds,
    audioLevel,
    toastMsg,
    onFinish: () => void handleFinish(),
    onRerecord: () => void handleRerecord(),
    onBack: () => router.back(),
    onDismissToast: () => setToastMsg(null),
  }

  return (
    <>
      <div className="lg:hidden"><RecordingMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 外壳 + RecordingDesktop 聆听舞台 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="story" onExit={() => router.back()}>
          <RecordingDesktop {...viewProps} />
        </FlowShellDesktop>
      </div>
    </>
  )
}

export default function RecordingPage(): JSX.Element {
  return <Suspense><RecordingContent /></Suspense>
}
