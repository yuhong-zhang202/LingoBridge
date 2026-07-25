/**
 * @module   AnkiRegisterGate
 * @desc     Anki 存对子的「匿名 → 注册引导」小模态：匿名用户在匹配页 / 整理页点「存题卡」时后端返 401，
 *           前端不裸露错误，改弹本模态引导注册。复用 QuotaReached 的模态外壳范式（Orb + role=dialog +
 *           aria-modal + 焦点移入/陷阱 + Esc 关闭），文案聚焦「存题卡需要注册」。
 *           主 CTA「注册 / 登录」→ /login；次「再看看」关闭回到当前页（内容不丢）。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Orb from '@/components/Orb'
import GradientButton from '@/components/GradientButton'

interface Props {
  /** 关闭（点遮罩 / Esc / 「再看看」）：回到当前页，用户输入与匹配结果均不受影响。 */
  onClose: () => void
}

export default function AnkiRegisterGate({ onClose }: Props) {
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)

  /** 面板内可聚焦元素（随渲染实时查询）。 */
  const focusables = (): HTMLElement[] => {
    const root = panelRef.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])'))
  }

  // 打开即把焦点移入首个 CTA：键盘/读屏用户否则仍停在被遮罩的背景页上。
  useEffect(() => { focusables()[0]?.focus() }, [])

  // Esc 关闭 + Tab 焦点陷阱：模态期间焦点不得逃逸到被遮罩的背景页（照 QuotaReached）。
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab') return
    const items = focusables()
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
      e.preventDefault(); last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault(); first.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="anki-gate-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[360px] bg-bg-surface rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] animate-fade-up"
      >
        <div className="flex flex-col items-center text-center px-6 py-10">
          <Orb size={120} pulse={false} />
          <h2 id="anki-gate-title" className="text-[15px] font-medium text-v2-text-primary mt-5">存题卡需要注册</h2>
          <p className="text-[13px] text-v2-text-secondary mt-2 max-w-[260px] leading-relaxed">
            题卡会按你的目标分持续帮你复习，注册后就能把这道题存下来、随时回看。
          </p>
          <div className="flex flex-col items-center gap-2.5 mt-5">
            <GradientButton
              onClick={() => router.push('/login')}
              className="px-6 py-3 rounded-full text-[14px] font-medium"
            >
              注册 / 登录
            </GradientButton>
            <button
              onClick={onClose}
              className="min-h-[44px] inline-flex items-center justify-center px-3 text-[13px] font-medium text-v2-text-muted active:opacity-60"
            >
              再看看
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
