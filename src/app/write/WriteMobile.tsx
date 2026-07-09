/**
 * @module   WriteMobile
 * @desc     文字模式「故事」页移动端视图 —— 视觉沿用首页文字面板（textarea + 改用录音 + 提交圆钮 + 丰富度）。
 *           极简 TopBar（返回），无 TabBar（产出内容页）。纯展示，状态/回调经 props。
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { ChevronLeft, Mic2, ArrowRight, Loader2 } from 'lucide-react'
import SegmentDots from '@/app/question-bank/SegmentDots'
import { WRITE_PLACEHOLDER, type WriteViewProps } from './types'

export default function WriteMobile({
  textStory, onChangeText, canSubmit, submitting, onSubmit, onSwitchToVoice, questionContext, onExit,
}: WriteViewProps): JSX.Element {
  // 丰富度派生（沿用首页文字面板算法）
  const len = textStory.trim().length
  const pct = Math.min(100, (len / 90) * 100)
  const richnessFilled = Math.round((pct / 100) * 18)
  const isRich = pct >= 80
  const richState =
    len === 0   ? '越具体匹配越准' :
    pct < 30    ? '还比较简单，多展开一些' :
    pct < 80    ? '渐入佳境，再补点细节' :
                  '很丰富啦 ✨ 可以开始匹配'

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
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

        {/* 文字面板（沿用首页 textPanel 视觉） */}
        <div className="w-full">
          <div className="w-full bg-bg-surface border border-black/[0.06] rounded-[18px] pt-[18px] px-4 pb-[13px]">
            <textarea
              value={textStory}
              onChange={e => onChangeText(e.target.value)}
              placeholder={WRITE_PLACEHOLDER}
              className="w-full min-h-[244px] resize-none bg-transparent outline-none text-[15px] leading-[1.85] text-v2-text-primary placeholder:text-v2-text-muted"
              autoFocus
            />
            <div className="flex items-center justify-between pt-[11px] border-t border-black/[0.05]">
              <button onClick={onSwitchToVoice} className="flex items-center gap-1.5 text-[13px] text-v2-text-muted hover:opacity-70 active:opacity-60">
                <Mic2 size={15} />改用录音
              </button>
              <button
                disabled={!canSubmit || submitting}
                onClick={onSubmit}
                aria-label="开始匹配题目"
                className={canSubmit && !submitting ? 'btn-gradient-circle w-[42px] h-[42px]' : 'flex items-center justify-center w-[42px] h-[42px] rounded-full bg-bg-muted cursor-not-allowed'}
              >
                {submitting ? <Loader2 size={18} className="text-v2-text-muted animate-spin" /> : <ArrowRight size={18} className={canSubmit ? 'text-brand-primary-dark' : 'text-v2-text-muted'} />}
              </button>
            </div>
          </div>
          <div className="mt-[22px] px-1">
            <div className="flex items-baseline justify-between mb-[11px]">
              <span className="text-[12px] text-v2-text-muted tracking-[0.3px]">丰富度</span>
              <span className={`text-[13px] ${isRich ? 'text-brand-accent font-medium' : 'text-v2-text-secondary'}`}>{richState}</span>
            </div>
            <SegmentDots total={18} filled={richnessFilled} />
          </div>
          <div className="mt-4 px-1 text-[12px] leading-[1.7] text-v2-text-muted">
            试着带到：<span className="text-v2-text-secondary font-medium">时间 · 人物 · 发生的事 · 你的做法和感受</span>
          </div>
        </div>
      </div>
    </div>
  )
}
