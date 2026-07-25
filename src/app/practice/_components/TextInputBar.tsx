/**
 * @module   TextInputBar
 * @desc     练习页底部输入区在「改用文字输入」时的替换条 —— autoFocus 的多行 textarea + 「← 返回」（次）
 *           + 「发送」（GradientButton，空串禁用）。draft 由组件内部 useState 自持，只经 props 上抛
 *           onSubmit(trim 后非空)/onCancel。桌面在 textarea 自身 onKeyDown 处理 Cmd/Ctrl+Enter 提交、
 *           Esc 取消（stopPropagation 让位给 textarea、不与页面全局 keydown 双触发）。提交后走与转写
 *           成功完全相同的下游（外壳 sendReply）。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { type JSX, type KeyboardEvent, useState } from 'react'
import GradientButton from '@/components/GradientButton'

interface TextInputBarProps {
  /** 提交这段文字（外壳已保证 trim 非空才当作本轮发言） */
  onSubmit: (text: string) => void
  /** 返回失败双选 */
  onCancel: () => void
}

/**
 * 文字输入条。
 * @param onSubmit  「发送」回调，传当前草稿
 * @param onCancel  「返回」回调
 * @returns         底部输入区替换条
 */
export default function TextInputBar({ onSubmit, onCancel }: TextInputBarProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const canSend = draft.trim().length > 0

  const submit = (): void => {
    const t = draft.trim()
    if (t) onSubmit(t)
  }

  // 桌面快捷键在 textarea 自身处理并 stopPropagation：Cmd/Ctrl+Enter 提交、Esc 取消。
  // stopPropagation 避免 Esc 冒泡到页面全局 keydown 造成 onCancel 双触发。
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="把你想说的打在这里…"
        className="w-full min-h-[72px] resize-none bg-[#F4F4F4] rounded-[16px] px-4 py-3 text-[14px] text-v2-text-secondary placeholder:text-v2-text-muted outline-none"
      />
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onCancel}
          className="flex items-center justify-center min-h-[44px] py-2.5 px-3 text-[13px] text-v2-text-muted active:scale-[0.97] transition-transform"
        >
          ← 返回
        </button>
        <GradientButton
          onClick={submit}
          disabled={!canSend}
          className="px-6 py-3 rounded-full text-[14px] font-medium"
        >
          发送
        </GradientButton>
      </div>
    </div>
  )
}
