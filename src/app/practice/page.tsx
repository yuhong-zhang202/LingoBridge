/**
 * @module   PracticePage
 * @desc     练习对话页外壳 —— 集中持有全部对话逻辑（单实例 useAudioRecorder、phase 状态机、转写/回复/
 *           优化/发音捕捉、计时与到上限自动停、满 8 轮收尾、4 个 DOM ref 与其 effect），只把「渲染」抽成两套视图。
 *
 *   【单挂载，区别于其他流程页的 CSS 双挂载】本页带一个全局 document「点弹窗外关闭」监听 + 多个 DOM ref
 *   + 单实例录音器；若像 recording/analysis 那样把两套视图用 `lg:hidden` / `hidden lg:block` 同时挂载，
 *   被 CSS 藏起来那套的全局监听与 ref 仍会运行、误关桌面弹窗，且绕开它就得改移动端监听（违反移动端零改动）。
 *   故本页改用视口判断（useIsDesktop，SSR 安全：首屏默认移动端，挂载后按 ≥1024px 切桌面），
 *   同一时刻只渲染 PracticeMobile 或（FlowShellDesktop + PracticeDesktop）之一 —— ref 只绑一次，外壳 effect 照常工作。
 *
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { type JSX, useState, useRef, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useNav } from '@/components/NavProgress'
import { setSessionPolishes, hasSeenPracticeIntro, markPracticeIntroSeen } from '@/lib/storage'
import { addSavedPronunciation } from '@/lib/db/saved-pronunciations'
import { useSavedPronunciations, refreshSavedPronunciations } from '@/hooks/library-data'
import { applyPronunciationFixes } from '@/lib/pronunciation'
import { startPracticeSessionRecord } from '@/lib/practice-session-record'
import { apiFetch, readQuotaReason } from '@/lib/api-client'
import type { PracticeScaffold, PracticeMessage, PolishResult, SessionPolish } from '@/lib/types'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import PracticeMobile from './PracticeMobile'
import PracticeDesktop from './PracticeDesktop'
import PracticeIntroDialog from './_components/PracticeIntroDialog'
import type { PracticePhase, PracticeViewProps } from './types'

/** 用户发言达此轮数后温柔收尾，不再允许新录音 */
const PRACTICE_TURN_LIMIT = 8

// ——— 转写 503（ASR 并发闸「人多」）自动重试参数 ———
// 与 api/transcribe 的 Retry-After:5 对齐；每次实际延迟 = max(Retry-After 头, 退避基数_n)。
// 上限双闸：最多重试 ASR_RETRY_MAX 次，或累计等待超 ASR_RETRY_TOTAL_CAP_MS 即转失败态（避免无休止等）。
/** 自动重试最多次数（不含首发） */
const ASR_RETRY_MAX = 3
/** 自动重试累计等待上限（含各次退避），超过即进 transcribeFailed */
const ASR_RETRY_TOTAL_CAP_MS = 35_000
/** 各次重试退避基数（秒），按已重试次数取；超出取末位 */
const ASR_RETRY_BASE_S = [5, 7, 10] as const

/** 视口断点：SSR/首屏默认移动端（避免 hydration 抖动），挂载后按 ≥1024px 切桌面，随窗口变化更新。 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const update = (): void => setIsDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return isDesktop
}

function PracticeContent(): JSX.Element {
  const router = useRouter()
  const { navigate } = useNav()
  const params = useSearchParams()
  const questionId = params.get('questionId') ?? ''
  const storyId = params.get('storyId') ?? ''
  const level = params.get('level') ?? '6.0'
  const isReview = params.get('review') === '1'
  // ⚠️ 测试钩子：模拟转写异常，供真机验"失败备选方案"（你这边转写不失败、无法自然触发）。
  //    ?simTranscribe=fail → 强制走「失败双选(重试转写/文字输入)」；=busy → 强制走「排队自动重试(顶部进度条)」。
  //    需显式带 URL 参数，普通用户不受影响；正式清理时可整段删除。
  const simTranscribe = params.get('simTranscribe')
  // ⚠️ 测试钩子：?simReplyFail=1 → 强制让「教练回复」失败，走「回复失败(再试一次)」态，供真机验重试文案 +
  //    「重试不追加第二条用户气泡」（正常网络下回复几乎不失败、无法自然触发）。恒失败：连点再试也一直失败，
  //    可验 attempt≥2 的措辞切换。需显式带参，普通用户不受影响；正式清理时可整段删除。
  const simReplyFail = params.get('simReplyFail') === '1'
  // ⚠️ 测试钩子：?previewIntro=1 → 强制弹「功能引导卡」（绕过 localStorage 已读标记，供真机验文案，
  //    不写标记、关掉可反复调）。需显式带参，普通用户不受影响；正式清理时可整段删除。
  const previewIntro = params.get('previewIntro') === '1'

  const [scaffold, setScaffold]           = useState<PracticeScaffold | null>(null)
  const [messages, setMessages]           = useState<PracticeMessage[]>([])
  const [phase, setPhase]                 = useState<PracticePhase>('init')
  const [elapsed, setElapsed]             = useState(0)
  const [error, setError]                 = useState<string | null>(null)
  const [showPolish, setShowPolish]       = useState(false)
  const [polishLoading, setPolishLoading] = useState(false)
  const [polishResult, setPolishResult]   = useState<PolishResult | null>(null)
  const [polishHistory, setPolishHistory] = useState<SessionPolish[]>([])
  const [capture, setCapture]             = useState<{ heard: string; context: string; msgIndex: number; savedIds: string[] } | null>(null)
  const [retryKey, setRetryKey]           = useState(0)
  // 服务端复练额度超限（/api/practice 或 /api/transcribe 返回 402）→ 弹 QuotaReached 覆盖层。
  // 变体由 402 的 reason 决定（ielts=注册复练月额度用完 / trial=匿名试用轮次或 ASR 用尽），不再靠异步
  // isAnon 竞态推导——竞态会让匿名用户误显示注册的「本月额度已用完」谎报。null=不弹。
  // /api/transcribe 402 是匿名 only、不带 reason → readQuotaReason 返回 null → 默认 'trial'，语义正确。
  const [quotaVariant, setQuotaVariant] = useState<'trial' | 'ielts' | null>(null)
  // 教练回复失败次数：每进一次 replyFailed +1（用当前 messages 重发、末条已是用户气泡，绝不追加第二条）；
  // 开启新一轮（sendReply 追加新用户发言）或回复成功回 idle 时归 0。≥2 时失败卡换更强的「网络不稳」措辞。
  const [replyFailAttempt, setReplyFailAttempt] = useState(0)

  // 功能引导：首次进入、教练开场白就绪（phase='idle'）时弹一次。绑 idle 而非「一进页面」——
  // 那时还没用户气泡（两功能作用于用户气泡），且天然避开额度(402)/同意(403)拦截层（那两种 phase 到不了 idle）。
  const [showIntro, setShowIntro] = useState(false)
  const introCheckedRef = useRef(false)
  const closeIntro = useCallback(() => {
    setShowIntro(false)
    markPracticeIntroSeen()   // 关闭即写标记，之后不再自动弹
  }, [])

  const popupRef  = useRef<HTMLDivElement>(null)
  const orbRef    = useRef<HTMLButtonElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pronounceRef = useRef<HTMLDivElement>(null)
  const { start, stop, audioLevel } = useAudioRecorder()

  // ——— 转写重试/文字输入所需的留存态（都用 ref：跨 setTimeout 重试链读最新，不进 useCallback 依赖）———
  // 录音 blob 留存：转写失败/文字取消后要用同一段重发。⚠️ Request body 被消费过不能复用，
  // 每次发请求都现构 FormData（见 runTranscribeAttempt）；此处只留 Blob 本体。
  const pendingBlobRef = useRef<Blob | null>(null)
  const retryAttemptRef = useRef(0)          // 已重试次数（不含首发）
  const retryStartRef = useRef(0)            // 首发时间戳，用于累计等待上限判定
  const retryTimerRef = useRef<number | null>(null)  // 待触发的重试 setTimeout id
  // 消息/脚手架的最新值给异步重试链读（避免 setTimeout 捕获旧闭包导致丢消息）
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const scaffoldRef = useRef(scaffold)
  scaffoldRef.current = scaffold
  // 打破 scheduleRetry ↔ runTranscribeAttempt 的相互引用：scheduleRetry 经此 ref 调最新的重试函数
  const runTranscribeAttemptRef = useRef<() => void>(() => {})

  /** 清掉待触发的重试计时器（卸载 / 结束 / 取消录音 / 提交文字时都要清，防泄漏与错发） */
  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])
  // 卸载兜底：组件销毁时清掉悬空的重试计时器
  useEffect(() => () => clearRetryTimer(), [clearRetryTimer])

  // 发音收藏（云端，读收藏入口顺带触发迁移）；用 ref 供同步回调即时读最新，免把 pronunciations 塞进 useCallback 依赖
  const { pronunciations } = useSavedPronunciations()
  const pronunciationsRef = useRef(pronunciations)
  pronunciationsRef.current = pronunciations

  // 自动滚到底
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, phase])

  // 弹出发音纠错卡时滚动到可视区，避免被底部输入区遮挡
  useEffect(() => {
    if (!capture) return
    requestAnimationFrame(() => {
      pronounceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
  }, [capture])

  // 进页面：构建脚手架 + 拿开场白
  useEffect(() => {
    if (!questionId) { setPhase('error'); setError('缺少题目'); return }
    let cancelled = false
    const ac = new AbortController()
    ;(async () => {
      try {
        const res = await apiFetch('/api/practice', {
          method: 'POST',
          json: { questionId, storyId, messages: [], level, isReview },
          signal: ac.signal,
        })
        // 服务端复练额度拦截（402）：弹 QuotaReached 覆盖层而非普通错误态。reason 决定变体（ielts/trial）。
        if (res.status === 402) {
          const reason = await readQuotaReason(res)
          if (!cancelled) setQuotaVariant(reason === 'ielts' ? 'ielts' : 'trial')
          return
        }
        // 服务端同意闸拒绝（403，未捕获同意）：深链直达本页时兜底，回首页触发同意弹窗，不停在初始化失败态。
        if (res.status === 403) { if (!cancelled) router.push('/'); return }
        if (!res.ok) throw new Error('对话初始化失败')
        const data = (await res.json()) as { scaffold: PracticeScaffold; reply: string }
        if (!cancelled) {
          setScaffold(data.scaffold)
          setMessages([{ role: 'assistant', content: data.reply }])
          setPhase('idle')
        }
      } catch (e) {
        if (ac.signal.aborted) return          // 中断不算错误，忽略
        if (!cancelled) { setPhase('error'); setError(e instanceof Error ? e.message : '对话初始化失败') }
      }
    })()
    return () => { cancelled = true; ac.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初次加载用默认 level 初始化对话；切换水平走独立分支，列入依赖会重复初始化
  }, [questionId, storyId, retryKey, isReview])

  // ——— 一轮拆成四段：handleUserTurn（停录/存 blob/起首发）→ runTranscribeAttempt（发转写、按响应码分流）
  //     → scheduleRetry（503 排队重试）→ sendReply（拿到文本后追加用户气泡 + 取教练回复）———
  //     文字输入与转写成功共用 sendReply 这同一条下游。

  /** 用给定 messages（末条须为用户气泡）POST /api/practice 取教练回复：成功追加教练回复回 idle；
   *  403/402 照旧先行 return 不进失败态；其余错误 → replyFailed（用当前 messages 可再重发，不追加用户气泡）。
   *  首发（sendReply）与「再试一次」（onRetryReply）共用此下游；catch 不再 setError（避免脏字符串残留）。 */
  const requestReply = useCallback(async (msgs: PracticeMessage[]) => {
    // ⚠️ 测试钩子：跳过真实请求，直接演示回复失败态（?simReplyFail=1，恒失败，可验 attempt≥2 措辞）
    if (simReplyFail) { setReplyFailAttempt(n => n + 1); setPhase('replyFailed'); return }
    try {
      const res = await apiFetch('/api/practice', {
        method: 'POST',
        json: { scaffold: scaffoldRef.current, messages: msgs },
      })
      // 服务端同意闸拒绝（403）：回首页触发同意弹窗，不停在对话失败态。
      if (res.status === 403) { router.push('/'); return }
      // 额度用尽（402，聊到第 N 轮才撞上限）：走配额提示而非「对话失败」。发言已上屏，关闭覆盖层后不丢。
      if (res.status === 402) {
        const reason = await readQuotaReason(res)
        setQuotaVariant(reason === 'ielts' ? 'ielts' : 'trial'); setPhase('idle'); return
      }
      if (!res.ok) throw new Error('对话失败')
      const data = (await res.json()) as { reply: string }
      setMessages([...msgs, { role: 'assistant', content: data.reply }])
      setReplyFailAttempt(0)
      setPhase('idle')
    } catch {
      // 网络/服务错误：不 setError（脏字符串会残留在 idle 提示区），改进 replyFailed 给「再试一次」
      setReplyFailAttempt(n => n + 1)
      setPhase('replyFailed')
    }
  }, [router, simReplyFail])

  /** 拿到用户这轮文本后：追加用户气泡 → 走 requestReply 取教练回复。转写成功与文字输入共用。 */
  const sendReply = useCallback((text: string) => {
    const next: PracticeMessage[] = [...messagesRef.current, { role: 'user', content: text }]
    setMessages(next)
    setReplyFailAttempt(0)   // 新一轮用户发言：清掉上一轮的失败计数
    setPhase('replying')
    void requestReply(next)
  }, [requestReply])

  /** 回复失败态「再试一次」：用当前 messages（末条已是用户气泡）重发，成功只追加教练回复，绝不追加第二条用户气泡。 */
  const onRetryReply = useCallback(() => {
    setError(null)
    setPhase('replying')
    void requestReply(messagesRef.current)
  }, [requestReply])

  /** 503（人多）后安排下一次重试：到重试上限/累计等待上限则进失败态；否则 queued + 定时重发。 */
  const scheduleRetry = useCallback((retryAfterSec: number) => {
    const attempt = retryAttemptRef.current
    const waited = Date.now() - retryStartRef.current
    if (attempt >= ASR_RETRY_MAX || waited >= ASR_RETRY_TOTAL_CAP_MS) {
      // blob 不清：失败态还要靠它「重试转写」
      setPhase('transcribeFailed')
      return
    }
    const base = ASR_RETRY_BASE_S[Math.min(attempt, ASR_RETRY_BASE_S.length - 1)]
    const delayMs = Math.max(retryAfterSec, base) * 1000
    retryAttemptRef.current = attempt + 1
    setPhase('queued')
    retryTimerRef.current = window.setTimeout(() => { runTranscribeAttemptRef.current() }, delayMs)
  }, [])

  /** 发一次 /api/transcribe，按响应码分流（见方案分流表）。blob 从 pendingBlobRef 现构 FormData。 */
  const runTranscribeAttempt = useCallback(async () => {
    const blob = pendingBlobRef.current
    if (!blob) { setPhase('idle'); return }   // 兜底：无 blob 不该走到这
    // ⚠️ 测试钩子：跳过真实请求，直接演示失败双选 / 排队重试（?simTranscribe=fail|busy）
    if (simTranscribe === 'fail') { setPhase('transcribeFailed'); return }
    if (simTranscribe === 'busy') { scheduleRetry(0); return }
    try {
      // 每次现构 FormData：body 被消费过不可复用（重试/文字取消后重发都要新构一份）
      const form = new FormData()
      form.append('audio', blob, 'turn.webm')
      // scene='practice'：练习转写（对话轮次）。仅供服务端打 phase 埋点区分看板归位，不影响转写行为。
      form.append('scene', 'practice')
      // multipart：传 body（非 json），apiFetch 不设 Content-Type，交浏览器自动带 boundary
      const tr = await apiFetch('/api/transcribe', { method: 'POST', body: form })
      // 服务端同意闸拒绝（403）：回首页触发同意弹窗。
      if (tr.status === 403) { router.push('/'); return }
      // 额度用尽（402，匿名撞 ASR 试用上限）：走配额提示。清 blob（这段不再重试）。
      // ASR 402 是匿名 only（注册走 429）→ 恒 trial（引导注册）。
      if (tr.status === 402) { pendingBlobRef.current = null; setQuotaVariant('trial'); setPhase('idle'); return }
      // ASR_BUSY（503，并发闸「人多」）：不是坏了，几秒后自动重试就能成 → 按 Retry-After 头排队重试。
      if (tr.status === 503) {
        const retryAfter = Number(tr.headers.get('Retry-After')) || 0
        scheduleRetry(retryAfter)
        return
      }
      if (!tr.ok) {
        const errData = (await tr.json().catch(() => ({}))) as { code?: string }
        // 空录音（422 EMPTY_TRANSCRIPT）：唯一保留「再说一遍」的分支——录到了音但没人声，是输入问题。清 blob。
        if (errData.code === 'EMPTY_TRANSCRIPT') {
          pendingBlobRef.current = null
          setError('没听清，要不要再说一遍？')
          setPhase('idle')
          return
        }
        // 其余（500/429/未知）：留 blob，进失败双选（重试转写 / 改用文字），别甩「转写失败」的锅给产品。
        setPhase('transcribeFailed')
        return
      }
      const { text } = (await tr.json()) as { text: string }
      pendingBlobRef.current = null
      void sendReply(text)
    } catch {
      // 网络中断等：留 blob，进失败双选
      setPhase('transcribeFailed')
    }
  }, [router, scheduleRetry, sendReply, simTranscribe])
  runTranscribeAttemptRef.current = runTranscribeAttempt

  /** 一轮起点：停录 → 无 blob 则「没听清」回 idle；否则存 blob、重置重试计数、起首次转写。 */
  const handleUserTurn = useCallback(async () => {
    setPhase('transcribing')
    const blob = await stop()
    if (!blob) {
      // 空录音是唯一保留「再说一遍」的场景
      setError('没听清，要不要再说一遍？')
      setPhase('idle')
      return
    }
    setError(null)
    pendingBlobRef.current = blob
    retryAttemptRef.current = 0
    retryStartRef.current = Date.now()
    void runTranscribeAttempt()
  }, [stop, runTranscribeAttempt])

  /** 失败态「重试转写」：同一段 blob 重发，重置重试计数与计时。 */
  const onRetryTranscribe = useCallback(() => {
    if (!pendingBlobRef.current) { setPhase('idle'); return }
    clearRetryTimer()
    setError(null)
    retryAttemptRef.current = 0
    retryStartRef.current = Date.now()
    setPhase('transcribing')
    void runTranscribeAttempt()
  }, [clearRetryTimer, runTranscribeAttempt])

  /** 失败态「改用文字输入」→ 进 textInput（blob 先留着，取消回失败态还能重试转写）。 */
  const onUseTextInput = useCallback(() => {
    clearRetryTimer()
    setPhase('textInput')
  }, [clearRetryTimer])

  /** 文字输入「发送」：trim 非空 → 清 blob（这轮改走文字）→ 与转写成功走完全同一下游 sendReply。 */
  const onSubmitText = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    clearRetryTimer()
    pendingBlobRef.current = null
    void sendReply(trimmed)
  }, [clearRetryTimer, sendReply])

  /** 文字输入「返回」→ 回失败双选（blob 仍在，可再选重试转写）。 */
  const onCancelText = useCallback(() => {
    setPhase('transcribeFailed')
  }, [])

  const handlePolish = useCallback(async (sentence: string, aiQuestion?: string) => {
    setShowPolish(true)
    setPolishResult(null)
    setPolishLoading(true)
    try {
      const res = await apiFetch('/api/practice/polish', {
        method: 'POST',
        json: { sentence, aiQuestion, level },
      })
      // 服务端同意闸拒绝（403）：回首页触发同意弹窗，不停在优化失败态。
      if (res.status === 403) { router.push('/'); return }
      if (!res.ok) throw new Error('优化失败')
      const data = (await res.json()) as PolishResult
      setPolishResult(data)
      if (data.needsWork && data.optimized) {
        setPolishHistory(h => [...h, {
          original: sentence,
          optimized: data.optimized,
          note: data.note,
          part: scaffold?.part ?? 1,
          questionEn: scaffold?.displayEn ?? '',
        }])
      }
    } catch {
      setPolishResult({ needsWork: false, optimized: '', note: '优化失败，请重试' })
    } finally {
      setPolishLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 优化按当前 level 取值即可；level 变更由独立分支处理，列入依赖会无谓重建回调
  }, [scaffold, router])
  // A6 防重入：优化共用一个弹窗，单 ref 守卫 —— 进行中再点优化不会重复发 AI 调用 / 重复写历史
  const [runPolish] = useAsyncAction(handlePolish)

  // 收藏发音正音：把"听成的词 + 真正想说的词 + 出处句"异步落库；成功后失效缓存供素材库读到最新
  const handleSavePronunciation = useCallback((intended: string) => {
    if (!capture) return
    const heard = capture.heard
    void addSavedPronunciation({
      id: `${intended.toLowerCase()}__${heard.toLowerCase()}`,
      intended,
      heard,
      context: capture.context,
      createdAt: new Date().toISOString(),
    })
      .then(() => refreshSavedPronunciations())
      .catch((e) => console.error('[Practice] 收藏发音失败', e))
    setCapture(null)
  }, [capture])

  // 首个 idle（教练开场白就绪）时判一次功能引导；ref 守卫使 phase 之后在 idle/recording 间来回也不重复弹。
  useEffect(() => {
    if (phase !== 'idle' || introCheckedRef.current) return
    introCheckedRef.current = true
    // ⚠️ 测试钩子 previewIntro：绕过已读标记强制弹，供真机验文案（关掉即 markPracticeIntroSeen，但不影响再次带参）
    if (previewIntro || !hasSeenPracticeIntro()) setShowIntro(true)
  }, [phase, previewIntro])

  const onStartRecord = useCallback(() => {
    if (phase !== 'idle') return
    setError(null)
    setPhase('recording')
    void start()
  }, [phase, start])

  // 取消录音：停掉并丢弃这段，不转写、不发送，回到空闲
  const onCancelRecord = useCallback(() => {
    if (phase !== 'recording') return
    clearRetryTimer()
    void stop()
    setError(null)
    setPhase('idle')
  }, [phase, stop, clearRetryTimer])

  // 录音计时（驱动计时器 + 临近上限提示）；离开录音态即归零
  useEffect(() => {
    if (phase !== 'recording') { setElapsed(0); return }
    const startedAt = Date.now()
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 250)
    return () => window.clearInterval(id)
  }, [phase])

  // 到达上限自动停止并发送：Part 2 = 150s，Part 1/3 = 90s
  useEffect(() => {
    const cap = scaffold?.part === 2 ? 150 : 90
    if (phase === 'recording' && elapsed >= cap) void handleUserTurn()
  }, [phase, elapsed, scaffold, handleUserTurn])

  // 点弹窗外关闭
  useEffect(() => {
    if (!showPolish) return
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node) &&
          orbRef.current && !orbRef.current.contains(e.target as Node)) {
        setShowPolish(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPolish])

  const recordCap = scaffold?.part === 2 ? 150 : 90
  const nearLimit = phase === 'recording' && recordCap - elapsed <= 20

  // 满 8 轮温柔收尾：用户已说够 8 次且最后一条是教练回复 → 隐藏录音条，显示「查看反馈」收尾区
  const userTurnCount = messages.filter(m => m.role === 'user').length
  const lastMsg = messages[messages.length - 1]
  const isCapped = userTurnCount >= PRACTICE_TURN_LIMIT && lastMsg?.role === 'assistant'

  const handleEnd = useCallback(() => {
    clearRetryTimer()   // 结束这场：清掉悬空的转写重试计时器，别在反馈页还偷偷重发
    setSessionPolishes(polishHistory)
    // 只在用户至少说过一轮时才计入练习记录（= 产品定义的「走完完整链路」）。
    // 0 轮就点结束（抽到题→误入→立即退出）不该被计为「已练」，否则该题会被首页抽题【永久】排除，
    // 也会误计练习总数 / 复练月额度。打卡「发起即走」不 await —— 点结束就该马上看反馈页；
    // 重试（3 次，约 3.2s 内）后台跑，全失败由反馈页弹提示。
    if (userTurnCount >= 1) {
      startPracticeSessionRecord(questionId || null, isReview)
    }
    // navigate：点「结束」瞬间即亮顶部条（反馈页需生成总结、非瞬时），避免用户以为结束按钮没反应重复点。
    navigate('/feedback')
  }, [polishHistory, questionId, isReview, navigate, userTurnCount, clearRetryTimer])
  // A5 防重入：两处「结束」按钮共用同一 ref 守卫，连点/双击只会记一次会话、计一次额度
  const [endSession] = useAsyncAction(handleEnd)
  const capHint =
    scaffold?.part === 2
      ? '真实雅思 Part 2 约 2 分钟会被喊停，可以开始收尾啦'
      : '快到录音上限了，可以开始收尾啦'
  const recTime = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const micLabel = phase === 'transcribing' ? '转写中…' : phase === 'queued' ? '正在提交…' : phase === 'replying' ? '思考中…' : '点击说话'

  // 点某个词 → 打开发音纠错卡（逻辑集中在外壳，视图仅透传 word/句子/下标）
  const onWordTap = useCallback((word: string, content: string, index: number) => {
    setCapture({ heard: word, context: content, msgIndex: index, savedIds: pronunciationsRef.current.map(p => p.id) })
  }, [])

  // 换个说法：用该句上做过的发音纠错替换听错的词后再优化（防重入走 runPolish）
  const onPolish = useCallback((content: string, index: number) => {
    const prev = messages[index - 1]
    const aiQuestion = prev?.role === 'assistant' ? prev.content : undefined
    const fixes = pronunciationsRef.current.filter(c => c.context === content)
    void runPolish(applyPronunciationFixes(content, fixes), aiQuestion)
  }, [messages, runPolish])

  const isDesktop = useIsDesktop()

  const viewProps: PracticeViewProps = {
    scaffold, messages, phase, error, showPolish, polishLoading, polishResult, capture, audioLevel,
    recTime, nearLimit, micLabel, capHint, isCapped,
    popupRef, orbRef, bottomRef, pronounceRef,
    onStartRecord,
    onCancelRecord,
    onSend: () => void handleUserTurn(),
    onRetryTranscribe,
    onUseTextInput,
    onSubmitText,
    onCancelText,
    onRetryReply,
    replyFailAttempt,
    onWordTap,
    onPolish,
    onReopenPolish: () => { if (polishResult) setShowPolish(true) },
    onClosePolish: () => setShowPolish(false),
    onSavePronunciation: handleSavePronunciation,
    onCloseCapture: () => setCapture(null),
    onEnd: () => void endSession(),
    onRetry: () => { setPhase('init'); setRetryKey(k => k + 1) },
    onExit: () => router.push('/'),
  }

  // 额度超限覆盖层：初始化时（练习无法开始）与对话中途（撞轮次/ASR 上限）共用，关闭即返回上一页。
  // 变体由服务端 402 reason 决定（trial 引导注册 / ielts 月额度），匿名绝不会误显示月额度谎报。
  const quotaOverlay = quotaVariant
    ? <QuotaReached variant={quotaVariant} asOverlay onClose={() => router.back()} />
    : null

  // 单挂载：桌面 = FlowShellDesktop（练习步激活）包 PracticeDesktop；否则移动端。绝不两套同挂。
  if (isDesktop) {
    return (
      <>
        <FlowShellDesktop activeStep="practice" onExit={viewProps.onExit}>
          <PracticeDesktop {...viewProps} />
        </FlowShellDesktop>
        {quotaOverlay}
        <PracticeIntroDialog open={showIntro} onClose={closeIntro} />
      </>
    )
  }
  return (
    <>
      <PracticeMobile {...viewProps} />
      {quotaOverlay}
      <PracticeIntroDialog open={showIntro} onClose={closeIntro} />
    </>
  )
}

export default function PracticePage(): JSX.Element {
  return <Suspense><PracticeContent /></Suspense>
}
