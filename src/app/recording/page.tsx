/**
 * @module   RecordingPage
 * @desc     录音页外壳 — 集中持有录音逻辑（采集/转写/计时），按 lg 断点分发移动/桌面两套视图。
 *           逻辑单实例保证全页只有一个 useAudioRecorder（单麦克风流），两视图仅接收状态与回调。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { type JSX, useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { isGarbageInput, isTooShortForCorpus, GARBAGE_TOAST_MSG, TOO_SHORT_TOAST_MSG } from '@/lib/utils'
import { putHandoff, putHandoffJson } from '@/lib/handoff'
import { newFlowId } from '@/lib/flow-id'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { apiFetch } from '@/lib/api-client'
import { track } from '@/lib/client-events'
import { useStoryQuotaGuard } from '@/hooks/useStoryQuotaGuard'
import { useNav } from '@/components/NavProgress'
import RecordingMobile from './RecordingMobile'
import RecordingDesktop from './RecordingDesktop'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import type { RecordingViewProps } from './types'

/**
 * 本页会上报的提交结局 —— 逐字对齐 /api/events 的 CAPTURE_OUTCOME 白名单。
 * 单列一个类型是为了让拼错的枚举值在 tsc 就炸掉：服务端 sanitize 遇到不认识的值是【静默丢弃】，
 * 打错一个字母就是「埋了但库里查不到」，本地永远测不出来。
 */
type CaptureOutcome =
  | 'proceed' | 'too_short' | 'quota_blocked' | 'no_audio' | 'too_large'
  | 'garbage' | 'text_too_short' | 'consent_blocked' | 'ai_failed' | 'aborted'

/** 本页会上报的 AI 调用结局 —— 同样逐字对齐 /api/events 的 AI_RESULT 白名单（只列本页用得到的） */
type AiResult =
  | 'ok' | 'consent_403' | 'quota_402' | 'busy_503' | 'empty_422'
  | 'server_5xx' | 'other' | 'network' | 'aborted'

function RecordingContent(): JSX.Element {
  const router = useRouter()
  // 「改用文字」跳 /write、退出跳首页走 navigate → 点击当帧亮顶部进度条（消冷缓存空窗）；
  // 转写完成后跳 /restructure、403/中断回首页仍走 router（后者带 AbortController 中断语义，
  // 不进 startTransition 以免与中断判定纠缠；转写后跳转为异步动作完成后的重定向、非点导航按钮）
  const { navigate } = useNav()
  const qid = useSearchParams().get('qid')
  const [seconds, setSeconds] = useState(0)
  const secondsRef = useRef(0)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  // 预检 402（匿名整理额度用尽）→ 弹试用结束覆盖层，不带用户去 restructure 页再失败一次
  const [quotaReached, setQuotaReached] = useState(false)
  const { audioLevel, start, stop } = useAudioRecorder()

  // 建新故事额度守卫（匿名试用总条数 / 注册用户月额度，共享 hook）。
  // 【为何拦在「完成」而不是挂载】本页深链/浏览器后退可直达，首页与 /write 的入口守卫覆盖不到；
  // 但录音本身不花钱，真正花钱的是点「完成」后的 ASR，且挂载即拦会为所有正常用户引入一次异步等待、
  // 拖慢自动开录。故拦在离花钱最近的那一步（hook 内部仍在挂载时后台预取，点击零延迟）。
  // 解构取值：checkBlocked 进 handleFinish 的依赖数组，需稳定引用（hook 内 useCallback 无依赖）
  const { blockedVariant: storyQuotaVariant, checkBlocked: checkStoryQuota } = useStoryQuotaGuard()

  // 计时（转写时暂停）
  useEffect(() => {
    if (transcribing) return
    const t = setInterval(() => setSeconds((s) => { secondsRef.current = s + 1; return s + 1 }), 1000)
    return () => clearInterval(t)
  }, [transcribing])

  // 进页面即开始录音
  useEffect(() => { void start() }, [start])

  // 埋点用状态（不参与任何渲染/分支判断，故用 ref）：
  //   submittedRef  本次是否已提交成功（capture_submitted='proceed'）—— 提交成功的人不算「放弃」
  //   abandonedRef  放弃事件全生命周期只报一次 —— pagehide 与卸载可能先后触发，不挡会报两条
  const submittedRef = useRef(false)
  const abandonedRef = useRef(false)

  // 采集开始 / 中途放弃埋点。放弃的两条出口都要盯：站内跳走（组件卸载）与关标签页/切后台（pagehide）；
  // 后者页面随时会被冻结，必须走 keepalive 的 fetch（sendBeacon 设不了 Authorization 头 → 全 401，见 client-events 顶注）。
  useEffect(() => {
    track('flow.capture_started', { mode: 'voice' })
    const reportAbandon = (exit: 'nav' | 'pagehide'): void => {
      if (submittedRef.current || abandonedRef.current) return
      abandonedRef.current = true
      track(
        'flow.capture_abandoned',
        { mode: 'voice', exit, durationSec: Math.round(secondsRef.current) },
        exit === 'pagehide' ? { keepalive: true } : undefined,
      )
    }
    const onPageHide = (): void => reportAbandon('pagehide')
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      reportAbandon('nav')
    }
  }, [])

  // 卸载（用户跳页）时中断未完成的转写/整理请求，防护卸载后 setState
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const handleFinish = useCallback(async () => {
    setError(null)
    // 语音路径的流程起点：开启一次新 flow_id，串起 ASR→整理→建语料（经 X-Flow-Id 头透传，不进 URL）。
    // 【必须在所有早退分支之前换】否则 too_short / quota_blocked 这两条早退路上发出的事件，会挂在
    // sessionStorage 里残留的【上一次流程】的 flow_id 上，两次流程被串成一条。早退也换新 id 无副作用。
    newFlowId()

    // ——— 本次提交的埋点脚手架（全部 fire-and-forget，不参与任何分支判断、不改任何时序）———
    // 两段 AI 调用各自的起始时刻。声明在 try 外是因为 catch 也要读；null = 请求还没发出过 → 不带 latencyMs。
    let t0: number | null = null
    let t1: number | null = null
    /** 距起始时刻的耗时(ms)；起始为 null（请求尚未发出）返回 undefined，track 会丢掉该字段 */
    const since = (t: number | null): number | undefined => (t === null ? undefined : performance.now() - t)
    let submitReported = false
    /**
     * 本次提交的结局：每条执行路径【恰好】报一条，重复报会让「提交结局分布」重复计数。
     * 之所以要挡：no_audio / too_large 是 throw 出去的，会被下面的 catch 再兜一次（那里报 ai_failed）。
     * 先到者为准 —— 先报的那个离真实原因更近。
     */
    const reportSubmit = (outcome: CaptureOutcome): void => {
      if (submitReported) return
      submitReported = true
      if (outcome === 'proceed') submittedRef.current = true   // 已成功提交 → 卸载时不再算「放弃」
      track('flow.capture_submitted', { mode: 'voice', outcome, durationSec: Math.round(secondsRef.current) })
    }
    let transcribeReported = false
    /**
     * 转写这一次调用的结局：同样只报一条，且【只在请求真发出过（t0 已置位）之后】才报。
     * 两个条件缺一不可：不挡重复，!res.ok 抛出的错会被 catch 再记一遍同一次调用；不挡 t0，
     * 「没有录到声音 / 录音过长」也落进同一个 catch，可那时压根没发过转写请求，记成 network 就是凭空造故障。
     */
    const reportTranscribe = (result: AiResult, httpStatus: number): void => {
      if (transcribeReported || t0 === null) return
      transcribeReported = true
      track('flow.ai_call', { stage: 'transcribe', result, httpStatus, latencyMs: since(t0) })
    }

    // 第一层：录音过短，提示继续说而非上传（保持录音中）
    if (secondsRef.current < 5) {
      reportSubmit('too_short')
      setError('还想再说点什么吗？目前语料可能有点短哦')
      return
    }
    // 第二层：建新故事额度守卫 —— 超额就别再调 ASR（花了钱也只会在保存时被 402 拦）。停掉录音、弹提示。
    if (await checkStoryQuota()) {
      reportSubmit('quota_blocked')
      await stop()
      return
    }
    setTranscribing(true)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const rec = await stop()
      if (!rec) { reportSubmit('no_audio'); throw new Error('没有录到声音，请重试') }
      const blob = rec.blob
      if (blob.size > 10 * 1024 * 1024) { reportSubmit('too_large'); throw new Error('录音过长，请分段录制') } // ENGINEERING §9
      const form = new FormData()
      form.append('audio', blob, 'recording.webm')
      // scene='story'：语料转写（录音→整理语料链路）。仅供服务端打 phase 埋点区分看板归位，不影响转写行为。
      form.append('scene', 'story')
      // 采集信号（可选增强）：仅服务端在「空录音失败」时落 metadata.audio 供假空率判定，不影响转写行为。
      form.append('peakLevel', String(rec.peakLevel))
      form.append('durationMs', String(rec.durationMs))
      form.append('blobBytes', String(blob.size))
      // multipart：传 body（非 json），apiFetch 不设 Content-Type，交浏览器自动带 boundary
      t0 = performance.now()
      const res = await apiFetch('/api/transcribe', { method: 'POST', body: form, signal: ac.signal })
      // 服务端同意闸拒绝（未捕获同意）：这两个 AI 路由的 403 只可能是缺同意。回首页触发同意弹窗，
      // 别卡在「转写失败」裸报错死胡同。
      if (res.status === 403) {
        reportTranscribe('consent_403', 403)
        reportSubmit('consent_blocked')
        if (!ac.signal.aborted) router.push('/')
        return
      }
      // 匿名 ASR 试用额度用尽：402 必须走 trial 覆盖层引导注册，不能落进下面的通用 !res.ok 错误态
      // （只显示「转写失败，请重试」= 让撞上限的匿名用户以为是故障，反复重试仍失败 → 转化流失）。
      // 与 storyQuotaVariant 的区别：此处 402 是匿名【ASR 当日】试用用尽（服务端兜底）；
      // storyQuotaVariant 是点「完成」前的前置守卫（匿名语料总条数 / 注册用户月额度）。来源不同，不可混用。
      if (res.status === 402) {
        reportTranscribe('quota_402', 402)
        reportSubmit('quota_blocked')
        if (!ac.signal.aborted) { setQuotaReached(true); setTranscribing(false) }
        return
      }
      if (!res.ok) {
        const errData = (await res.json()) as { error?: string; code?: string }
        reportTranscribe(
          errData.code === 'ASR_BUSY'
            ? 'busy_503'
            : errData.code === 'EMPTY_TRANSCRIPT'
              ? 'empty_422'
              : res.status >= 500 ? 'server_5xx' : 'other',
          res.status,
        )
        // ASR_BUSY（503，转写并发排队满/超时）必须和「转写失败」分开说：前者是"人多"、几秒后重试就好，
        // 后者是"坏了"。文案混用会让用户以为产品故障而直接放弃。
        throw new Error(
          errData.code === 'ASR_BUSY'
            ? '现在使用的人有点多，稍等几秒再说一次就好'
            : errData.code === 'EMPTY_TRANSCRIPT'
              ? '好像没太听清，要不要再说一次？'
              : '转写失败，请重试'
        )
      }
      const data = (await res.json()) as { text: string }
      reportTranscribe('ok', 200)
      if (ac.signal.aborted) { reportSubmit('aborted'); return }
      // 第一层：即时预检（不调 API）
      if (isGarbageInput(data.text)) {
        reportSubmit('garbage')
        setToastMsg(GARBAGE_TOAST_MSG)
        setTranscribing(false)
        return
      }
      // 源头门槛（薄素材防线）：真实但有效字数不足 → 拦下、原文保留续写，引导补充维度（区别于上面的「不像经历」）
      if (isTooShortForCorpus(data.text)) {
        reportSubmit('text_too_short')
        setToastMsg(TOO_SHORT_TOAST_MSG)
        setTranscribing(false)
        return
      }
      // 第二层：让 restructure 判断 usable；usable 时把整理结果一并带走，restructure 页免二次整理调用
      try {
        t1 = performance.now()
        const checkRes = await apiFetch('/api/restructure', {
          method: 'POST',
          json: { rawText: data.text },
          signal: ac.signal,
        })
        // 匿名整理额度用尽：不跳转，弹试用结束提示
        if (checkRes.status === 402) {
          track('flow.ai_call', { stage: 'restructure', mode: 'voice', result: 'quota_402', httpStatus: 402, latencyMs: since(t1) })
          reportSubmit('quota_blocked')
          if (!ac.signal.aborted) { setQuotaReached(true); setTranscribing(false) }
          return
        }
        if (checkRes.ok) {
          const checkData = (await checkRes.json()) as { cleanedText: string; usable: boolean; summary?: string }
          track('flow.ai_call', { stage: 'restructure', mode: 'voice', result: 'ok', httpStatus: 200, latencyMs: since(t1) })
          if (!checkData.usable) {
            reportSubmit('garbage')
            setToastMsg(GARBAGE_TOAST_MSG)
            setTranscribing(false)
            return
          }
          if (ac.signal.aborted) return          // 已跳页则不再导航
          reportSubmit('proceed')
          router.push(`/restructure?h=${putHandoffJson({ rawText: data.text, cleanedText: checkData.cleanedText, summary: checkData.summary ?? '' })}${qid ? `&qid=${qid}` : ''}`)
          return
        }
        // 其他非 402 错误：落到 try 外的放行分支，restructure 页兜底自行整理
      } catch {
        /* API 错误（含中断）放行，restructure 页面兜底 */
        // 只记这次 AI 调用的结局，【不报 capture_submitted】——用户确实被放行了，
        // 下面的 router.push 之前会报 proceed；这里再报一条就是同一次提交记两遍。
        track('flow.ai_call', { stage: 'restructure', mode: 'voice', result: 'network', httpStatus: 0, latencyMs: since(t1) })
      }
      if (ac.signal.aborted) return          // 已跳页则不再导航
      reportSubmit('proceed')
      router.push(`/restructure?h=${putHandoff(data.text)}${qid ? `&qid=${qid}` : ''}`)
    } catch (e) {
      if (ac.signal.aborted) {
        reportTranscribe('aborted', 0)
        reportSubmit('aborted')
        return          // 中断不算错误，忽略
      }
      reportTranscribe('network', 0)
      reportSubmit('ai_failed')
      setError(e instanceof Error ? e.message : '转写失败，请重试')
      setTranscribing(false)
    }
  }, [stop, router, qid, checkStoryQuota])

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
    onSwitchToText: () => navigate(qid ? `/write?qid=${qid}` : '/write'),
    onExit: () => navigate('/'),
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
      {/* 建新故事额度已满：点「完成」时才弹，关闭即回首页（录音已停，无法继续本条）。
          匿名试用用尽 → trial（引导注册）；注册用户月额度用尽 → story。 */}
      {storyQuotaVariant && (
        <QuotaReached variant={storyQuotaVariant} asOverlay onClose={() => router.push('/')} />
      )}
    </>
  )
}

export default function RecordingPage(): JSX.Element {
  return <Suspense><RecordingContent /></Suspense>
}
