'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

interface SheetBounds {
  left: number
  width: number
}

interface UseRecordingReturn {
  isLongPressing: boolean
  audioLevel: number
  sheetBounds: SheetBounds
  handlePressStart: () => void
  handlePressEnd: () => void
  cancelLongPress: () => void
}

export function useRecording(appContainerId = 'app-root-container'): UseRecordingReturn {
  const [isLongPressing, setIsLongPressing] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [sheetBounds, setSheetBounds] = useState<SheetBounds>({
    left: 0,
    width: typeof window !== 'undefined' ? window.innerWidth : 390,
  })

  const longPressTimer = useRef<ReturnType<typeof setTimeout>>()
  const animFrameRef = useRef<number>()
  const streamRef = useRef<MediaStream | null>(null)

  const calcSheetBounds = useCallback(() => {
    const container = document.getElementById(appContainerId)
    if (container) {
      const rect = container.getBoundingClientRect()
      setSheetBounds({ left: rect.left, width: rect.width })
    }
  }, [appContainerId])

  useEffect(() => {
    window.addEventListener('resize', calcSheetBounds)
    return () => window.removeEventListener('resize', calcSheetBounds)
  }, [calcSheetBounds])

  const startAudioAnalysis = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        setAudioLevel(avg / 255)
        animFrameRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      // no mic permission — silently ignore
    }
  }, [])

  const stopAudioAnalysis = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setAudioLevel(0)
  }, [])

  const handlePressStart = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      setIsLongPressing(true)
      calcSheetBounds()
      if (navigator.vibrate) navigator.vibrate(30)
      startAudioAnalysis()
    }, 300)
  }, [calcSheetBounds, startAudioAnalysis])

  const handlePressEnd = useCallback(() => {
    clearTimeout(longPressTimer.current)
  }, [])

  const cancelLongPress = useCallback(() => {
    setIsLongPressing(false)
    stopAudioAnalysis()
  }, [stopAudioAnalysis])

  useEffect(() => {
    return () => {
      clearTimeout(longPressTimer.current)
      stopAudioAnalysis()
    }
  }, [stopAudioAnalysis])

  return {
    isLongPressing,
    audioLevel,
    sheetBounds,
    handlePressStart,
    handlePressEnd,
    cancelLongPress,
  }
}
