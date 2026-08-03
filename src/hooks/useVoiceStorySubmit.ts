/**
 * @module   useVoiceStorySubmit
 * @desc     故事「语音提交」共享 hook —— 与文字路径的 useStorySubmit 对称的另一半。
 *           封装从点「完成」到跳 /restructure 的整条流程：录音时长门槛 → 建新故事额度守卫 →
 *           停录取 blob（空 / 超 10MB 拦下）→ /api/transcribe → 转写文本两层预检（garbage /
 *           有效字数不足）→ /api/restructure 判 usable（判定逻辑与文字路径共用 lib/restructure-gate）→
 *           跳 /restructure。中途卸载由 AbortController 中断，转写/整理的 402 改弹试用结束覆盖层。
 *
 *   【为什么从 recording/page.tsx 里抽出来】原 handleFinish 175 行、9 个早退/throw 点、
 *   两段 AI 调用、埋点密集 —— 问题不是文件长度（全仓没有文件破 1000 行线），是单函数复杂度：
 *   这条流程里有好几条**坏了不会报错、只会让数据悄悄错**的不变式（见下方 runVoiceStorySubmit 注释），
 *   混在页面的状态/视图代码里没法单测，只能靠人读。抽出来之后流程本体不依赖 React，可以逐场景对拍。
 *
 *   【与 useStorySubmit 的分工】两者对同一个 /api/restructure 的分支判定已收敛到 lib/restructure-gate，
 *   不再各写一份；剩下的差异是语音独有的前置管线（时长门槛 / blob 取用与大小校验 / ASR / 中断），
 *   以及埋点上各带各的 mode（voice / text）。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isGarbageInput, isTooShortForCorpus, GARBAGE_TOAST_MSG, TOO_SHORT_TOAST_MSG } from '@/lib/utils'
import { putHandoff, putHandoffJson } from '@/lib/handoff'
import { newFlowId } from '@/lib/flow-id'
import { apiFetch } from '@/lib/api-client'
import { evaluateRestructureResponse } from '@/lib/restructure-gate'
import { track } from '@/lib/client-events'
import type { RecordingResult } from '@/hooks/useAudioRecorder'
// 提交结局 / AI 调用结局的取值域【一律来自 event-schema 这一份真源】，本文件不再手抄：
// 服务端 sanitize 遇到不认识的值是【静默丢弃】，打错一个字母就是「埋了但库里查不到」，本地永远测不出来。
import type { CaptureOutcome, AiResult } from '@/lib/event-schema'

/**
 * 语音提交流程的外部依赖 —— 全部由调用方注入，流程本体因此不依赖 React，可脱离渲染逐场景对拍。
 * 注入而非在流程里直接取，是因为这些东西各有各的所有者：录音器归 useAudioRecorder、
 * 额度守卫归 useStoryQuotaGuard、放弃埋点归 useCaptureAbandon，本流程只是按顺序驱动它们。
 */
export interface VoiceStorySubmitDeps {
  /** 雅思模式携带的题目 id（无则 null，跳转不带 &qid） */
  qid: string | null
  /** 停止录音并取回音频 + 采集信号（useAudioRecorder.stop）；无录音返回 null */
  stop: () => Promise<RecordingResult | null>
  /** 读【提交那一刻】的录音秒数（页面用 ref 存，避免读到旧渲染闭包里的值） */
  getSeconds: () => number
  /** 建新故事额度守卫（useStoryQuotaGuard.checkBlocked）：true = 已超额，须中止 */
  checkQuota: () => Promise<boolean>
  /** 标记已离开采集态（useCaptureAbandon.markSubmitted），卸载时不再算「放弃」 */
  markSubmitted: () => void
  /**
   * 开启本次请求的中断控制器并登记到页面 ref，返回其 signal。
   * 【必须在这一步才调用】早退分支（时长不足 / 额度拦截）压根不发请求，提前换掉 ref
   * 会让卸载时 abort 的是一个空壳、而真正在飞的上一次请求反而中断不掉。
   */
  beginAbort: () => AbortSignal
  /** 跳转（router.push） */
  push: (href: string) => void
  setError: (msg: string | null) => void
  setTranscribing: (v: boolean) => void
  setToastMsg: (msg: string | null) => void
  setQuotaReached: (v: boolean) => void
}

/** 录音 blob 上限（ENGINEERING §9）：超过即拦下提示分段录制，不上传 */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

/** 低于此秒数不上传，提示继续说（保持录音中）——避免为几秒的空话付一次 ASR */
const MIN_RECORD_SECONDS = 5

/**
 * 把 /api/transcribe 的失败响应映射成 ai_call 的结局枚举。
 * 429/400/401 单列：压成 other 会让「日限撞了多少次」永远查不出来，且同一 stage 的另两条路径
 * （restructure 页 / 文字路径）已细分，不统一就是「只有那条路有 429」的假象。
 * 「内容为空」统一按 **HTTP 422** 兜底判定、不罗列豆包码：什么算「内容无法处理」由服务端唯一定夺
 * （api/transcribe 已把 EMPTY_TRANSCRIPT 与豆包静音码 20000003 都归 422），客户端再抄一份码表
 * 就会分叉——豆包静音曾因此处只认 EMPTY_TRANSCRIPT 而落进 other 桶（practice 页埋点早已是 422 兜底写法）。
 * @param  status  HTTP 状态码
 * @param  code    响应体里的业务错误码（ASR_BUSY / EMPTY_TRANSCRIPT）
 * @returns        ai_call 的 result 取值
 */
function classifyTranscribeFailure(status: number, code: string | undefined): AiResult {
  if (code === 'ASR_BUSY') return 'busy_503'
  if (code === 'EMPTY_TRANSCRIPT' || status === 422) return 'empty_422'
  if (status === 429) return 'rate_429'
  if (status === 400) return 'bad_input_400'
  if (status === 401) return 'auth_401'
  return status >= 500 ? 'server_5xx' : 'other'
}

/**
 * 转写失败给用户看的话。
 * ASR_BUSY（503，转写并发排队满/超时）必须和「转写失败」分开说：前者是"人多"、几秒后重试就好，
 * 后者是"坏了"。文案混用会让用户以为产品故障而直接放弃。
 * 「没太听清」分支与上方 classifyTranscribeFailure 同款按 HTTP 422 兜底（服务端是「内容为空」的唯一真源，
 * 不罗列豆包码）：静音等 422 失败都该拿到「再说一次」的引导，而不是「转写失败」的故障文案。
 * @param  code    响应体里的业务错误码
 * @param  status  HTTP 状态码
 * @returns        用户可见文案
 */
function transcribeErrorMessage(code: string | undefined, status: number): string {
  if (code === 'ASR_BUSY') return '现在使用的人有点多，稍等几秒再说一次就好'
  if (code === 'EMPTY_TRANSCRIPT' || status === 422) return '好像没太听清，要不要再说一次？'
  return '转写失败，请重试'
}

/**
 * 语音提交流程本体（不依赖 React，供 hook 调用、也供等价性/回归测试直接驱动）。
 *
 * 🔴【四条坏了不会报错、只会让数据悄悄错的不变式，改这段前先读完】
 *   1. **每条执行路径恰好一条 capture_submitted**。no_audio / too_large 是 throw 出去的，
 *      会被最外层 catch 再兜一次（那里报 ai_failed）—— 靠 reportSubmit 自去重挡住，先到者为准。
 *   2. **每次转写调用恰好一条 ai_call**，且【只在请求真发出过（t0 已置位）之后】才报。
 *      两个条件缺一不可：不挡重复，!res.ok 抛出的错会被 catch 再记一遍同一次调用；
 *      不挡 t0，「没有录到声音 / 录音过长」也落进同一个 catch，可那时压根没发过转写请求，
 *      记成 network 就是凭空造故障。
 *   3. **newFlowId() 必须在最开头**。否则早退分支（too_short / quota_blocked）发出的事件，
 *      会挂在 sessionStorage 里残留的【上一次流程】的 flow_id 上，两次流程被串成一条。
 *      早退也换新 id 无副作用。
 *   4. **「失败但放行」不是失败**。整理的非 402 失败与网络失败都是放行跳转：
 *      ai_call 记失败码、capture_submitted 记 proceed，两者不矛盾。
 *
 * @param  deps  外部依赖，见 VoiceStorySubmitDeps
 * @returns      无（结局通过注入的 setter / push 反映到 UI）
 * @sideEffect   停止录音、发 /api/transcribe 与 /api/restructure、写 handoff、跳转、发埋点
 */
export async function runVoiceStorySubmit(deps: VoiceStorySubmitDeps): Promise<void> {
  const {
    qid, stop, getSeconds, checkQuota, markSubmitted, beginAbort, push,
    setError, setTranscribing, setToastMsg, setQuotaReached,
  } = deps
  setError(null)
  // 语音路径的流程起点：开启一次新 flow_id，串起 ASR→整理→建语料（经 X-Flow-Id 头透传，不进 URL）。
  // 【必须在所有早退分支之前换】理由见上方不变式 3。
  newFlowId()

  // ——— 本次提交的埋点脚手架（全部 fire-and-forget，不参与任何分支判断、不改任何时序）———
  // 两段 AI 调用各自的起始时刻。声明在 try 外是因为 catch 也要读；null = 请求还没发出过 → 不带 latencyMs。
  let t0: number | null = null
  let t1: number | null = null
  /** 距起始时刻的耗时(ms)；起始为 null（请求尚未发出）返回 undefined，track 会丢掉该字段 */
  const since = (t: number | null): number | undefined => (t === null ? undefined : performance.now() - t)
  let submitReported = false
  /** 本次提交的结局：每条执行路径【恰好】报一条（不变式 1），重复报会让「提交结局分布」重复计数 */
  const reportSubmit = (outcome: CaptureOutcome): void => {
    if (submitReported) return
    submitReported = true
    if (outcome === 'proceed') markSubmitted()   // 已成功提交 → 卸载时不再算「放弃」
    track('flow.capture_submitted', { mode: 'voice', outcome, durationSec: Math.round(getSeconds()) })
  }
  let transcribeReported = false
  /** 转写这一次调用的结局：只报一条，且只在请求真发出过之后才报（不变式 2，两个条件缺一不可） */
  const reportTranscribe = (result: AiResult, httpStatus: number): void => {
    if (transcribeReported || t0 === null) return
    transcribeReported = true
    track('flow.ai_call', { stage: 'transcribe', result, httpStatus, latencyMs: since(t0) })
  }
  /**
   * 整理这一次调用的结局。语音路径此前是三处裸 track（结构上互斥、至多一条），收敛成一个 helper 后语义不变。
   * 【口径对齐】文字路径（useStorySubmit）在同一批分支上都记了 ai_call —— 语音这边若漏记，
   * 同一个接口就成了「文字路径失败有痕、语音路径失败无痕」，两条路径的失败率没法横向比。
   */
  const reportRestructure = (result: AiResult, httpStatus: number): void => {
    track('flow.ai_call', { stage: 'restructure', mode: 'voice', result, httpStatus, latencyMs: since(t1) })
  }

  // 第一层：录音过短，提示继续说而非上传（保持录音中）
  if (getSeconds() < MIN_RECORD_SECONDS) {
    reportSubmit('too_short')
    setError('还想再说点什么吗？目前语料可能有点短哦')
    return
  }
  // 第二层：建新故事额度守卫 —— 超额就别再调 ASR（花了钱也只会在保存时被 402 拦）。停掉录音、弹提示。
  if (await checkQuota()) {
    reportSubmit('quota_blocked')
    await stop()
    return
  }
  setTranscribing(true)
  const signal = beginAbort()
  const qidParam = qid ? `&qid=${qid}` : ''
  try {
    const rec = await stop()
    if (!rec) { reportSubmit('no_audio'); throw new Error('没有录到声音，请重试') }
    const blob = rec.blob
    if (blob.size > MAX_AUDIO_BYTES) { reportSubmit('too_large'); throw new Error('录音过长，请分段录制') }
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
    const res = await apiFetch('/api/transcribe', { method: 'POST', body: form, signal })
    // 服务端同意闸拒绝（未捕获同意）：这两个 AI 路由的 403 只可能是缺同意。回首页触发同意弹窗，
    // 别卡在「转写失败」裸报错死胡同。
    if (res.status === 403) {
      reportTranscribe('consent_403', 403)
      reportSubmit('consent_blocked')
      if (!signal.aborted) push('/')
      return
    }
    // 匿名 ASR 试用额度用尽：402 必须走 trial 覆盖层引导注册，不能落进下面的通用 !res.ok 错误态
    // （只显示「转写失败，请重试」= 让撞上限的匿名用户以为是故障，反复重试仍失败 → 转化流失）。
    // 与建新故事额度守卫的区别：此处 402 是匿名【ASR 当日】试用用尽（服务端兜底）；
    // 守卫是点「完成」前的前置检查（匿名语料总条数 / 注册用户月额度）。来源不同，不可混用。
    if (res.status === 402) {
      reportTranscribe('quota_402', 402)
      reportSubmit('quota_blocked')
      if (!signal.aborted) { setQuotaReached(true); setTranscribing(false) }
      return
    }
    if (!res.ok) {
      const errData = (await res.json()) as { error?: string; code?: string }
      reportTranscribe(classifyTranscribeFailure(res.status, errData.code), res.status)
      throw new Error(transcribeErrorMessage(errData.code, res.status))
    }
    const data = (await res.json()) as { text: string }
    reportTranscribe('ok', 200)
    if (signal.aborted) { reportSubmit('aborted'); return }
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
        signal,
      })
      // 分支判定与文字路径共用 lib/restructure-gate（见该文件顶注：同一个接口的同一组分支，
      // 分成两份写过一次、已经付过学费）。ai_call 在每一条分支上都排在 capture_submitted 之前，
      // 故统一提到判定之后发一次。
      const gate = await evaluateRestructureResponse(checkRes)
      // ⚠️【已知的路径分叉，本次抽取刻意逐字保留、不顺手改】
      // 文字路径把 /api/restructure 的 403 当同意闸：ai_call 记 consent_403 + 回首页触发同意弹窗。
      // 语音路径的历史实现【没有】这一分支：403 落进通用「失败但放行」，ai_call 记 other/403，
      // 用户被带去 /restructure 页、由那边再撞一次同意闸。
      // 改掉它 = 改行为（埋点口径与跳转目的地都会变），不属于「等价搬运」的范围，已上报待裁决。
      reportRestructure(gate.action === 'consent' ? 'other' : gate.ai, gate.httpStatus)
      switch (gate.action) {
        // 匿名整理额度用尽：不跳转，弹试用结束提示
        case 'quota':
          reportSubmit('quota_blocked')
          if (!signal.aborted) { setQuotaReached(true); setTranscribing(false) }
          return
        case 'garbage':
          reportSubmit('garbage')
          setToastMsg(GARBAGE_TOAST_MSG)
          setTranscribing(false)
          return
        case 'consent':
          break   // 见上方分叉说明：走下面的「失败但放行」
        case 'proceed':
          if (gate.payload) {
            // 中断也是一种提交结局：不报的话，「整理阶段被中断」的人在提交结局分布里凭空消失，
            // 而那正是耗时最长、最容易被用户中途退掉的一段（转写阶段的中断在最外层 catch 里报了
            // aborted，同一个「中断」两段口径不一致，横向比不了）。reportSubmit 自带去重，不会重复。
            if (signal.aborted) { reportSubmit('aborted'); return }          // 已跳页则不再导航
            reportSubmit('proceed')
            push(`/restructure?h=${putHandoffJson({ rawText: data.text, cleanedText: gate.payload.cleanedText, summary: gate.payload.summary ?? '' })}${qidParam}`)
            return
          }
          break   // 整理失败但放行：落到下面，restructure 页兜底自行整理
      }
    } catch {
      /* API 错误（含中断）放行，restructure 页面兜底 */
      // 只记这次 AI 调用的结局，【不报 capture_submitted】——用户确实被放行了，
      // 下面的 push 之前会报 proceed；这里再报一条就是同一次提交记两遍。
      reportRestructure('network', 0)
    }
    if (signal.aborted) { reportSubmit('aborted'); return }          // 已跳页则不再导航（同上：中断也要报）
    reportSubmit('proceed')
    push(`/restructure?h=${putHandoff(data.text)}${qidParam}`)
  } catch (e) {
    if (signal.aborted) {
      reportTranscribe('aborted', 0)
      reportSubmit('aborted')
      return          // 中断不算错误，忽略
    }
    reportTranscribe('network', 0)
    reportSubmit('ai_failed')
    setError(e instanceof Error ? e.message : '转写失败，请重试')
    setTranscribing(false)
  }
}

interface UseVoiceStorySubmitArgs {
  /** 雅思模式携带的题目 id（无则 null） */
  qid: string | null
  /** 停止录音并取回音频（useAudioRecorder.stop） */
  stop: () => Promise<RecordingResult | null>
  /** 读【提交那一刻】的录音秒数（页面用 ref 存住，回调本身须引用稳定或用 ref 读法） */
  getSeconds: () => number
  /** 建新故事额度守卫（useStoryQuotaGuard.checkBlocked） */
  checkQuota: () => Promise<boolean>
  /** 标记已离开采集态（useCaptureAbandon.markSubmitted） */
  markSubmitted: () => void
}

interface UseVoiceStorySubmitReturn {
  /** 转写/整理进行中（页面据此切「聆听中」→「整理中」并暂停计时） */
  transcribing: boolean
  /** 页面内联错误（录音过短 / 转写失败），非阻断式 */
  error: string | null
  /** 打回重写的 toast（不像经历 / 有效字数不足） */
  toastMsg: string | null
  /** 匿名整理或 ASR 额度用尽 → true，调用方据此弹 QuotaReached trial 覆盖层 */
  quotaReached: boolean
  /** 触发提交（语义与原 recording/page 的 handleFinish 一致） */
  submit: () => void
  dismissToast: () => void
  /** 清空内联错误（重录时用） */
  clearError: () => void
}

/**
 * 故事语音提交 hook。
 * @param  args  { qid, stop, getSeconds, checkQuota, markSubmitted }
 * @returns      { transcribing, error, toastMsg, quotaReached, submit, dismissToast, clearError }
 * @sideEffect   卸载时 abort 未完成的转写/整理请求（防护卸载后 setState）
 */
export function useVoiceStorySubmit(args: UseVoiceStorySubmitArgs): UseVoiceStorySubmitReturn {
  const router = useRouter()
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [quotaReached, setQuotaReached] = useState(false)

  // 入参存 ref、不进 submit 的依赖：调用方多半传内联箭头函数，进依赖会让 submit 每次渲染都换新引用
  const argsRef = useRef(args)
  argsRef.current = args

  // 卸载（用户跳页）时中断未完成的转写/整理请求，防护卸载后 setState
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const submit = useCallback((): void => {
    const a = argsRef.current
    void runVoiceStorySubmit({
      qid: a.qid,
      stop: a.stop,
      getSeconds: a.getSeconds,
      checkQuota: a.checkQuota,
      markSubmitted: a.markSubmitted,
      beginAbort: () => {
        const ac = new AbortController()
        abortRef.current = ac
        return ac.signal
      },
      push: (href) => router.push(href),
      setError,
      setTranscribing,
      setToastMsg,
      setQuotaReached,
    })
  }, [router])

  const dismissToast = useCallback((): void => setToastMsg(null), [])
  const clearError = useCallback((): void => setError(null), [])

  return { transcribing, error, toastMsg, quotaReached, submit, dismissToast, clearError }
}
