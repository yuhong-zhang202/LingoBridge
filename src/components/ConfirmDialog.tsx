/**
 * @module   ConfirmDialog
 * @desc     通用确认弹窗 —— 全屏遮罩 + 居中卡片，用于不可撤销的危险操作（如语料批量删除）二次确认。
 *           支持 Esc / 点遮罩取消、body 禁滚、loading 态（请求中禁用按钮并忽略取消）。
 *           模态 a11y 三件套照搬 SwapCorpusDialog：打开时焦点移入面板本身、Tab 焦点陷阱、关闭后把焦点
 *           还给触发它的那个按钮 —— 缺任何一件，键盘 / 读屏用户都会「弹窗弹了但焦点还留在背后列表上」，
 *           既听不到弹窗出现，Tab 又跑进被遮住的背景里，确认不了也取消不了。
 * @author   LingoBridge
 * @created  2026-07-07
 */
'use client'
import { useEffect, useId, useRef } from 'react'
import GradientButton from '@/components/GradientButton'
import { FOCUSABLE_SELECTOR } from '@/lib/focus-trap'

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
 * @sideEffect         打开时监听 Esc、锁定 body 滚动、把焦点移入面板；关闭时把焦点还给触发它的元素
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
  const panelRef = useRef<HTMLDivElement>(null)
  // 打开瞬间记下触发弹窗的那个元素，关闭时把焦点还回去
  const triggerRef = useRef<HTMLElement | null>(null)
  // 一个页面里可能同时挂着多个 ConfirmDialog 实例（如列表每张卡各带一个），标题 / 说明的 id 必须逐实例唯一，
  // 否则 aria-labelledby 会指到别的弹窗的标题上。
  const uid = useId()
  const titleId = `${uid}-confirm-title`
  const descId = `${uid}-confirm-desc`

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

  // 焦点移入【面板本身】而非首个按钮（照 SwapCorpusDialog）：程序化 focus 到按钮会点亮全局 :focus-visible
  // 橙焦点环，开屏即给按钮套一圈橙框。聚焦面板读屏照常播报 dialog 的标题与说明，Tab 一下即到按钮。
  // 关闭时把焦点还给触发它的元素；若该元素已随本次删除一起从 DOM 消失，就不强抢（见文件末尾「已知缺口」）。
  useEffect(() => {
    if (!open) return
    const el = document.activeElement
    triggerRef.current = el instanceof HTMLElement ? el : null
    panelRef.current?.focus()
    return () => {
      const back = triggerRef.current
      triggerRef.current = null
      if (back && document.body.contains(back)) back.focus()
    }
  }, [open])

  // Tab 焦点陷阱（照 SwapCorpusDialog）：不圈住的话，Tab 会把焦点送进被遮罩盖住的背景内容里，
  // 读屏用户在那儿既确认不了也取消不了。Esc 不在这里处理——上面的 window 捕获监听已经管了。
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const root = panelRef.current
    if (!root) return
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    if (items.length === 0) { e.preventDefault(); return }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    // active === root 这一支是对 SwapCorpusDialog 版本的补漏：弹窗打开时焦点落在面板本身，此刻按 Shift+Tab，
    // root.contains(root) 为真、又不等于 first，原写法会放行、焦点直接退到遮罩后面的背景里。
    if (e.shiftKey && (active === first || active === root || !root.contains(active))) {
      e.preventDefault(); last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault(); first.focus()
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => { if (!loading) onCancel() }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        style={{ outline: 'none' }}
        className="bg-white rounded-2xl px-6 py-5 max-w-[400px] w-full mx-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-[1rem] font-semibold text-v2-text-primary mb-2">{title}</h2>
        <p id={descId} className="text-[0.8125rem] text-v2-text-secondary mb-5 leading-relaxed">{description}</p>
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

/**
 * 关闭后焦点归还的边界（2026-08-08 更新）
 *
 * 本组件只负责「触发元素还在 DOM 里」这一种归还。删除场景里触发它的往往正是那张卡上的删除按钮，
 * 确认后整张卡随即卸载、触发元素不复存在，此时本组件刻意不抢焦点 —— 该由发起删除的那一方接手，
 * 因为只有它知道「下一张卡是谁」。
 *
 * 已接手：SwipeToDelete（左滑删除，覆盖素材库四个调用方）在确认回调里把焦点交给相邻的幸存卡，
 * 落点规则见 lib/focus-handoff.ts。
 * 尚未接手（焦点仍会掉回 <body>，键盘用户要从页首重新 Tab）：
 *   - src/app/library/MyCorpusTab.tsx 移动端卡右上角的删除入口；
 *   - useSelectMode 的桌面批量删除（确认后工具栏那颗「删除」按钮自己也没了）。
 * 两处都只需给卡片根元素加 data-delete-item + tabIndex={-1}，再照 SwipeToDelete.handleConfirm 调一次
 * pickFocusTarget 即可；本次未做是因为那些文件正被别的分支占用。
 */
