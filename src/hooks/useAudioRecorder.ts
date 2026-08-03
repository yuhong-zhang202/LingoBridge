/**
 * @module   useAudioRecorder
 * @desc     录音 hook — MediaRecorder 采集音频 Blob + 实时电平（驱动 Orb）
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { track } from '@/lib/client-events'
import type { MicSurface as SchemaMicSurface } from '@/lib/event-schema'

/**
 * 一段录音的结果 + 采集信号（供「假空率」区分真空/假空）：
 *   · peakLevel  录音期间 audioLevel 的峰值（0~1）。高=采到了真实声音，低=用户真没出声。
 *   · durationMs 录音起（recorder.start）止（onstop）的墙钟时长。
 * 两个信号在服务端仅在「空录音失败」时落 metadata.audio、看板据此判采集问题，绝不影响转写本身。
 */
interface RecordingResult {
  blob: Blob
  peakLevel: number
  durationMs: number
}

/**
 * 麦克风授权失败埋点归属的界面 —— 取值域【派生自 event-schema 的 MIC_SURFACE 真源】，本文件不再手抄
 * （手抄的那份与真源脱钩后，服务端 sanitize 对不认识的值是静默丢弃，本地永远测不出来）。
 * ⚠️ 必传：写死一个常量就会把另一个界面的失败全灌进同一格（本 hook 被录音页与练习页共用，练习页每轮
 * 对话都调 start()，写死 'recording' 会让拒过麦克风的练习用户每轮刷一条，把故事采集的授权失败率灌高）。
 *
 * 【为什么排除 'home' 而不是正向列举】'home' 是首页的**权限探测**（page.tsx 自己 track，不经本 hook），
 * 本 hook 一旦收到它就是把「探测」混进「真开录失败」那一格。用 Exclude 表达「除了它都行」，
 * 将来新页面接入本 hook 时只需往真源加值、不必回来改这里；而真源里若把 'recording' 改名，
 * 调用点会立刻 tsc 报错（不会静默漂移）。
 */
export type MicSurface = Exclude<SchemaMicSurface, 'home'>

interface UseAudioRecorderOptions {
  /** 本次挂载所属界面，进 flow.mic_permission 的 surface 字段 */
  surface: MicSurface
}

interface UseAudioRecorderReturn {
  audioLevel: number
  isRecording: boolean
  /** 开始录音（getUserMedia + MediaRecorder） */
  start: () => Promise<void>
  /** 停止录音，返回音频 Blob + 本段采集信号（peakLevel/durationMs）；无录音时返回 null */
  stop: () => Promise<RecordingResult | null>
}

/**
 * 录音 hook
 * @param  options  { surface } 本次挂载所属界面（授权失败埋点用，必传）
 * @returns 电平、录音状态、start/stop 方法
 */
export function useAudioRecorder({ surface }: UseAudioRecorderOptions): UseAudioRecorderReturn {
  const [audioLevel, setAudioLevel] = useState(0)
  const [isRecording, setIsRecording] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const animRef = useRef<number | undefined>(undefined)
  const ctxRef = useRef<AudioContext | null>(null)
  // getUserMedia 未决期的再入守卫：streamRef 要 await 后才置位，仅靠它挡不住
  // StrictMode 双挂载 / 快速重入并发进入 start——会叠出多个 tick 循环（animRef 被覆写而无法 cancel，
  // 泄漏的循环在已卸载组件上持续 setAudioLevel，触发 Maximum update depth）。
  const startingRef = useRef(false)
  const mountedRef = useRef(true)
  // 本段录音的采集信号（供「假空率」判真空/假空）：peakRef 在 tick 里累计 audioLevel 峰值，
  // startTsRef 记录起录墙钟时刻，stop 时算 durationMs。均在 start 时重置，不进 cleanup（onstop 要读末值）。
  const peakRef = useRef(0)
  const startTsRef = useRef(0)

  const cleanup = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    void ctxRef.current?.close().catch(() => {})
    streamRef.current = null
    recorderRef.current = null
    ctxRef.current = null
    setAudioLevel(0)
    setIsRecording(false)
  }, [])

  const start = useCallback(async (): Promise<void> => {
    if (streamRef.current || startingRef.current) return // 已在录音 / 正在起录，避免重复（含 StrictMode 双调用与 getUserMedia 未决期）
    startingRef.current = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // 起录期间组件已卸载：丢弃拿到的流，不在已卸载组件上启动 tick / setState
      if (!mountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream

      // 电平分析（驱动 Orb）
      const ctx = new AudioContext()
      ctxRef.current = ctx
      await ctx.resume().catch(() => {})
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      peakRef.current = 0   // 新一段录音：清掉上段的峰值
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        const level = avg / 255
        if (level > peakRef.current) peakRef.current = level   // 追踪本段峰值
        setAudioLevel(level)
        animRef.current = requestAnimationFrame(tick)
      }
      tick()

      // 采集音频
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start()
      startTsRef.current = Date.now()   // 起录墙钟时刻，供 stop 算 durationMs
      recorderRef.current = recorder
      setIsRecording(true)
    } catch (e) {
      // 无麦克风权限 / 不支持 —— 静默清理（埋点 fire-and-forget，清理行为一字未改）。
      // 这里必须埋：后退/刷新直达录音页时不经首页那次探测，缺了它这条路径的授权失败全是黑的。
      track('flow.mic_permission', {
        result: (e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable',
        surface,
      })
      cleanup()
    } finally {
      startingRef.current = false
    }
  }, [cleanup, surface])

  const stop = useCallback((): Promise<RecordingResult | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current
      if (!recorder) {
        resolve(null)
        return
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        // 峰值/时长在 cleanup 前定格：cleanup 只 cancel tick、不重置这两个 ref，故先后读均可，此处先读更直白
        const peakLevel  = peakRef.current
        const durationMs = startTsRef.current > 0 ? Date.now() - startTsRef.current : 0
        cleanup()
        resolve(blob.size > 0 ? { blob, peakLevel, durationMs } : null)
      }
      recorder.stop()
    })
  }, [cleanup])

  // 卸载时清理，并翻转 mountedRef —— 供 start 在 await 后判断组件是否还在，避免卸载后启动泄漏循环
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; cleanup() }
  }, [cleanup])

  return { audioLevel, isRecording, start, stop }
}
