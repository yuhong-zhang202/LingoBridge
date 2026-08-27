/**
 * @module   WriteDesktop
 * @desc     文字模式「故事」页桌面视图（focus 档）—— FlowShellDesktop 沉浸外壳内 max-w-[600px] 居中写作舞台：
 *           引导标题 +（?qid 时的题目 context caption）+ 舒适大 textarea + 实时字数 + 居中动作簇（改用录音 / 提交）。
 *           气质对齐 RecordingDesktop 的安静专注；本页禁用 ambient-light、统一 bg-bg-page 单一底色。纯展示，状态经 props。
 *           桌面独有：⌘/Ctrl+Enter 提交、Esc 退出、进页面自动聚焦、按钮 hover 浮起。
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { type JSX, useEffect, useRef } from 'react'
import { Mic2 } from 'lucide-react'
import GradientButton from '@/components/GradientButton'
import { storySubmitLabel } from '@/components/StoryTextPanel'
import { WRITE_PLACEHOLDER, type WriteViewProps } from './types'

/** 舞台高度：满屏减去外壳 72px 顶栏 */
const STAGE = 'h-[calc(100vh-72px)]'

export default function WriteDesktop({
  textStory, onChangeText, canSubmit, submitting, onSubmit, onSwitchToVoice, questionContext, qid, onExit,
}: WriteViewProps): JSX.Element {

  // 键盘：⌘/Ctrl+Enter 提交（canSubmit 时）、Esc 退出。仅 ≥1024px 生效（CSS 双挂载，需按视口过滤）。
  // Cmd+Enter 刻意允许从 textarea 内触发，故不拦截 INPUT/TEXTAREA。用 ref 持最新值，监听只订阅一次。
  const latest = useRef({ canSubmit, submitting, onSubmit, onExit })
  latest.current = { canSubmit, submitting, onSubmit, onExit }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return
      const t = e.target as HTMLElement | null
      const s = latest.current
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        // ⌘/Ctrl+Enter 刻意允许从 textarea 内提交，故不拦截输入框
        if (s.canSubmit && !s.submitting) { e.preventDefault(); s.onSubmit() }
      } else if (e.key === 'Escape') {
        // ② 编辑中先退出编辑（blur），不退页；③ 焦点不在输入框才退出（未保存由外壳 requestExit 弹确认）
        const el = t?.closest('textarea') as HTMLElement | null
        if (el) { el.blur(); return }
        s.onExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`${STAGE} overflow-y-auto flex flex-col items-center px-8`}>
      <div className="w-full max-w-[600px] my-auto py-10">

        {/* 引导标题 + 副文案 */}
        <div className="mb-6 text-center">
          <h1 className="text-[1.5rem] font-bold text-v2-text-primary tracking-tight">说说你的故事</h1>
          <p className="mt-2.5 text-[0.875rem] text-v2-text-secondary leading-relaxed">
            不用背模板。把发生过的事讲出来，我们帮你理清逻辑、补上地道表达，再匹配到合适的雅思口语题。
          </p>
        </div>

        {/* ?qid 题目上下文 caption */}
        {questionContext && (
          <div className="mb-5">
            <div className="flex items-center gap-2 bg-bg-page border border-black/[0.05] rounded-[8px] px-[11px] py-[6px]">
              <span className="text-[0.6875rem] text-v2-text-muted flex-shrink-0">Part {questionContext.part}</span>
              <div className="w-px h-3 bg-black/10 flex-shrink-0" />
              <span className="text-[0.75rem] font-medium text-v2-text-secondary flex-1 truncate min-w-0">{questionContext.en}</span>
            </div>
          </div>
        )}

        {/* 写作 surface：舒适大 textarea + 右下实时字数 */}
        <div className="bg-bg-surface border border-black/[0.06] rounded-[18px] pt-5 px-5 pb-3.5 transition-colors focus-within:border-brand-primary">
          <textarea
            value={textStory}
            onChange={e => onChangeText(e.target.value)}
            placeholder={WRITE_PLACEHOLDER}
            aria-label="写下你的故事"
            autoFocus
            className="w-full min-h-[260px] resize-none bg-transparent outline-none text-[1rem] lg:text-[0.9375rem] leading-[1.85] text-v2-text-primary placeholder:text-v2-text-muted"
          />
          <div className="flex items-center justify-end pt-3 border-t border-black/[0.05]">
            <span className="text-[0.75rem] text-v2-text-muted tabular-nums">{textStory.trim().length} 字</span>
          </div>
        </div>

        {/* 动作簇（居中）：改用录音 + 提交 */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <div className="flex items-center gap-6">
            <button
              onClick={onSwitchToVoice}
              className="inline-flex items-center gap-1.5 text-[0.875rem] text-v2-text-muted hover:text-v2-text-secondary hover:-translate-y-[1px] transition-[color,transform] duration-200"
            >
              <Mic2 size={15} />改用录音
            </button>
            <GradientButton
              onClick={onSubmit}
              disabled={!canSubmit}
              loading={submitting}
              className="inline-flex items-center gap-2 px-7 py-3 rounded-full text-[0.9375rem] font-medium transition-[transform,box-shadow] duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_22px_rgba(0,0,0,0.09)]"
            >
              {/* 文案 = 这一步的真实落点（a581b18 后文字路径不再经整理页）：
                  有 qid → /analysis「开始分析」，无 qid → /matching「开始匹配题目」。
                  与整理确认页 CTA 同一份真源（storySubmitLabel），两个入口不许各说各话。 */}
              {storySubmitLabel(qid, submitting)}
            </GradientButton>
          </div>
          <p className="text-[0.75rem] text-v2-text-muted">⌘/Ctrl + Enter 提交 · Esc 退出</p>
        </div>
      </div>
    </div>
  )
}
