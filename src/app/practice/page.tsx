/**
 * @module   PracticePage
 * @desc     练习对话页 — 教练 Lior（千问 qwen-plus），录音转写后续聊，🔨 触发重新表达
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Mic, Clock } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import { setSessionPolishes } from '@/lib/storage'
import { recordPracticeSession } from '@/lib/db/practice-sessions'
import type { PracticeScaffold, PracticeMessage, PolishResult, SessionPolish } from '@/lib/types'
import OrbSoft from './_components/OrbSoft'
import AiBubble from './_components/AiBubble'
import UserBubble from './_components/UserBubble'
import RephrasePopup from './_components/RephrasePopup'
import VoiceBar from './_components/VoiceBar'

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
  }, [questionId, storyId])

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
      if (data.optimized) {
        setPolishHistory(h => [...h, {
          original: sentence,
          optimized: data.optimized,
          note: data.note,
          part: scaffold?.part ?? 1,
          questionEn: scaffold?.displayEn ?? '',
        }])
      }
    } catch {
      setPolishResult({ optimized: '', note: '优化失败，请重试' })
    } finally {
      setPolishLoading(false)
    }
  }, [scaffold])

  const onMicTap = useCallback(() => {
    if (phase === 'idle') {
      setError(null)
      setPhase('recording')
      void start()
    } else if (phase === 'recording') {
      void handleUserTurn()
    }
  }, [phase, start, handleUserTurn])

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
            className="text-[13px] text-[#AAAAAA]"
          >
            结束
          </button>
        }
      />
      <StepBar currentStep="practice" />

      {/* 题目条：固定在流程轴下方，不随对话滚动 */}
      <div className="flex-shrink-0 px-5 pt-2 pb-3">
        <div className="flex items-center gap-2 bg-[#F7F5F1] border border-black/[0.05] rounded-[8px] px-[11px] py-[6px]">
          <span className="text-[11px] text-[#AAAAAA] flex-shrink-0">Part {scaffold?.part ?? 1}</span>
          <div className="w-px h-3 bg-[#DDDDDD] flex-shrink-0" />
          <span className="text-[12px] font-medium text-[#444] flex-1 truncate min-w-0">
            {scaffold?.displayEn ?? '加载中…'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-0 pb-[100px] relative z-10">
        {phase === 'init' && (
          <div className="text-center text-[13px] text-v2-text-muted py-16">教练正在准备…</div>
        )}
        {phase === 'error' && (
          <div className="text-center text-[13px] text-v2-text-muted py-16">{error}</div>
        )}

        {/* 对话列表 */}
        {messages.map((m, i) =>
          m.role === 'assistant'
            ? <AiBubble key={i} text={m.content} />
            : <UserBubble
                key={i}
                text={m.content}
                onPolish={() => {
                  const prev = messages[i - 1]
                  void handlePolish(m.content, prev?.role === 'assistant' ? prev.content : undefined)
                }}
              />
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
          <div className="flex items-start gap-1.5 mb-2.5 px-1 text-[11.5px] leading-[1.4] text-warning">
            <Clock size={13} className="flex-shrink-0 mt-px" />
            <span>{capHint}</span>
          </div>
        )}

        <div className="flex items-center gap-[12px]">
          <button
            ref={orbRef}
            onClick={() => { if (polishResult) setShowPolish(true) }}
            aria-label="换个说法"
            className="flex-shrink-0 active:scale-[0.94] transition-transform duration-150"
          >
            <OrbSoft size={50} />
          </button>

          <button
            className="flex flex-1 items-center justify-center gap-[9px] active:scale-[0.97] transition-transform duration-150 disabled:opacity-60"
            style={{ ...GRADIENT_BORDER_STYLE, height: 52, borderRadius: 9999 }}
            disabled={phase !== 'idle' && phase !== 'recording'}
            onClick={onMicTap}
          >
            {phase === 'recording' ? (
              <div className="flex flex-1 items-center gap-[9px] px-[14px]">
                <span className="w-[14px] h-[14px] rounded-[4px] bg-brand-primary flex-shrink-0" />
                <VoiceBar audioLevel={audioLevel} />
                <span className={`text-[12px] font-medium flex-shrink-0 min-w-[30px] text-right ${nearLimit ? 'text-warning' : 'text-v2-text-muted'}`}>
                  {recTime}
                </span>
              </div>
            ) : (
              <>
                <Mic size={19} className="text-brand-primary" />
                <span className="text-[14px] font-medium text-[#444]">{micLabel}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PracticePage(): JSX.Element {
  return <Suspense><PracticeContent /></Suspense>
}
