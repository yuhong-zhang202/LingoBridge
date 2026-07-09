/**
 * @module   RestructureDesktop
 * @desc     整理确认页（桌面端）—— FlowShellDesktop 沉浸外壳内的两栏舞台：左「原话」+ 右「整理后」（可编辑），
 *           下方右对齐 CTA（重新整理 + 开始匹配/分析）。加载态居中 Orb，错误态重试。逻辑由 page.tsx 下发。
 * @author   LingoBridge
 * @created  2026-07-08
 */
'use client'
import { useEffect, useRef } from 'react'
import { Sparkles, Pencil, Check, RefreshCw } from 'lucide-react'
import Card from '@/components/Card'
import Orb from '@/components/Orb'
import Chip from '@/components/Chip'
import GradientButton from '@/components/GradientButton'
import type { RestructureViewProps } from './types'

export default function RestructureDesktop({
  rawStory, aiText, isEditing, isLoading, error, usable, isSaving, saveError, qid,
  onAiChange, onToggleEdit, onReRestructure, onMatch, onExit,
}: RestructureViewProps) {
  // 键盘（仅 ≥1024px 桌面断点生效；CSS 双挂载需按视口过滤，避免隐藏视图误触）：
  // ⌘/Ctrl+Enter = 主 CTA（非加载/错误/保存中才触发，避开裸 Enter 在 textarea 换行）；Esc = 退出（与 ✕ 一致）。
  const latest = useRef({ isLoading, error, isSaving, onMatch, onExit })
  latest.current = { isLoading, error, isSaving, onMatch, onExit }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return
      const t = e.target as HTMLElement | null
      // ② 编辑态：Esc 先退出编辑（blur），其余键让位给输入框（编辑中不用 ⌘Enter 提交）
      const editEl = t?.closest('input, textarea') as HTMLElement | null
      if (editEl) {
        if (e.key === 'Escape') editEl.blur()
        return
      }
      const s = latest.current
      if (e.key === 'Escape') { s.onExit(); return }   // ③ → requestExit（未保存弹确认）
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (!s.isLoading && !s.error && !s.isSaving) { e.preventDefault(); s.onMatch() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-72px)] flex flex-col items-center justify-center gap-4">
        <Orb size={160} />
        <p className="text-[14px] text-v2-text-muted">AI 正在整理你的故事…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-[calc(100vh-72px)] flex flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-[15px] text-error">{error}</p>
        <button
          onClick={onReRestructure}
          className="flex items-center gap-1.5 text-[14px] text-v2-text-secondary hover:text-v2-text-primary transition-colors"
        >
          <RefreshCw size={15} />重试
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-72px)] flex flex-col justify-center px-8 py-12">
      <div className="max-w-[960px] mx-auto w-full">

        {/* 旁白定调：温暖、口语、指路（左原话 / 右可改） */}
        <div className="mb-7 flex items-center justify-center gap-2 text-[13px] text-v2-text-muted">
          <Sparkles size={14} className="text-brand-accent" />
          <span>你刚才讲的我顺了一遍 · 左边是原话，右边可以直接改</span>
        </div>

        <div className="grid grid-cols-2 gap-7 items-start">

          {/* 左栏：原话（安静的参照） */}
          <div>
            <p className="mb-2.5 text-[12px] font-semibold tracking-[0.03em] text-v2-text-muted">原话</p>
            <Card className="px-7 py-6 min-h-[300px] flex flex-col justify-center">
              <p className="text-[15px] text-v2-text-secondary leading-[1.9]">{rawStory}</p>
            </Card>
          </div>

          {/* 右栏：整理后（主角，渐变描边 + 可编辑） */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.03em] text-brand-primary-dark">
                <Sparkles size={13} className="text-brand-accent" />整理后
              </span>
              <Chip onClick={onToggleEdit} variant="default">
                {isEditing ? <><Check size={12} />完成</> : <><Pencil size={12} />编辑</>}
              </Chip>
            </div>
            <Card variant="gradient" className="px-7 py-6 min-h-[300px] flex flex-col justify-center">
              {isEditing ? (
                <textarea
                  value={aiText}
                  onChange={e => onAiChange(e.target.value)}
                  aria-label="编辑整理后的故事"
                  className="w-full min-h-[240px] resize-none rounded-[14px] bg-bg-inner px-4 py-3 text-[16px] text-v2-text-primary leading-[1.9] outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                  autoFocus
                />
              ) : (
                <p className="text-[16px] text-v2-text-primary leading-[1.9]">{aiText}</p>
              )}
            </Card>
            {usable === false && (
              <p className="mt-2.5 text-[12px] text-v2-text-muted leading-relaxed">
                这段可以再丰富些，补点细节后面练习更有料；直接继续也行。
              </p>
            )}
          </div>
        </div>

        {/* 底部动作区：重新整理 + CTA（右对齐，与整理后一栏收口） */}
        <div className="mt-9 flex items-center justify-end gap-5">
          {saveError && <p className="text-[13px] text-error mr-auto">{saveError}</p>}
          <button
            onClick={onReRestructure}
            className="flex items-center gap-1.5 text-[13px] text-v2-text-muted hover:text-v2-text-primary transition-colors"
          >
            <RefreshCw size={14} />重新整理
          </button>
          <GradientButton
            onClick={onMatch}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-7 py-3 rounded-full text-[15px] font-medium"
          >
            {isSaving ? '保存中…' : qid ? '开始分析 →' : '开始匹配题目 →'}
          </GradientButton>
        </div>

        <p className="mt-4 text-center text-[12px] text-v2-text-muted">⌘/Ctrl + Enter 继续 · Esc 退出</p>
      </div>
    </div>
  )
}
