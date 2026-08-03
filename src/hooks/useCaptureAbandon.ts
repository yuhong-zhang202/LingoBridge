/**
 * @module   useCaptureAbandon
 * @desc     一次故事采集的「开始 / 中途放弃」埋点 —— /recording（语音）与 /write（文字）共用这一份。
 *
 *   【为什么必须只有一份】这里装的不是逻辑，是**数据口径**（只在真卸载时报、全生命周期只报一次、
 *   已提交不算放弃、pagehide 走 keepalive）。口径复制成两份 = 改口径要同时改两处，而漏改一处的表现是
 *   「语音路径和文字路径的放弃率不一样」—— 看起来像用户行为差异，几乎不可能被识破。
 *
 *   放弃的两条出口都要盯：站内跳走（组件卸载）与关标签页/切后台（pagehide）；后者页面随时会被冻结，
 *   必须走 keepalive 的 fetch（sendBeacon 设不了 Authorization 头 → 全 401，见 client-events 顶注）。
 *
 *   ⚠️ flow.capture_abandoned 的计数系统性偏低且不可校正，【永久禁止做任何比率的分子】，
 *   只能当归因样本用 —— 完整理由见 event-schema.ts 该事件条目上方的长注释。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
'use client'
import { useCallback, useEffect, useRef } from 'react'
import { track } from '@/lib/client-events'
import type { CaptureMode, CaptureExit } from '@/lib/event-schema'

/**
 * 卸载那一刻的「本次采集规模」——各路径各带各的字段，另一个不传（传 undefined 会被 normalize 丢掉）：
 * 语音路径带 durationSec（录音秒数），文字路径带 charCount（**只记长度、绝不带正文**，隐私铁律）。
 */
export interface CaptureScale {
  durationSec?: number
  charCount?: number
}

interface UseCaptureAbandonArgs {
  /** 本页的采集方式：/recording 传 'voice'，/write 传 'text' */
  mode: CaptureMode
  /**
   * 取「当次采集规模」的回调，在卸载/pagehide 那一刻才调用。
   * 调用方直接写 `() => ({ charCount: text.trim().length })` 即可：hook 内部用 ref 存最新引用，
   * 不会读到旧渲染的闭包值，**调用方不必自己再造一个 ref 同步**。
   */
  measure: () => CaptureScale
}

interface UseCaptureAbandonReturn {
  /**
   * 标记本次采集是否已【离开采集态】（已离开 → 卸载时不再算「放弃」）。
   * @param  submitted  默认 true = 已提交成功/被额度终结；传 false = 被 garbage / text_too_short
   *                    打回重写、人还在本页继续写，此时关页走人仍是真放弃，必须重新纳入统计。
   */
  markSubmitted: (submitted?: boolean) => void
}

/**
 * 采集开始 / 中途放弃埋点 hook（挂载即报 flow.capture_started）。
 * @param  args  { mode, measure } 采集方式 + 取当次采集规模的回调
 * @returns      { markSubmitted } 提交结局定局时调用，决定这次算不算「放弃」
 * @sideEffect   挂载时报 flow.capture_started；卸载 / pagehide(persisted=false) 时报
 *               flow.capture_abandoned（全生命周期至多一条，pagehide 路径走 keepalive）
 */
export function useCaptureAbandon({ mode, measure }: UseCaptureAbandonArgs): UseCaptureAbandonReturn {
  // 埋点用状态（不参与任何渲染/分支判断，故用 ref）：
  //   submittedRef  本次是否已离开采集态 —— 提交成功（或被额度就地终结）的人不算「放弃」
  //   abandonedRef  放弃事件全生命周期只报一次 —— pagehide 与卸载可能先后触发，不挡会报两条
  const submittedRef = useRef(false)
  const abandonedRef = useRef(false)
  // 下面那个 effect 是空依赖（全生命周期只挂一次，绝不能因为 mode/measure 换引用就重挂——重挂会重报
  // capture_started），故 mode 与 measure 一律经 ref 取最新值，避免读到首次渲染的旧闭包
  // （/write 若直接闭包捕获，放弃事件会恒报 charCount: 0）。
  const modeRef = useRef(mode)
  modeRef.current = mode
  const measureRef = useRef(measure)
  measureRef.current = measure

  useEffect(() => {
    track('flow.capture_started', { mode: modeRef.current })
    const reportAbandon = (exit: CaptureExit): void => {
      if (submittedRef.current || abandonedRef.current) return
      abandonedRef.current = true
      track(
        'flow.capture_abandoned',
        { mode: modeRef.current, exit, ...measureRef.current() },
        exit === 'pagehide' ? { keepalive: true } : undefined,
      )
    }
    // persisted=true ＝ 页面进 bfcache（iOS 切后台/后退最常见），用户很可能马上回来接着录/接着写。
    // 此时报 abandoned 会双错：把「回来了的人」算成放弃，且 abandonedRef 被用掉后他【真放弃时反而不报】。
    // 故只在 persisted=false（真正卸载）时报。代价是 iOS 上一部分真放弃收不到，abandoned 偏低——
    // 宁可偏低：偏低能用「有 capture_started 但此后 24h 无任何事件」推断口径补，偏高则无从分辨。
    const onPageHide = (e: PageTransitionEvent): void => { if (!e.persisted) reportAbandon('pagehide') }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      reportAbandon('nav')
    }
  }, [])

  // 引用恒定：调用方多把它写进 useCallback 依赖数组，换引用会连累那些回调每渲染重建
  const markSubmitted = useCallback((submitted = true): void => { submittedRef.current = submitted }, [])

  return { markSubmitted }
}
