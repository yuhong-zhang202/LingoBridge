/**
 * @module   PracticePage
 * @desc     练习对话页 — 教练 Lior（千问 qwen-plus），录音转写后续聊，🔨 触发重新表达
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Mic } from 'lucide-react'
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

function PracticeContent(): JSX.Element {
  const router = useRouter()
  const params = useSearchParams()
  const questionId = params.get('questionId') ?? ''
  const storyId = params.get('storyId') ?? ''

  const [scaffold, setScaffold]           = useState<PracticeScaffold | null>(null)
  const [messages, setMessages]           = useState<PracticeMessage[]>([])
  const [phase, setPhase]                 = useState<'init' | 'idle' | 'recording' | 'transcribing' | 'replying' | 'error'>('init')
  const [error, setError]                 = useState<string | null>(null)
  const [showPolish, setShowPolish]       = useState(false)
  const [polishLoading, setPolishLoading] = useState(false)
  const [polishResult, setPolishResult]   = useState<PolishResult | null>(null)
  const [polishHistory, setPolishHistory] = useState<SessionPolish[]>([])

  const popupRef  = useRef<HTMLDivElement>(null)
  const orbRef    = useRef<HTMLButtonElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { start, stop } = useAudioRecorder()

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
          body: JSON.stringify({ questionId, storyId, messages: [] }),
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
        body: JSON.stringify({ sentence, aiQuestion }),
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

  const onPressStart = useCallback(() => {
    if (phase !== 'idle') return
    setError(null)
    setPhase('recording')
    void start()
  }, [phase, start])

  const onPressEnd = useCallback(() => {
    if (phase !== 'recording') return
    void handleUserTurn()
  }, [phase, handleUserTurn])

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

  const micLabel = phase === 'recording' ? '松开发送' : phase === 'transcribing' ? '转写中…' : phase === 'replying' ? '思考中…' : '按住说话'

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
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
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-bg-page border-t border-black/[0.05] z-20 flex items-center gap-[12px] px-[14px]"
        style={{ paddingTop: 18, paddingBottom: 'max(18px, env(safe-area-inset-bottom))' }}
      >
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
          onPointerDown={onPressStart}
          onPointerUp={onPressEnd}
          onPointerLeave={onPressEnd}
        >
          <Mic size={19} color="#D4875A" />
          <span className="text-[14px] font-medium text-[#444]">{micLabel}</span>
        </button>
      </div>
    </div>
  )
}

export default function PracticePage(): JSX.Element {
  return <Suspense><PracticeContent /></Suspense>
}
