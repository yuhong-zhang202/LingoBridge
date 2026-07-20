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
import { setSessionPolishes } from '@/lib/storage'
import { addSavedPronunciation } from '@/lib/db/saved-pronunciations'
import { useSavedPronunciations, refreshSavedPronunciations } from '@/hooks/library-data'
import { applyPronunciationFixes } from '@/lib/pronunciation'
import { recordPracticeSession } from '@/lib/db/practice-sessions'
import { apiFetch } from '@/lib/api-client'
import { getSupabase } from '@/lib/supabase'
import type { PracticeScaffold, PracticeMessage, PolishResult, SessionPolish } from '@/lib/types'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import PracticeMobile from './PracticeMobile'
import PracticeDesktop from './PracticeDesktop'
import type { PracticeViewProps } from './types'

/** 用户发言达此轮数后温柔收尾，不再允许新录音 */
const PRACTICE_TURN_LIMIT = 8

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
  const params = useSearchParams()
  const questionId = params.get('questionId') ?? ''
  const storyId = params.get('storyId') ?? ''
  const level = params.get('level') ?? '6.0'
  const isReview = params.get('review') === '1'

  const [scaffold, setScaffold]           = useState<PracticeScaffold | null>(null)
  const [messages, setMessages]           = useState<PracticeMessage[]>([])
  const [phase, setPhase]                 = useState<'init' | 'idle' | 'recording' | 'transcribing' | 'replying' | 'error'>('init')
  const [elapsed, setElapsed]             = useState(0)
  const [error, setError]                 = useState<string | null>(null)
  const [showPolish, setShowPolish]       = useState(false)
  const [polishLoading, setPolishLoading] = useState(false)
  const [polishResult, setPolishResult]   = useState<PolishResult | null>(null)
  const [polishHistory, setPolishHistory] = useState<SessionPolish[]>([])
  const [capture, setCapture]             = useState<{ heard: string; context: string; msgIndex: number; savedIds: string[] } | null>(null)
  const [retryKey, setRetryKey]           = useState(0)
  // 服务端复练额度超限（/api/practice 返回 402）→ 弹 QuotaReached 覆盖层
  const [reviewQuotaShown, setReviewQuotaShown] = useState(false)
  // 匿名试用用户：402 来自「匿名每日轮次上限」，没有月额度 → 走 trial 变体（引导注册）；
  // 注册用户才是月额度用完，走 ielts 变体。与 restructure 页同一判断范式。
  const [isAnon, setIsAnon] = useState(false)
  useEffect(() => {
    void getSupabase().auth.getSession().then(({ data: { session } }) => {
      setIsAnon(session?.user?.is_anonymous ?? false)
    })
  }, [])

  const popupRef  = useRef<HTMLDivElement>(null)
  const orbRef    = useRef<HTMLButtonElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pronounceRef = useRef<HTMLDivElement>(null)
  const { start, stop, audioLevel } = useAudioRecorder()

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
        // 服务端复练额度拦截（402）：弹 QuotaReached 覆盖层而非普通错误态
        if (res.status === 402) { if (!cancelled) setReviewQuotaShown(true); return }
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

  // 一轮：录音停止 → 转写 → 追加用户消息 → 拿 AI 回复
  const handleUserTurn = useCallback(async () => {
    setPhase('transcribing')
    try {
      const blob = await stop()
      if (!blob) throw new Error('没有录到声音')
      const form = new FormData()
      form.append('audio', blob, 'turn.webm')
      // multipart：传 body（非 json），apiFetch 不设 Content-Type，交浏览器自动带 boundary
      const tr = await apiFetch('/api/transcribe', { method: 'POST', body: form })
      // 服务端同意闸拒绝（403）：回首页触发同意弹窗，别落入 !ok 分支报误导性的「转写失败」。
      if (tr.status === 403) { router.push('/'); return }
      // 额度用尽（402，匿名撞 ASR 试用上限）：与初始化同一套配额提示，别落进「转写失败」普通错误态 ——
      // 用户会以为产品坏了，白丢一次转化。
      if (tr.status === 402) { setReviewQuotaShown(true); setPhase('idle'); return }
      if (!tr.ok) throw new Error('转写失败')
      const { text } = (await tr.json()) as { text: string }

      const next: PracticeMessage[] = [...messages, { role: 'user', content: text }]
      setMessages(next)
      setPhase('replying')

      const res = await apiFetch('/api/practice', {
        method: 'POST',
        json: { scaffold, messages: next },
      })
      // 服务端同意闸拒绝（403）：回首页触发同意弹窗，不停在对话失败态。
      if (res.status === 403) { router.push('/'); return }
      // 额度用尽（402，聊到第 N 轮才撞上限）：同上，走配额提示而非「对话失败」。
      // 用户这一轮的发言已经上屏，关闭覆盖层后不丢。
      if (res.status === 402) { setReviewQuotaShown(true); setPhase('idle'); return }
      if (!res.ok) throw new Error('对话失败')
      const data = (await res.json()) as { reply: string }
      setMessages([...next, { role: 'assistant', content: data.reply }])
      setPhase('idle')
    } catch (e) {
      setError(e instanceof Error ? e.message : '出错了，请重试')
      setPhase('idle')
    }
  }, [stop, messages, scaffold, router])

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

  const onStartRecord = useCallback(() => {
    if (phase !== 'idle') return
    setError(null)
    setPhase('recording')
    void start()
  }, [phase, start])

  // 取消录音：停掉并丢弃这段，不转写、不发送，回到空闲
  const onCancelRecord = useCallback(() => {
    if (phase !== 'recording') return
    void stop()
    setError(null)
    setPhase('idle')
  }, [phase, stop])

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
    setSessionPolishes(polishHistory)
    void recordPracticeSession(questionId || null, isReview).catch((e) =>
      console.warn('[Practice] 记录练习场次失败', e))
    router.push('/feedback')
  }, [polishHistory, questionId, isReview, router])
  // A5 防重入：两处「结束」按钮共用同一 ref 守卫，连点/双击只会记一次会话、计一次额度
  const [endSession] = useAsyncAction(handleEnd)
  const capHint =
    scaffold?.part === 2
      ? '真实雅思 Part 2 约 2 分钟会被喊停，可以开始收尾啦'
      : '快到录音上限了，可以开始收尾啦'
  const recTime = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const micLabel = phase === 'transcribing' ? '转写中…' : phase === 'replying' ? '思考中…' : '点击说话'

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
  // 匿名用户没有月额度，撞的是试用轮次上限 → trial 变体（引导注册），不能显示「本月额度已用完 10/10」。
  const quotaOverlay = reviewQuotaShown
    ? <QuotaReached variant={isAnon ? 'trial' : 'ielts'} asOverlay onClose={() => router.back()} />
    : null

  // 单挂载：桌面 = FlowShellDesktop（练习步激活）包 PracticeDesktop；否则移动端。绝不两套同挂。
  if (isDesktop) {
    return (
      <>
        <FlowShellDesktop activeStep="practice" onExit={viewProps.onExit}>
          <PracticeDesktop {...viewProps} />
        </FlowShellDesktop>
        {quotaOverlay}
      </>
    )
  }
  return (
    <>
      <PracticeMobile {...viewProps} />
      {quotaOverlay}
    </>
  )
}

export default function PracticePage(): JSX.Element {
  return <Suspense><PracticeContent /></Suspense>
}
