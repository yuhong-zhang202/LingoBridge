/**
 * @module   ConfirmDialog
 * @desc     通用确认弹窗 —— 全屏遮罩 + 居中卡片，用于不可撤销的危险操作（如语料批量删除）二次确认。
 *           支持 Esc / 点遮罩取消、body 禁滚、loading 态（请求中禁用按钮并忽略取消）。
 * @author   LingoBridge
 * @created  2026-07-07
 */
'use client'
import { useEffect } from 'react'
import GradientButton from '@/components/GradientButton'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  /** true 时确认按钮用 error 红 */
  danger?: boolean
  /** 请求进行中：禁用两个按钮、忽略 Esc/点遮罩，确认按钮改显 loadingText */
  loading?: boolean
  /** loading 态确认按钮文案。默认中性的「处理中…」，删除场景可传「删除中…」 */
  loadingText?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 确认弹窗
 * @param open         是否显示
 * @param title        标题（兼作 aria-labelledby 目标）
 * @param description  说明文案
 * @param danger       危险操作（确认按钮红色）
 * @param loading      请求进行中（锁定交互）
 * @param loadingText  loading 态确认按钮文案，默认「处理中…」
 * @param onConfirm    点确认
 * @param onCancel     点取消 / Esc / 点遮罩
 * @sideEffect         打开时监听 Esc、锁定 body 滚动
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认删除',
  cancelText = '取消',
  danger = false,
  loading = false,
  loadingText = '处理中…',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Esc 取消（loading 时忽略）。捕获阶段 + stopImmediatePropagation：先于并拦截外层（如 useSelectMode）的 Esc 监听，
  // 避免确认框打开时按 Esc 同时退出选择模式 / 清空已选。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      if (!loading) onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, loading, onCancel])

  // 打开时锁定 body 滚动
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => { if (!loading) onCancel() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="bg-white rounded-2xl px-6 py-5 max-w-[400px] w-full mx-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-[1rem] font-semibold text-v2-text-primary mb-2">{title}</h2>
        <p className="text-[0.8125rem] text-v2-text-secondary mb-5 leading-relaxed">{description}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-full text-[0.8125rem] text-v2-text-muted hover:bg-bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          {danger ? (
            // 破坏性操作保留红底纯色填充（bg-error），作为视觉警示——产品方明确要求不归位到渐变描边
            <button
              onClick={onConfirm}
              disabled={loading}
              className="px-4 py-2 rounded-full text-[0.8125rem] text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed bg-error"
            >
              {loading ? loadingText : confirmText}
            </button>
          ) : (
            <GradientButton
              onClick={onConfirm}
              loading={loading}
              className="px-4 py-2 rounded-full text-[0.8125rem] font-medium disabled:cursor-not-allowed"
            >
              {loading ? loadingText : confirmText}
            </GradientButton>
          )}
        </div>
      </div>
    </div>
  )
}
