/**
 * @module   PracticePage
 * @desc     练习对话页 — 教练 Lior（千问 qwen-plus），录音转写后续聊，🔨 触发重新表达
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useRef, useEffect, useCallback, Suspense, Fragment } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Mic, Clock, X, Send } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'
import EmptyState from '@/components/EmptyState'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import { setSessionPolishes, addSavedPronunciation } from '@/lib/storage'
import { recordPracticeSession } from '@/lib/db/practice-sessions'
import type { PracticeScaffold, PracticeMessage, PolishResult, SessionPolish } from '@/lib/types'
import OrbSoft from './_components/OrbSoft'
import AiBubble from './_components/AiBubble'
import UserBubble from './_components/UserBubble'
import RephrasePopup from './_components/RephrasePopup'
import VoiceBar from './_components/VoiceBar'
import PronounceCapturePopup from './_components/PronounceCapturePopup'

function PracticeContent(): JSX.Element {
  const router = useRouter()
  const params = useSearchParams()
  const questionId = params.get('questionId') ?? ''
  const storyId = params.get('storyId') ?? ''
  const level = params.get('level') ?? '6.0'

  const [scaffold, setScaffold]           = useState<PracticeScaffold | null>(null)
  const [messages, setMessages]           = useState<PracticeMessage[]>([])
  const [phase, setPhase]                 = useState<'init' | 'idle' | 'recording' | 'transcribing' | 'replying' | 'error'>('init')
  const [elapsed, setElapsed]             = useState(0)
  const [error, setError]                 = useState<string | null>(null)
  const [showPolish, setShowPolish]       = useState(false)
  const [polishLoading, setPolishLoading] = useState(false)
  const [polishResult, setPolishResult]   = useState<PolishResult | null>(null)
  const [polishHistory, setPolishHistory] = useState<SessionPolish[]>([])
  const [capture, setCapture]             = useState<{ heard: string; context: string; msgIndex: number } | null>(null)
  const [retryKey, setRetryKey]           = useState(0)

  const popupRef  = useRef<HTMLDivElement>(null)
  const orbRef    = useRef<HTMLButtonElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { start, stop, audioLevel } = useAudioRecorder()

  // 自动滚到底
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, phase])

  // 进页面：构建脚手架 + 拿开场白
  useEffect(() => {
    if (!questionId) { setPhase('error'); setError('缺少题目'); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/practice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId, storyId, messages: [], level }),
        })
        if (!res.ok) throw new Error('对话初始化失败')
        const data = (await res.json()) as { scaffold: PracticeScaffold; reply: string }
        if (!cancelled) {
          setScaffold(data.scaffold)
          setMessages([{ role: 'assistant', content: data.reply }])
          setPhase('idle')
        }
      } catch (e) {
        if (!cancelled) { setPhase('error'); setError(e instanceof Error ? e.message : '对话初始化失败') }
      }
    })()
    return () => { cancelled = true }
  }, [questionId, storyId, retryKey])

  // 一轮：录音停止 → 转写 → 追加用户消息 → 拿 AI 回复
  const handleUserTurn = useCallback(async () => {
    setPhase('transcribing')
    try {
      const blob = await stop()
      if (!blob) throw new Error('没有录到声音')
      const form = new FormData()
      form.append('audio', blob, 'turn.webm')
      const tr = await fetch('/api/transcribe', { method: 'POST', body: form })
      if (!tr.ok) throw new Error('转写失败')
      const { text } = (await tr.json()) as { text: string }

      const next: PracticeMessage[] = [...messages, { role: 'user', content: text }]
      setMessages(next)
      setPhase('replying')

      const res = await fetch('/api/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scaffold, messages: next }),
      })
      if (!res.ok) throw new Error('对话失败')
      const data = (await res.json()) as { reply: string }
      setMessages([...next, { role: 'assistant', content: data.reply }])
      setPhase('idle')
    } catch (e) {
      setError(e instanceof Error ? e.message : '出错了，请重试')
      setPhase('idle')
    }
  }, [stop, messages, scaffold])

  const handlePolish = useCallback(async (sentence: string, aiQuestion?: string) => {
    setShowPolish(true)
    setPolishResult(null)
    setPolishLoading(true)
    try {
      const res = await fetch('/api/practice/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence, aiQuestion, level }),
      })
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
  }, [scaffold])

  // 收藏发音正音：把"听成的词 + 真正想说的词 + 出处句"存进 localStorage
  const handleSavePronunciation = useCallback((intended: string) => {
    if (!capture) return
    const heard = capture.heard
    addSavedPronunciation({
      id: `${intended.toLowerCase()}__${heard.toLowerCase()}`,
      intended,
      heard,
      context: capture.context,
      createdAt: new Date().toISOString(),
    })
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
  const capHint =
    scaffold?.part === 2
      ? '真实雅思 Part 2 约 2 分钟会被喊停，可以开始收尾啦'
      : '快到录音上限了，可以开始收尾啦'
  const recTime = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const micLabel = phase === 'transcribing' ? '转写中…' : phase === 'replying' ? '思考中…' : '点击说话'

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      <TopBar
        title="练习对话"
        right={
          <button
            onClick={() => {
                setSessionPolishes(polishHistory)
                void recordPracticeSession(questionId || null).catch((e) =>
                  console.warn('[Practice] 记录练习场次失败', e))
                router.push('/feedback')
              }}
            className="text-[13px] text-v2-text-muted"
          >
            结束
          </button>
        }
      />
      <StepBar currentStep="practice" />

      {/* 题目条：固定在流程轴下方，不随对话滚动 */}
      <div className="flex-shrink-0 px-5 pt-2 pb-3">
        <div className="flex items-center gap-2 bg-bg-page border border-black/[0.05] rounded-[8px] px-[11px] py-[6px]">
          <span className="text-[11px] text-v2-text-muted flex-shrink-0">Part {scaffold?.part ?? 1}</span>
          <div className="w-px h-3 bg-black/10 flex-shrink-0" />
          <span className="text-[12px] font-medium text-v2-text-secondary flex-1 truncate min-w-0">
            {scaffold?.displayEn ?? '加载中…'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-0 pb-[100px] relative z-10">
        {phase === 'init' && (
          <div className="text-center text-[13px] text-v2-text-muted py-16">教练正在准备…</div>
        )}
        {phase === 'error' && (
          <EmptyState
            title="教练没接上"
            subtitle="刚才好像没连上，点下面再试一次就好。"
            ctaLabel="重试"
            onCta={() => { setPhase('init'); setRetryKey(k => k + 1) }}
            orbSize={100}
          />
        )}

        {/* 对话列表 */}
        {messages.map((m, i) =>
          m.role === 'assistant'
            ? <AiBubble key={i} text={m.content} />
            : <Fragment key={i}>
                <UserBubble
                  text={m.content}
                  onWordTap={(word) => setCapture({ heard: word, context: m.content, msgIndex: i })}
                  onPolish={() => {
                    const prev = messages[i - 1]
                    void handlePolish(m.content, prev?.role === 'assistant' ? prev.content : undefined)
                  }}
                />
                {capture?.msgIndex === i && (
                  <PronounceCapturePopup
                    heard={capture.heard}
                    onSave={handleSavePronunciation}
                    onClose={() => setCapture(null)}
                  />
                )}
              </Fragment>
        )}

        {/* 处理中提示 */}
        {phase === 'transcribing' && <UserBubble text="…" />}
        {phase === 'replying' && <AiBubble text="…" />}
        {error && phase === 'idle' && (
          <p className="text-center text-[12px] text-v2-text-muted mb-2">{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 遮罩 + 换个说法弹窗 */}
      {showPolish && <div className="fixed inset-0 z-[19]" onClick={() => setShowPolish(false)} />}
      {showPolish && (
        <RephrasePopup
          loading={polishLoading}
          result={polishResult}
          onClose={() => setShowPolish(false)}
          popupRef={popupRef}
        />
      )}


      {/* 底部输入区 */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-bg-page border-t border-black/[0.05] z-20 px-[14px]"
        style={{ paddingTop: 18, paddingBottom: 'max(18px, env(safe-area-inset-bottom))' }}
      >
        {/* 临近上限提示：常驻一行小字（Part 2 含"2 分钟喊停"，其余朴素） */}
        {nearLimit && (
          <div className="flex items-start gap-1.5 mb-2.5 px-1 text-[11px] leading-[1.4] text-warning">
            <Clock size={13} className="flex-shrink-0 mt-px" />
            <span>{capHint}</span>
          </div>
        )}

        <div className="flex items-center gap-[12px]">
          <button
            ref={orbRef}
            onClick={() => { if (polishResult) setShowPolish(true) }}
            aria-label="换个说法"
            className="flex-shrink-0 active:scale-[0.97] transition-transform duration-150"
          >
            <OrbSoft size={50} />
          </button>

          {phase === 'recording' ? (
            // 录音态：容器本身不可点，仅「×」取消与「发送」可点
            <div
              className="flex flex-1 items-center gap-[6px] pl-[8px] pr-[6px]"
              style={{ ...GRADIENT_BORDER_STYLE, height: 52, borderRadius: 9999 }}
            >
              <button
                onClick={onCancelRecord}
                aria-label="取消录音"
                className="flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center text-v2-text-muted active:scale-[0.97] transition-transform"
              >
                <X size={19} />
              </button>
              <VoiceBar audioLevel={audioLevel} />
              <span className={`text-[12px] font-medium flex-shrink-0 min-w-[28px] text-right ${nearLimit ? 'text-warning' : 'text-v2-text-muted'}`}>
                {recTime}
              </span>
              <button
                onClick={() => void handleUserTurn()}
                aria-label="发送"
                className="flex-shrink-0 w-[38px] h-[38px] btn-gradient-circle text-brand-primary"
              >
                <Send size={18} />
              </button>
            </div>
          ) : (
            // 空闲 / 处理态：点击说话胶囊
            <button
              className="flex flex-1 items-center justify-center gap-[9px] active:scale-[0.97] transition-transform duration-150 disabled:opacity-50"
              style={{ ...GRADIENT_BORDER_STYLE, height: 52, borderRadius: 9999 }}
              disabled={phase !== 'idle'}
              onClick={onStartRecord}
            >
              <Mic size={19} className="text-brand-primary" />
              <span className="text-[14px] font-medium text-v2-text-secondary">{micLabel}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PracticePage(): JSX.Element {
  return <Suspense><PracticeContent /></Suspense>
}
