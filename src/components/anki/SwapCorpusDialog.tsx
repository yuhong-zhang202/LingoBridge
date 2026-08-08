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
import { useEffect, useRef, useState } from 'react'
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

/** 超过此字数视为「长语料」，默认折叠 + 「查看更多」展开（3 行 ≈ 60 中文字，留余量取 60）。 */
const SUMMARY_CLAMP_CHARS = 60

/**
 * 语料文本（长文折叠）：≤阈值直接全显；超长默认 line-clamp-3，尾部给「查看更多/收起」切换。
 * 用字数判断而非测量 DOM（弹窗内容短平快，不值得上 ResizeObserver）。
 */
function CorpusSummary({ text, className }: { text: string; className: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > SUMMARY_CLAMP_CHARS
  return (
    <div className="mt-2">
      <p className={`${className} leading-relaxed ${isLong && !expanded ? 'line-clamp-3' : ''}`}>{text}</p>
      {isLong && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
          className="mt-1 min-h-[32px] text-[0.75rem] font-medium text-brand-primary-dark active:opacity-60"
          aria-expanded={expanded}
        >
          {expanded ? '收起' : '查看更多'}
        </button>
      )}
    </div>
  )
}

export default function SwapCorpusDialog({ currentCorpus, newCorpus, swapping, onSwap, onKeepCurrent }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  const focusables = (): HTMLElement[] => {
    const root = panelRef.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])'))
  }

  // 焦点移入【面板本身】而非首个按钮：程序化 focus 到按钮会点亮全局 :focus-visible 橙焦点环，
  // 开屏即给主 CTA 套一圈橙框（产品方点名去掉）。聚焦面板读屏照常播报 dialog，Tab 一下即到按钮。
  useEffect(() => { panelRef.current?.focus() }, [])

  // Esc 关闭 + Tab 焦点陷阱（照 QuotaReached）。换语料进行中仍允许关闭键（请求已发出，关闭只收起 UI）。
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onKeepCurrent(); return }
    if (e.key !== 'Tab') return
    const root = panelRef.current
    if (!root) return
    const items = focusables()
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    // active === root 这一支（2026-08-08 补，与 ConfirmDialog 同源）：弹窗刚打开时焦点落在面板本身，
    // 此刻按 Shift+Tab，root.contains(root) 为真、又不等于 first，原写法直接放行 —— 焦点退到遮罩后面的
    // 背景里，之后再按 Tab 都在用户既看不见也点不到的东西上转圈，确认不了也取消不了，只能离开页面。
    if (e.shiftKey && (active === first || active === root || !root.contains(active))) {
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
        tabIndex={-1}
        style={{ outline: 'none' }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[380px] bg-bg-surface rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] animate-fade-up px-6 py-7"
      >
        <h2 id="swap-corpus-title" className="text-[1rem] font-semibold text-v2-text-primary text-center">
          这道题已经存过语料
        </h2>
        <p className="text-[0.8125rem] text-v2-text-secondary text-center mt-2 leading-relaxed">
          换语料会用新语料重新生成这道题的例句，原来的会被替换。
        </p>

        <div className="flex flex-col gap-3 mt-5">
          <Card className="px-4 py-3.5">
            <Tag variant="gray" label="当前语料" />
            <CorpusSummary text={summaryText(currentCorpus.summary)} className="text-[0.875rem] text-v2-text-secondary" />
          </Card>
          <Card variant="gradient" className="px-4 py-3.5">
            <Tag variant="green" label="新语料" />
            <CorpusSummary text={summaryText(newCorpus.summary)} className="text-[0.875rem] text-v2-text-primary" />
          </Card>
        </div>

        <div className="flex flex-col items-center gap-2.5 mt-6">
          <GradientButton
            onClick={onSwap}
            loading={swapping}
            className="w-full px-6 py-3 rounded-full text-[0.875rem] font-medium"
          >
            {swapping ? '换语料中…' : '换成新语料'}
          </GradientButton>
          <button
            onClick={onKeepCurrent}
            disabled={swapping}
            className="min-h-[44px] inline-flex items-center justify-center px-3 text-[0.8125rem] font-medium text-v2-text-muted active:opacity-60 disabled:opacity-50"
          >
            保留当前
          </button>
        </div>
      </div>
    </div>
  )
}
