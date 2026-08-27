/**
 * @module   StoryTextPanel
 * @desc     故事「文字输入」共用面板 —— textarea + 底部（改用录音 + 提交圆钮）+ 丰富度 SegmentDots + 「试着带到」提示。
 *           class 串 / 元素顺序 / autoFocus 与首页原 textPanel 逐字一致（为首页迁移到本组件后字节不变铺路）。
 *           ⚠️【2026-08-27 起，提交钮的 aria-label 刻意不再「逐字一致」】原值写死「语料梳理」，
 *           而 a581b18 之后文字路径【不再经过整理确认页】，点下去直接到 /analysis 或 /matching ——
 *           那句标签描述的是一个对文字路径已经不存在的步骤。逐字一致是为了保真视觉与结构，
 *           不是为了保留一句过期的话；故此处改为按 qid 派生（真源见下方 storySubmitLabel）。
 *           差异用 props 保留：「改用录音」语义由 onSwitchToVoice 注入、外层 animate-fade-up 由 fadeUp 控制、
 *           placeholder / minH 可覆盖。丰富度经 computeRichness 单一真源计算。
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { type JSX } from 'react'
import { Mic2, ArrowRight, Loader2 } from 'lucide-react'
import SegmentDots from '@/app/question-bank/SegmentDots'
import { computeRichness } from '@/lib/story-richness'

/** 文字面板占位文案（单一真源；可被 placeholder prop 覆盖） */
export const WRITE_PLACEHOLDER =
  '用中文聊聊最近的一件小事，尽量说具体些……\n\n和谁一起、做了什么、当时心里什么感觉，都可以写进来。'

/**
 * 文字提交按钮的动作名（不带箭头，供 aria-label 用）—— 描述【点下去之后真正会发生什么】。
 * 与整理确认页 CTA 同一套词（RestructureMobile/Desktop），因为文字路径跳过整理页后，
 * 这个按钮承接的正是那一页 CTA 的落点：qid 非空 → /analysis，为空 → /matching。
 * @param  qid  雅思题 id（首页=雅思模式当前题；/write=?qid），无则 null
 * @returns     动作名文案
 */
export function storySubmitAction(qid: string | null): string {
  return qid ? '开始分析' : '开始匹配题目'
}

/**
 * 文字提交按钮的可见文案（与整理确认页 CTA 逐字一致，含尾部箭头）。
 * @param  qid         同 storySubmitAction
 * @param  submitting  提交进行中
 * @returns            按钮文案
 */
export function storySubmitLabel(qid: string | null, submitting: boolean): string {
  return submitting ? '保存中…' : `${storySubmitAction(qid)} →`
}

interface StoryTextPanelProps {
  value: string
  onChange: (v: string) => void
  /** 是否可提交（一般传 computeRichness(value).canSubmit） */
  canSubmit: boolean
  submitting: boolean
  onSubmit: () => void
  /** 「改用录音」语义由调用方注入（首页=切回 CTA；/write=跳 /recording） */
  onSwitchToVoice: () => void
  /**
   * 雅思题 id（首页=雅思模式当前题；/write=?qid），无则 null。
   * 【只用来决定提交钮 aria-label 说什么】，不参与任何行为。
   * 必须由调用方用 prop 传入、与它交给 useStorySubmit 的那个 qid 同源 ——
   * 本组件是纯展示件，绝不自己去读 URL（那会让它产生路由依赖，且首页的 qid 根本不在 URL 里）。
   */
  qid?: string | null
  /** textarea 最小高度类（默认 min-h-[244px]，对齐首页移动端） */
  minH?: string
  placeholder?: string
  /** 外层是否加 animate-fade-up（首页移动端为 true） */
  fadeUp?: boolean
}

export default function StoryTextPanel({
  value,
  onChange,
  canSubmit,
  submitting,
  onSubmit,
  onSwitchToVoice,
  qid = null,
  minH = 'min-h-[244px]',
  placeholder = WRITE_PLACEHOLDER,
  fadeUp = false,
}: StoryTextPanelProps): JSX.Element {
  const { richnessFilled, isRich, richState } = computeRichness(value)

  return (
    <div className={fadeUp ? 'w-full animate-fade-up' : 'w-full'}>
      <div className="w-full bg-bg-surface border border-black/[0.06] rounded-[18px] pt-[18px] px-4 pb-[13px] transition-colors focus-within:border-brand-primary">
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full ${minH} resize-none bg-transparent outline-none text-[1rem] leading-[1.85] text-v2-text-primary placeholder:text-v2-text-muted`}
          autoFocus
        />
        <div className="flex items-center justify-between pt-[11px] border-t border-black/[0.05]">
          <button onClick={onSwitchToVoice} className="flex items-center gap-1.5 text-[0.8125rem] text-v2-text-muted hover:opacity-70 active:opacity-60">
            <Mic2 size={15} />改用录音
          </button>
          <button
            disabled={!canSubmit || submitting}
            onClick={onSubmit}
            aria-label={storySubmitAction(qid)}
            className={canSubmit && !submitting ? 'btn-gradient-circle w-[42px] h-[42px]' : 'flex items-center justify-center w-[42px] h-[42px] rounded-full bg-bg-muted cursor-not-allowed'}
          >
            {submitting ? <Loader2 size={18} className="text-v2-text-muted animate-spin" /> : <ArrowRight size={18} className={canSubmit ? 'text-brand-primary-dark' : 'text-v2-text-muted'} />}
          </button>
        </div>
      </div>
      <div className="mt-[22px] px-1">
        <div className="flex items-baseline justify-between mb-[11px]">
          <span className="text-[0.75rem] text-v2-text-muted tracking-[0.3px]">丰富度</span>
          <span className={`text-[0.8125rem] ${isRich ? 'text-brand-accent font-medium' : 'text-v2-text-secondary'}`}>{richState}</span>
        </div>
        <SegmentDots total={18} filled={richnessFilled} />
      </div>
      <div className="mt-4 px-1 text-[0.75rem] leading-[1.7] text-v2-text-muted">
        试着带到：<span className="text-v2-text-secondary font-medium">时间 · 人物 · 发生的事 · 你的做法和感受</span>
      </div>
    </div>
  )
}
