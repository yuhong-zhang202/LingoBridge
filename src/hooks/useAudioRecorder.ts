/**
 * @module   useAudioRecorder
 * @desc     录音 hook — MediaRecorder 采集音频 Blob + 实时电平（驱动 Orb）
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { useState, useRef, useCallback, useEffect } from 'react'

interface UseAudioRecorderReturn {
  audioLevel: number
  isRecording: boolean
  /** 开始录音（getUserMedia + MediaRecorder） */
  start: () => Promise<void>
  /** 停止录音，返回录到的音频 Blob（无录音时返回 null） */
  stop: () => Promise<Blob | null>
}

/**
 * 录音 hook
 * @returns 电平、录音状态、start/stop 方法
 */
export function useAudioRecorder(): UseAudioRecorderReturn {
  const [audioLevel, setAudioLevel] = useState(0)
  const [isRecording, setIsRecording] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const animRef = useRef<number>()
  const ctxRef = useRef<AudioContext | null>(null)

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
    if (streamRef.current) return // 已在录音，避免重复（含 StrictMode 双调用）
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
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
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        setAudioLevel(avg / 255)
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
      recorderRef.current = recorder
      setIsRecording(true)
    } catch {
      // 无麦克风权限 / 不支持 —— 静默清理
      cleanup()
    }
  }, [cleanup])

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current
      if (!recorder) {
        resolve(null)
        return
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        cleanup()
        resolve(blob.size > 0 ? blob : null)
      }
      recorder.stop()
    })
  }, [cleanup])

  // 卸载时清理
  useEffect(() => cleanup, [cleanup])

  return { audioLevel, isRecording, start, stop }
}
