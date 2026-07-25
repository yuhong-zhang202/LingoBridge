/**
 * @module   SwapCorpusDialog
 * @desc     换语料对比弹窗：某题已存过对子、再存别的语料时后端返 409（ANKI_ALREADY_BOUND），前端弹本弹窗
 *           让用户对比「当前已绑语料」vs「这次要换的新语料」，确认是否换。一题一语料（方案 §6）。
 *           模态外壳照 QuotaReached（role=dialog + aria-modal + 焦点移入/陷阱 + Esc 关闭）。
 *           上下两 <Card> 对比：当前语料（gray Tag）/ 新语料（green Tag）的一句话概括；一句提示
 *           「换语料会用新语料重新生成、原来的被替换」。主 CTA <GradientButton>换成新语料</> → 调用方 PUT；
 *           次「保留当前」关闭不变。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { useEffect, useRef } from 'react'
import Card from '@/components/Card'
import Tag from '@/components/Tag'
import GradientButton from '@/components/GradientButton'

interface Props {
  /** 当前已绑语料（409 响应 currentCorpus）。summary 为 null 时降级中性占位。 */
  currentCorpus: { id: string; summary: string | null }
  /** 这次要换成的新语料。summary 为 null（如匹配页拿不到概括）时降级中性占位。 */
  newCorpus: { id: string; summary: string | null }
  /** 换语料请求进行中（禁用按钮 + 主 CTA 转「换语料中…」）。 */
  swapping: boolean
  /** 确认换成新语料：调用方发 PUT /api/anki/cards/corpus 并处理成功/失败。 */
  onSwap: () => void
  /** 保留当前（点遮罩 / Esc / 次按钮）：关闭弹窗，不做任何改动。 */
  onKeepCurrent: () => void
}

/** 语料概括占位：空概括时给中性文案，不露 id、不空着。 */
function summaryText(summary: string | null): string {
  const s = summary?.trim()
  return s && s !== '' ? s : '（这条语料还没有概括）'
}

export default function SwapCorpusDialog({ currentCorpus, newCorpus, swapping, onSwap, onKeepCurrent }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  const focusables = (): HTMLElement[] => {
    const root = panelRef.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])'))
  }

  useEffect(() => { focusables()[0]?.focus() }, [])

  // Esc 关闭 + Tab 焦点陷阱（照 QuotaReached）。换语料进行中仍允许关闭键（请求已发出，关闭只收起 UI）。
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onKeepCurrent(); return }
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
      onClick={onKeepCurrent}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="swap-corpus-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[380px] bg-bg-surface rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] animate-fade-up px-6 py-7"
      >
        <h2 id="swap-corpus-title" className="text-[16px] font-semibold text-v2-text-primary text-center">
          这道题已经存过语料
        </h2>
        <p className="text-[13px] text-v2-text-secondary text-center mt-2 leading-relaxed">
          换语料会用新语料重新生成这道题的例句，原来的会被替换。
        </p>

        <div className="flex flex-col gap-3 mt-5">
          <Card className="px-4 py-3.5">
            <Tag variant="gray" label="当前语料" />
            <p className="text-[14px] text-v2-text-secondary leading-relaxed mt-2">{summaryText(currentCorpus.summary)}</p>
          </Card>
          <Card variant="gradient" className="px-4 py-3.5">
            <Tag variant="green" label="新语料" />
            <p className="text-[14px] text-v2-text-primary leading-relaxed mt-2">{summaryText(newCorpus.summary)}</p>
          </Card>
        </div>

        <div className="flex flex-col items-center gap-2.5 mt-6">
          <GradientButton
            onClick={onSwap}
            loading={swapping}
            className="w-full px-6 py-3 rounded-full text-[14px] font-medium"
          >
            {swapping ? '换语料中…' : '换成新语料'}
          </GradientButton>
          <button
            onClick={onKeepCurrent}
            disabled={swapping}
            className="min-h-[44px] inline-flex items-center justify-center px-3 text-[13px] font-medium text-v2-text-muted active:opacity-60 disabled:opacity-50"
          >
            保留当前
          </button>
        </div>
      </div>
    </div>
  )
}
