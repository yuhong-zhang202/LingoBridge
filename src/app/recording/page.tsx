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
import { putHandoff, putHandoffJson } from '@/lib/handoff'
import { newFlowId } from '@/lib/flow-id'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { apiFetch } from '@/lib/api-client'
import RecordingMobile from './RecordingMobile'
import RecordingDesktop from './RecordingDesktop'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import type { RecordingViewProps } from './types'

function RecordingContent(): JSX.Element {
  const router = useRouter()
  const qid = useSearchParams().get('qid')
  const [seconds, setSeconds] = useState(0)
  const secondsRef = useRef(0)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  // 预检 402（匿名整理额度用尽）→ 弹试用结束覆盖层，不带用户去 restructure 页再失败一次
  const [quotaReached, setQuotaReached] = useState(false)
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
    // 语音路径的流程起点：开启一次新 flow_id，串起 ASR→整理→建语料（经 X-Flow-Id 头透传，不进 URL）
    newFlowId()
    setTranscribing(true)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const blob = await stop()
      if (!blob) throw new Error('没有录到声音，请重试')
      if (blob.size > 10 * 1024 * 1024) throw new Error('录音过长，请分段录制') // ENGINEERING §9
      const form = new FormData()
      form.append('audio', blob, 'recording.webm')
      // multipart：传 body（非 json），apiFetch 不设 Content-Type，交浏览器自动带 boundary
      const res = await apiFetch('/api/transcribe', { method: 'POST', body: form, signal: ac.signal })
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
      // 第二层：让 restructure 判断 usable；usable 时把整理结果一并带走，restructure 页免二次整理调用
      try {
        const checkRes = await apiFetch('/api/restructure', {
          method: 'POST',
          json: { rawText: data.text },
          signal: ac.signal,
        })
        // 匿名整理额度用尽：不跳转，弹试用结束提示
        if (checkRes.status === 402) {
          if (!ac.signal.aborted) { setQuotaReached(true); setTranscribing(false) }
          return
        }
        if (checkRes.ok) {
          const checkData = (await checkRes.json()) as { cleanedText: string; usable: boolean }
          if (!checkData.usable) {
            setToastMsg(GARBAGE_TOAST_MSG)
            setTranscribing(false)
            return
          }
          if (ac.signal.aborted) return          // 已跳页则不再导航
          router.push(`/restructure?h=${putHandoffJson({ rawText: data.text, cleanedText: checkData.cleanedText })}${qid ? `&qid=${qid}` : ''}`)
          return
        }
        // 其他非 402 错误：落到 try 外的放行分支，restructure 页兜底自行整理
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
    onSwitchToText: () => router.push(qid ? `/write?qid=${qid}` : '/write'),
    onExit: () => router.push('/'),
    onDismissToast: () => setToastMsg(null),
  }

  return (
    <>
      <div className="lg:hidden"><RecordingMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 外壳 + RecordingDesktop 聆听舞台 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="story" onExit={viewProps.onExit}>
          <RecordingDesktop {...viewProps} />
        </FlowShellDesktop>
      </div>
      {/* 匿名整理额度用尽：试用结束覆盖层，关闭即回首页 */}
      {quotaReached && <QuotaReached variant="trial" asOverlay onClose={() => router.push('/')} />}
    </>
  )
}

export default function RecordingPage(): JSX.Element {
  return <Suspense><RecordingContent /></Suspense>
}
