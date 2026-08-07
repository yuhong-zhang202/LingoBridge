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
import { type JSX, useState, useRef, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { usePolish } from '@/hooks/usePolish'
import { useNav } from '@/components/NavProgress'
import { setSessionPolishes, hasSeenPracticeIntro, markPracticeIntroSeen, type PracticeSessionScope } from '@/lib/storage'
import { addSavedPronunciation } from '@/lib/db/saved-pronunciations'
import { useSavedPronunciations, refreshSavedPronunciations } from '@/hooks/library-data'
import { applyPronunciationFixes } from '@/lib/pronunciation'
import { startPracticeSessionRecord } from '@/lib/practice-session-record'
import { apiFetch, readQuotaReason } from '@/lib/api-client'
import { track } from '@/lib/client-events'
// 优化（polish）调用结局的取值域【来自 event-schema 这一份真源】，本页不再手抄：
// 服务端 sanitize 对不认识的值是【静默丢弃】，打错一个字母就成了「埋了但库里查不到」，本地测不出来。
import type { AiResult } from '@/lib/event-schema'
import type { PracticeScaffold, PracticeMessage } from '@/lib/types'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import PracticeMobile from './PracticeMobile'
import PracticeDesktop from './PracticeDesktop'
import PracticeIntroDialog from './_components/PracticeIntroDialog'
import type { PracticePhase, PracticeViewProps } from './types'

/** 用户发言达此轮数后温柔收尾，不再允许新录音 */
const PRACTICE_TURN_LIMIT = 8

/** storyId 入库前的 UUID 校验（同 api/questions 口径；埋点侧的同款校验收口在 lib/events.logEvent）：
 *  非 UUID 深链脏值绝不写进 story_id */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ——— 转写 503（ASR 并发闸「人多」）自动重试参数 ———
// 与 api/transcribe 的 Retry-After:5 对齐；每次实际延迟 = max(Retry-After 头, 退避基数_n)。
// 上限双闸：最多重试 ASR_RETRY_MAX 次，或累计等待超 ASR_RETRY_TOTAL_CAP_MS 即转失败态（避免无休止等）。
/** 自动重试最多次数（不含首发） */
const ASR_RETRY_MAX = 3
/** 自动重试累计等待上限（含各次退避），超过即进 transcribeFailed */
const ASR_RETRY_TOTAL_CAP_MS = 35_000
/** 各次重试退避基数（秒），按已重试次数取；超出取末位 */
const ASR_RETRY_BASE_S = [5, 7, 10] as const

/**
 * /api/practice 的非 2xx 响应 → ai_call 结局码（教练对话两条调用路径共用）。
 * 402/403 由各调用点在读体前单独分流（要弹额度层 / 回首页触发同意），不走这里。
 * @param status  HTTP 状态码
 * @returns       契约内的结局枚举值
 */
function coachResultFromStatus(status: number): AiResult {
  if (status === 400) return 'bad_input_400'   // 对话过长（超轮次上限）/ 缺 questionId
  if (status === 401) return 'auth_401'
  if (status === 429) return 'rate_429'
  if (status >= 500) return 'server_5xx'
  return 'other'
}

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
  // 选题行为埋点(乙.2)：rank = 该题在匹配结果里的 1-based 排位，随故事流(from=matching)经 analysis 一路透传而来；
  // 泛题池流(qid 直达、不走排序)无此 query → null，不硬造。仅接受 1..10000 正整数字符串（上界与 events
  // 侧 route.ts 收敛口径对齐，防深链构造超大 rank 触发 int 写库 out-of-range），脏值/超界一律作 null。
  const rankParam = params.get('rank')
  const rankParsed = rankParam !== null && /^[1-9]\d*$/.test(rankParam) ? Number(rankParam) : null
  const rank = rankParsed !== null && rankParsed <= 10000 ? rankParsed : null
  // storyId 入库前的 UUID 格式校验（与 rank 的 1..10000 收敛对称）：storyId 会写进 practice_sessions.story_id，
  // 深链构造的脏值直接落库会让 insert 撞 uuid 类型抛错。非 UUID → 作 null（泛题池流本就传 null），不硬写脏值。
  // 仅约束写库路径，不动 storyId 本身（scaffold 取语料走 getCorpusByIdServer，非 UUID 自然取空、无副作用）。
  const storyIdForRecord = UUID_RE.test(storyId) ? storyId : null
  // 本场身份：优化句子随它一起存，页面被手机浏览器回收后重载时靠它核对「存的是不是当前这一场」。
  // 用原始 URL 取值（不是 storyIdForRecord 那个校验后的值）——判据只要「和当前 URL 一致」，不掺加工。
  // ⚠️ 开场（startPracticeSession）在【进入练习页的入口】调用，绝不能挪到本页：本页调 = 重载也算新一场，等于没修。
  const practiceScope = useMemo<PracticeSessionScope>(
    () => ({ questionId, storyId, level, review: isReview }),
    [questionId, storyId, level, isReview],
  )

  const [scaffold, setScaffold]           = useState<PracticeScaffold | null>(null)
  const [messages, setMessages]           = useState<PracticeMessage[]>([])
  const [phase, setPhase]                 = useState<PracticePhase>('init')
  const [elapsed, setElapsed]             = useState(0)
  const [error, setError]                 = useState<string | null>(null)
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
  // surface='practice'：本页每轮对话都调 start()，若沿用录音页的 'recording' 会把练习页的授权失败
  // 一轮一条地灌进故事采集那一格，故事采集的授权失败率会被永久带偏
  const { start, stop, audioLevel } = useAudioRecorder({ surface: 'practice' })

  // ——— 转写重试/文字输入所需的留存态（都用 ref：跨 setTimeout 重试链读最新，不进 useCallback 依赖）———
  // 录音 blob 留存：转写失败/文字取消后要用同一段重发。⚠️ Request body 被消费过不能复用，
  // 每次发请求都现构 FormData（见 runTranscribeAttempt）；此处只留 Blob 本体。
  const pendingBlobRef = useRef<Blob | null>(null)
  // 本段录音的采集信号（供服务端「假空率」判真空/假空）：与 blob 同寿命，重试链现构 FormData 时一并带上。
  const pendingAudioMetaRef = useRef<{ peakLevel: number; durationMs: number } | null>(null)
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

  // ——— 优化（换个说法）整块：三态 + 历史 + 调用分流 + 「再试一次」都在 usePolish 里，本页只接线 ———
  // 402/403 的去向由本页给（弹哪种额度层 / 跳哪儿），hook 不自己做跳转；两个回调用 useCallback 稳住引用。
  const onPolishTrialQuota = useCallback(() => setQuotaVariant('trial'), [])
  const onPolishConsentDenied = useCallback(() => { router.push('/') }, [router])
  const {
    showPolish, polishLoading, polishResult, polishHistory,
    runPolish, retryPolish, reopenPolish, closePolish,
  } = usePolish({ level, scope: practiceScope, scaffold, popupRef, onTrialQuota: onPolishTrialQuota, onConsentDenied: onPolishConsentDenied })

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
    // ——— 开场白这次调用的埋点（fire-and-forget，不参与任何分支判断、不改任何时序）———
    // 教练对话【每轮都记一条】（本处 = 开场白那轮，requestReply = 之后每轮），一场练习 8~15 条。
    // 条数刻意不省：只埋失败不埋成功就算不出成功率，而这正是唯一能看见 402/400 那两道服务端裸 return 的渠道。
    const t0 = performance.now()
    let aiReported = false
    /** 开场白这一次调用只报一条：!res.ok 抛出的错会被下面的 catch 再兜一次，不挡就记两遍 */
    const reportAi = (result: AiResult, httpStatus: number): void => {
      if (aiReported) return
      aiReported = true
      track('flow.ai_call', { stage: 'coach', result, httpStatus, latencyMs: performance.now() - t0 })
    }
    ;(async () => {
      try {
        const res = await apiFetch('/api/practice', {
          method: 'POST',
          json: { questionId, storyId, messages: [], level, isReview },
          signal: ac.signal,
        })
        // 服务端复练额度拦截（402）：弹 QuotaReached 覆盖层而非普通错误态。reason 决定变体（ielts/trial）。
        // 【本月复练额度用完】就走这条，服务端不记账 —— 不埋这一条我们就永远不知道有人被它挡在门外。
        if (res.status === 402) {
          reportAi('quota_402', 402)
          const reason = await readQuotaReason(res)
          if (!cancelled) setQuotaVariant(reason === 'ielts' ? 'ielts' : 'trial')
          return
        }
        // 服务端同意闸拒绝（403，未捕获同意）：深链直达本页时兜底，回首页触发同意弹窗，不停在初始化失败态。
        if (res.status === 403) { reportAi('consent_403', 403); if (!cancelled) router.push('/'); return }
        // 在 throw 之前报：进了 catch 就只剩「网络失败」一种说法，400/429/500 会被记成凭空的网络故障
        if (!res.ok) { reportAi(coachResultFromStatus(res.status), res.status); throw new Error('对话初始化失败') }
        const data = (await res.json()) as { scaffold: PracticeScaffold; reply: string }
        reportAi('ok', 200)
        if (!cancelled) {
          setScaffold(data.scaffold)
          setMessages([{ role: 'assistant', content: data.reply }])
          setPhase('idle')
        }
      } catch (e) {
        if (ac.signal.aborted) return          // 中断不算错误，忽略；aborted 由 cleanup 统一报
        reportAi('network', 0)                 // 到此只剩真·网络 reject（非 2xx 已分流报过、被自去重挡住）
        if (!cancelled) { setPhase('error'); setError(e instanceof Error ? e.message : '对话初始化失败') }
      }
    })()
    // 没等到开场白就离开 → aborted（不计失败）；已报结局的被自去重挡住
    return () => { cancelled = true; reportAi('aborted', 0); ac.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初次加载用默认 level 初始化对话；切换水平走独立分支，列入依赖会重复初始化
  }, [questionId, storyId, retryKey, isReview])

  // ——— 一轮拆成四段：handleUserTurn（停录/存 blob/起首发）→ runTranscribeAttempt（发转写、按响应码分流）
  //     → scheduleRetry（503 排队重试）→ sendReply（拿到文本后追加用户气泡 + 取教练回复）———
  //     文字输入与转写成功共用 sendReply 这同一条下游。

  /** 用给定 messages（末条须为用户气泡）POST /api/practice 取教练回复：成功追加教练回复回 idle；
   *  403/402 照旧先行 return 不进失败态；其余错误 → replyFailed（用当前 messages 可再重发，不追加用户气泡）。
   *  首发（sendReply）与「再试一次」（onRetryReply）共用此下游；catch 不再 setError（避免脏字符串残留）。 */
  const requestReply = useCallback(async (msgs: PracticeMessage[]) => {
    // ——— 这一轮教练回复的埋点（fire-and-forget，不参与任何分支判断、不改任何时序）———
    // 首发（sendReply）与失败态「再试一次」（onRetryReply）共用本函数，各自都是用户视角的一次尝试，
    // 故【不跨次去重】：重试一次就再报一条（去重只在本次调用内，防同一次被 catch 记两遍）。
    // 本请求不带 signal（对话轮次一旦发出就该等回来，跳页也不撤），故无 aborted 分支。
    const t0 = performance.now()
    let aiReported = false
    /** 这一轮回复只报一条：!res.ok 抛出的错会被下面的 catch 再兜一次，不挡就记两遍 */
    const reportAi = (result: AiResult, httpStatus: number): void => {
      if (aiReported) return
      aiReported = true
      track('flow.ai_call', { stage: 'coach', result, httpStatus, latencyMs: performance.now() - t0 })
    }
    try {
      const res = await apiFetch('/api/practice', {
        method: 'POST',
        json: { scaffold: scaffoldRef.current, messages: msgs },
      })
      // 服务端同意闸拒绝（403）：回首页触发同意弹窗，不停在对话失败态。
      if (res.status === 403) { reportAi('consent_403', 403); router.push('/'); return }
      // 额度用尽（402，聊到第 N 轮才撞上限）：走配额提示而非「对话失败」。发言已上屏，关闭覆盖层后不丢。
      if (res.status === 402) {
        reportAi('quota_402', 402)
        const reason = await readQuotaReason(res)
        setQuotaVariant(reason === 'ielts' ? 'ielts' : 'trial'); setPhase('idle'); return
      }
      // 在 throw 之前报：进了 catch 就只剩「网络失败」一种说法，400（对话过长）/429/500 会被记成凭空的网络故障
      if (!res.ok) { reportAi(coachResultFromStatus(res.status), res.status); throw new Error('对话失败') }
      const data = (await res.json()) as { reply: string }
      reportAi('ok', 200)
      setMessages([...msgs, { role: 'assistant', content: data.reply }])
      setReplyFailAttempt(0)
      setPhase('idle')
    } catch {
      // 网络/服务错误：不 setError（脏字符串会残留在 idle 提示区），改进 replyFailed 给「再试一次」
      reportAi('network', 0)   // 到此只剩真·网络 reject（非 2xx 已分流报过、被自去重挡住）
      setReplyFailAttempt(n => n + 1)
      setPhase('replyFailed')
    }
  }, [router])

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
    // ——— 本次转写调用的埋点（fire-and-forget，不参与任何分支判断、不改任何时序）———
    // 【每次尝试各记一条】503 排队重试与失败态「重试转写」都会重走本函数、自然再报一条：
    // 那确实是又一次真实的服务端调用（也是唯一能看见「排队重试到底重了几次、最后成没成」的渠道），
    // 故不跨次去重；去重只在本次调用内（防同一次被 catch 再记一遍）。
    // 本请求不带 signal（转写一旦发出就等回来，跳页也不撤），故无 aborted 分支。
    let t0: number | null = null
    let reported = false
    /**
     * 转写这一次调用的结局：只报一条，且【只在请求真发出过（t0 已置位）之后】才报。
     * 两个条件缺一不可：不挡重复，读体/解析抛出的错会被下面的 catch 再记一遍同一次调用；
     * 不挡 t0，「无 blob」这类请求还没发就早退的路会被记成 network，等于凭空造一次没发生的调用。
     */
    const reportTranscribe = (result: AiResult, httpStatus: number): void => {
      if (reported || t0 === null) return
      reported = true
      track('flow.ai_call', { stage: 'transcribe', result, httpStatus, latencyMs: performance.now() - t0 })
    }
    const blob = pendingBlobRef.current
    if (!blob) { setPhase('idle'); return }   // 兜底：无 blob 不该走到这（请求未发出 → 不记 ai_call）
    try {
      // 每次现构 FormData：body 被消费过不可复用（重试/文字取消后重发都要新构一份）
      const form = new FormData()
      form.append('audio', blob, 'turn.webm')
      // scene='practice'：练习转写（对话轮次）。仅供服务端打 phase 埋点区分看板归位，不影响转写行为。
      form.append('scene', 'practice')
      // 采集信号（可选增强）：仅服务端在「空录音失败」时落 metadata.audio 供假空率判定，不影响转写/重试。
      // 拿不到（异常/旧客户端）时不传，服务端容错。blobBytes 直接取 blob.size。
      const audioMeta = pendingAudioMetaRef.current
      if (audioMeta) {
        form.append('peakLevel', String(audioMeta.peakLevel))
        form.append('durationMs', String(audioMeta.durationMs))
        form.append('blobBytes', String(blob.size))
      }
      // multipart：传 body（非 json），apiFetch 不设 Content-Type，交浏览器自动带 boundary
      t0 = performance.now()
      const tr = await apiFetch('/api/transcribe', { method: 'POST', body: form })
      // 服务端同意闸拒绝（403）：回首页触发同意弹窗。
      // 【服务端不记账】403/402/429/503 都在 logApiUsage 之前裸 return，成本看板完全看不见 —— 只有这条埋点能看见。
      if (tr.status === 403) { reportTranscribe('consent_403', 403); router.push('/'); return }
      // 额度用尽（402，匿名撞 ASR 试用上限）：走配额提示。清 blob（这段不再重试）。
      // ASR 402 是匿名 only（注册走 429）→ 恒 trial（引导注册）。
      if (tr.status === 402) { reportTranscribe('quota_402', 402); pendingBlobRef.current = null; setQuotaVariant('trial'); setPhase('idle'); return }
      // ASR_BUSY（503，并发闸「人多」）：不是坏了，几秒后自动重试就能成 → 按 Retry-After 头排队重试。
      if (tr.status === 503) {
        reportTranscribe('busy_503', 503)
        const retryAfter = Number(tr.headers.get('Retry-After')) || 0
        scheduleRetry(retryAfter)
        return
      }
      if (!tr.ok) {
        const errData = (await tr.json().catch(() => ({}))) as { code?: string }
        // 结局按 code 优先（与 recording 页同款判法：服务端换了状态码仍命中），并【按 422 兜底】——
        // 上一行读体带 .catch(()=>({}))，体读不出来时 code 为 undefined，只认 code 会把空录音记成 other。
        // 注意此处只影响埋点归档：下面的 UI 分支仍只认 code（体读失败时进失败双选，是既有行为，不动）。
        // 其余按状态码归档；httpStatus 一律传真实状态码。埋在下面各 return 之前。
        reportTranscribe(
          errData.code === 'EMPTY_TRANSCRIPT' || tr.status === 422
            ? 'empty_422'
            : tr.status === 429
              ? 'rate_429'
              : tr.status === 400
                ? 'bad_input_400'
                : tr.status === 401
                  ? 'auth_401'
                  : tr.status >= 500 ? 'server_5xx' : 'other',
          tr.status,
        )
        // 空录音（HTTP 422）：唯一保留「再说一遍」的分支——录到了音但没人声，是输入问题。清 blob。
        // 与上方埋点行同款按 **HTTP 422** 兜底、不罗列豆包码：什么算「内容为空」由服务端唯一定夺
        // （api/transcribe 已把 EMPTY_TRANSCRIPT 与豆包静音码 20000003 都归 422），客户端抄码表必分叉——
        // 此前这里只认 EMPTY_TRANSCRIPT，静音码被误送进失败双选而不是「再说一遍」。
        if (errData.code === 'EMPTY_TRANSCRIPT' || tr.status === 422) {
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
      reportTranscribe('ok', 200)
      pendingBlobRef.current = null
      void sendReply(text)
    } catch {
      // 网络中断等：留 blob，进失败双选
      // 到此只剩真·网络 reject（与响应体解析失败）：非 2xx 已在上面按状态码分流报过、被自去重挡住；
      // 请求压根没发出（无 blob）的路走不到这，t0 为 null 时 helper 自会闭嘴。
      reportTranscribe('network', 0)
      setPhase('transcribeFailed')
    }
  }, [router, scheduleRetry, sendReply])
  runTranscribeAttemptRef.current = runTranscribeAttempt

  /** 一轮起点：停录 → 无 blob 则「没听清」回 idle；否则存 blob、重置重试计数、起首次转写。 */
  const handleUserTurn = useCallback(async () => {
    setPhase('transcribing')
    const rec = await stop()
    if (!rec) {
      // 空录音是唯一保留「再说一遍」的场景
      setError('没听清，要不要再说一遍？')
      setPhase('idle')
      return
    }
    setError(null)
    pendingBlobRef.current = rec.blob
    pendingAudioMetaRef.current = { peakLevel: rec.peakLevel, durationMs: rec.durationMs }
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
    if (!hasSeenPracticeIntro()) setShowIntro(true)
  }, [phase])

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
        closePolish()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPolish, closePolish])

  const recordCap = scaffold?.part === 2 ? 150 : 90
  const nearLimit = phase === 'recording' && recordCap - elapsed <= 20

  // 满 8 轮温柔收尾：用户已说够 8 次且最后一条是教练回复 → 隐藏录音条，显示「查看反馈」收尾区
  const userTurnCount = messages.filter(m => m.role === 'user').length
  const lastMsg = messages[messages.length - 1]
  const isCapped = userTurnCount >= PRACTICE_TURN_LIMIT && lastMsg?.role === 'assistant'

  const handleEnd = useCallback(() => {
    clearRetryTimer()   // 结束这场：清掉悬空的转写重试计时器，别在反馈页还偷偷重发
    // 收口写一次。练习中每优化成功一句就已经存过（usePolish 边攒边存），这里写的是同一份内容：
    // 重载过的场次 polishHistory 已由 usePolish 初始化器回填，不会再拿空数组把存好的句子盖掉。
    setSessionPolishes(polishHistory, practiceScope)
    // 只在用户至少说过一轮时才计入练习记录（= 产品定义的「走完完整链路」）。
    // 0 轮就点结束（抽到题→误入→立即退出）不该被计为「已练」，否则该题会被首页抽题【永久】排除，
    // 也会误计练习总数 / 复练月额度。打卡「发起即走」不 await —— 点结束就该马上看反馈页；
    // 重试（3 次，约 3.2s 内）后台跑，全失败由反馈页弹提示。
    if (userTurnCount >= 1) {
      // storyId/rank 仅故事流有（storyId 空串 = 泛题池流）→ 空则 null，不写脏值（乙.2）
      // storyIdForRecord 已做 UUID 校验：非 UUID/空串 → null，绝不把脏值写进 story_id
      startPracticeSessionRecord(questionId || null, isReview, storyIdForRecord, rank)
    }
    // navigate：点「结束」瞬间即亮顶部条（反馈页需生成总结、非瞬时），避免用户以为结束按钮没反应重复点。
    navigate('/feedback')
  }, [polishHistory, practiceScope, questionId, isReview, storyIdForRecord, rank, navigate, userTurnCount, clearRetryTimer])
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
    onRetryReply,
    replyFailAttempt,
    onWordTap,
    onPolish,
    onRetryPolish: retryPolish,
    onReopenPolish: reopenPolish,
    onClosePolish: closePolish,
    onSavePronunciation: handleSavePronunciation,
    onCloseCapture: () => setCapture(null),
    onEnd: () => void endSession(),
    onRetry: () => { setPhase('init'); setRetryKey(k => k + 1) },
    onExit: () => navigate('/'), // 退出跳首页走 navigate → 点击当帧亮顶部进度条（消冷缓存空窗）
  }

  // 额度超限覆盖层：初始化时（练习无法开始）与对话中途（撞轮次/ASR 上限）共用，关闭即返回上一页。
  // 变体由服务端 402 reason 决定（trial 引导注册 / ielts 月额度），匿名绝不会误显示月额度谎报。
  const quotaOverlay = quotaVariant
    ? <QuotaReached variant={quotaVariant} surface="practice" asOverlay onClose={() => router.back()} />
    : null

  // 单挂载：桌面 = FlowShellDesktop（练习步激活）包 PracticeDesktop；否则移动端。绝不两套同挂。
  if (isDesktop) {
    return (
      <>
        <FlowShellDesktop activeStep="practice" onExit={viewProps.onExit} showFeedback>
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
