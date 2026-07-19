/**
 * @module   WriteMobile
 * @desc     文字模式「故事」页移动端视图 —— 极简 TopBar（返回）+ ?qid 题目 caption + 共享 <StoryTextPanel>。
 *           无 TabBar（产出内容页）。纯展示，状态/回调经 props；文字面板视觉与逻辑收进 StoryTextPanel 单一实现。
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { type JSX } from 'react'
import { ChevronLeft } from 'lucide-react'
import StoryTextPanel from '@/components/StoryTextPanel'
import type { WriteViewProps } from './types'

export default function WriteMobile({
  textStory, onChangeText, canSubmit, submitting, onSubmit, onSwitchToVoice, questionContext, onExit,
}: WriteViewProps): JSX.Element {
  return (
    <div
      className="relative h-dvh bg-bg-page flex flex-col overflow-hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* 极简 TopBar：返回 */}
      <div className="flex-shrink-0 flex items-center justify-between h-[52px] px-5 relative z-10">
        <button
          onClick={onExit}
          aria-label="返回"
          className="w-[30px] h-[30px] rounded-full bg-bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex items-center justify-center"
        >
          <ChevronLeft size={15} className="text-v2-text-secondary" />
        </button>
        <span className="text-[15px] font-semibold text-v2-text-primary">写下你的故事</span>
        <div className="w-[30px]" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-5 pb-[120px] relative z-10">
        {/* ?qid 题目上下文 caption */}
        {questionContext && (
          <div className="mb-4">
            <div className="flex items-center gap-2 bg-bg-page border border-black/[0.05] rounded-[8px] px-[11px] py-[6px]">
              <span className="text-[11px] text-v2-text-muted flex-shrink-0">Part {questionContext.part}</span>
              <div className="w-px h-3 bg-black/10 flex-shrink-0" />
              <span className="text-[12px] font-medium text-v2-text-secondary flex-1 truncate min-w-0">{questionContext.en}</span>
            </div>
          </div>
        )}

        {/* 文字面板（共享组件；改用录音 = 跳 /recording，由外壳注入） */}
        <StoryTextPanel
          value={textStory}
          onChange={onChangeText}
          canSubmit={canSubmit}
          submitting={submitting}
          onSubmit={onSubmit}
          onSwitchToVoice={onSwitchToVoice}
        />
      </div>
    </div>
  )
}
