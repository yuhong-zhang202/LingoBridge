/**
 * @module   Error (route boundary)
 * @desc     核心流程崩溃兜底页：重试 / 返回首页 / 反馈（反馈自动带上路由与错误信息）
 * @author   LingoBridge
 * @created  2026-06-12
 */
'use client'
import { type JSX, useState } from 'react'
import { RefreshCw, MessageSquare } from 'lucide-react'
import Orb from '@/components/Orb'
import GradientButton from '@/components/GradientButton'
import { submitFeedback } from '@/lib/db/feedback'

export default function Error({ error, reset }: { error: Error; reset: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)

  const send = async (): Promise<void> => {
    const msg = text.trim()
    if (!msg || sending) return
    setSending(true)
    setFailed(false)
    try {
      await submitFeedback({
        kind: 'crash',
        message: msg,
        context: {
          route: typeof window !== 'undefined' ? window.location.pathname : '',
          errorMessage: error.message,
        },
      })
      setSent(true)
    } catch {
      setFailed(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-dvh bg-bg-page flex flex-col items-center justify-center px-7 text-center">
      <Orb size={80} pulse={false} />
      <p className="text-[1.1875rem] font-medium text-v2-text-primary mt-6">哎呀，卡了一下</p>
      <p className="text-[0.8125rem] text-v2-text-muted mt-2.5 max-w-[228px] leading-relaxed">
        重试一下，或回首页重新开始。你的内容都还在。
      </p>

      {/* 重试：圆角矩形渐变按钮 */}
      <GradientButton
        onClick={reset}
        className="mt-7 w-full max-w-[280px] flex items-center justify-center gap-1.5 rounded-[14px] py-3.5 text-[0.875rem] font-medium"
      >
        <RefreshCw size={15} />重试
      </GradientButton>

      {/* 返回首页：文字 */}
      <button
        onClick={() => { window.location.href = '/' }}
        className="mt-3.5 text-[0.8125rem] text-v2-text-muted active:opacity-60"
      >
        返回首页
      </button>

      {/* 反馈：文字链接 → 展开输入 */}
      {sent ? (
        <p className="mt-7 text-[0.8125rem] text-brand-accent">已收到，谢谢</p>
      ) : !open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-7 inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-accent underline underline-offset-[3px] active:opacity-60"
        >
          <MessageSquare size={14} />反馈
        </button>
      ) : (
        <div className="mt-7 w-full max-w-[280px]">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            placeholder="发生了什么？写一句给我们"
            className="w-full rounded-[12px] border border-black/[0.08] bg-white px-3.5 py-3 text-[1rem] lg:text-[0.8125rem] text-v2-text-primary placeholder:text-v2-text-muted resize-none outline-none focus:border-black/[0.16]"
          />
          <GradientButton
            onClick={() => void send()}
            disabled={!text.trim() || sending}
            className="mt-2.5 w-full rounded-[12px] py-2.5 text-[0.8125rem] font-medium"
          >
            {sending ? '发送中…' : '发送'}
          </GradientButton>
          {failed && <p className="mt-1.5 text-[0.75rem] text-error">没发出去，再试一次</p>}
        </div>
      )}
    </div>
  )
}
