/**
 * @module   VoiceBar
 * @desc     练习页录音态语音条 — 一排竖条随 audioLevel 横向滚动起伏；静默呈暖灰，出声双色交替（莫兰迪暖色：灰陶土 / 灰沙）
 * @author   LingoBridge
 * @created  2026-06-11
 */
'use client'
import { type JSX, useEffect, useRef, useState } from 'react'

const BAR_COUNT = 18
// audioLevel 原始值偏小，乘个增益放大观感；真机偏静/偏躁可在此微调
const GAIN = 4
const ACTIVE_THRESHOLD = 0.05

/**
 * 录音语音条
 * @param  audioLevel  实时电平（0–1），来自 useAudioRecorder
 * @returns            一排随声起伏的竖条
 */
export default function VoiceBar({ audioLevel }: { audioLevel: number }): JSX.Element {
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0))
  const levelRef = useRef(0)

  useEffect(() => { levelRef.current = audioLevel }, [audioLevel])

  // 每帧把最新电平推入右端、整体左移，形成横向流动的声波，而不是整排齐跳
  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (t: number): void => {
      if (t - last > 45) {
        last = t
        const jitter = 0.7 + Math.random() * 0.6
        const v = Math.min(1, levelRef.current * GAIN * jitter)
        setLevels((prev) => [...prev.slice(1), v])
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="flex flex-1 items-center justify-center gap-[3px] h-[24px] overflow-hidden">
      {levels.map((v, i) => {
        const active = v > ACTIVE_THRESHOLD
        const scale = active ? 0.22 + v * 0.78 : 0.22
        const color = !active ? '#C7C0B8' : i % 2 === 0 ? '#D9B49E' : '#D2BE97'
        return (
          <span
            key={i}
            className="w-[3.5px] rounded-[2px] h-[20px]"
            style={{
              transform: `scaleY(${scale})`,
              background: color,
              transition: 'transform 0.09s ease, background 0.12s ease',
            }}
          />
        )
      })}
    </div>
  )
}
