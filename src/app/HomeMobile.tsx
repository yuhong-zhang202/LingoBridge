/**
 * @module   HomeMobile
 * @desc     首页移动端视图 —— 现有竖排版式原样搬入、改接 props 的纯展示组件（视觉与逻辑一字不改）：
 *           顶栏 + 我的故事/雅思题分段 + Orb + 开始录音/文字输入 CTA + StoryTextPanel + 底部 TabBar。
 *           月额度用完不再切主区，改由外壳在点击故事入口时弹覆盖层。数据与副作用由 page.tsx 外壳经 props 下发。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { Mic2, RotateCw, ChevronLeft } from 'lucide-react'
import Orb from '@/components/Orb'
import TabBar from '@/components/TabBar'
import StoryTextPanel from '@/components/StoryTextPanel'
import GradientButton from '@/components/GradientButton'
import PartTag from '@/components/PartTag'
import { prettifyTopic } from '@/lib/topic'
import type { HomeViewProps } from './types'

export default function HomeMobile({
  ieltsMode,
  showTextInput,
  question,
  loading,
  error,
  exhausted,
  textStory,
  submitting,
  canSubmit,
  startingRec,
  submitQid,
  onSetShowTextInput,
  onSelectMyStory,
  onSelectIelts,
  onNext,
  onStartRecording,
  onChangeTextStory,
  onSubmitStory,
}: HomeViewProps) {
  // 雅思模式选题卡的 Part 标 + 话题标（对齐桌面 HomeDesktop）：题目信息补全，切题时可见 Part 与话题。
  const topicLabel = question ? prettifyTopic(question.topic) : null
  return (
    <div
      className="relative h-dvh bg-bg-page flex flex-col overflow-hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* 顶部栏 */}
      {showTextInput ? (
        <div className="flex items-center justify-between h-[52px] px-5 relative z-10">
          <button
            onClick={() => onSetShowTextInput(false)}
            aria-label="返回"
            className="w-[30px] h-[30px] rounded-full bg-bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex items-center justify-center"
          >
            <ChevronLeft size={15} className="text-v2-text-secondary" />
          </button>
          <span className="text-[1rem] font-semibold text-v2-text-primary">写下你的故事</span>
          <div className="w-[30px]" />
        </div>
      ) : (
        <div className="flex items-center justify-between h-[52px] px-5 relative z-10">
          <span className="text-[1rem] font-bold text-v2-text-primary">LingoBridge</span>
        </div>
      )}

      {/* 主体 —— 首页永远正常渲染；月额度用完的提示由外壳在点击故事入口时以覆盖层弹出 */}
      <div className={`flex-1 min-h-0 flex flex-col relative z-10 overflow-y-auto ${showTextInput ? 'px-6 pt-5 pb-[calc(120px_+_env(safe-area-inset-bottom))]' : 'items-center px-7 pt-6 pb-[calc(72px_+_env(safe-area-inset-bottom))]'}`}>
          {!showTextInput && (
            <div className="flex justify-center mb-7">
              <div className="bg-bg-muted rounded-full p-1 inline-flex w-[228px]">
                <button
                  onClick={onSelectMyStory}
                  aria-pressed={!ieltsMode}
                  className={`flex-1 text-center py-2 text-[0.8125rem] font-semibold rounded-full transition-all ${!ieltsMode ? 'bg-bg-surface shadow-[0_1px_4px_rgba(0,0,0,0.10)] text-brand-primary-dark' : 'bg-transparent text-v2-text-muted'}`}
                >
                  我的故事
                </button>
                <button
                  onClick={onSelectIelts}
                  aria-pressed={ieltsMode}
                  className={`flex-1 text-center py-2 text-[0.8125rem] font-semibold rounded-full transition-all ${ieltsMode ? 'bg-bg-surface shadow-[0_1px_4px_rgba(0,0,0,0.10)] text-brand-primary-dark' : 'bg-transparent text-v2-text-muted'}`}
                >
                  雅思题
                </button>
              </div>
            </div>
          )}

          {!showTextInput && <Orb size={300} pulse={false} />}
          {!showTextInput && <div className="h-[41px]" />}

          <div className="w-full flex flex-col items-center">
            {!showTextInput && (
              <div className="text-center w-full">
                {!ieltsMode ? (
                  <>
                    <h1 className="text-[1.25rem] font-bold text-v2-text-primary tracking-tight">说说你的故事</h1>
                    <p className="text-[0.8125rem] text-v2-text-muted mt-2">精准匹配雅思口语题目</p>
                  </>
                ) : (
                  <>
                    {/* Part 标 + 话题标（雅思模式选题信息补全，对齐桌面 HomeDesktop）：仅有真实题目、非加载/报错/抽空时显示 */}
                    {!loading && !error && !exhausted && question && (
                      <div className="flex items-center justify-center gap-2 mb-2">
                        <PartTag label={`Part ${question.part}`} />
                        {topicLabel && (
                          <span className="text-[0.75rem] font-medium text-v2-text-muted whitespace-nowrap">{topicLabel}</span>
                        )}
                      </div>
                    )}
                    {!loading && error ? (
                      <p className="w-full text-center text-[0.8125rem] text-v2-text-muted min-h-[28px]">没取到题，点下面换一题重试</p>
                    ) : !loading && exhausted ? (
                      <p className="w-full text-center text-[0.8125rem] text-v2-text-muted min-h-[28px]">本季真题你都练过啦 · 换季会上新题</p>
                    ) : (
                      <h1 className="w-full text-center text-[1.25rem] font-bold text-v2-text-primary tracking-tight leading-snug min-h-[28px]">
                        {loading ? '换一题中…' : question ? (question.part === 2 ? (question.cue_card_title_zh ?? '') : question.question_text_zh) : ''}
                      </h1>
                    )}
                    <p className="text-[0.8125rem] text-v2-text-muted mt-2">聊聊你的看法</p>
                    {!exhausted && (
                      <button onClick={onNext} className="mt-3 inline-flex items-center gap-1.5 text-[0.75rem] text-v2-text-muted active:opacity-60">
                        <RotateCw size={12} />换一题
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            <div className={`w-full ${showTextInput ? 'mt-0' : 'mt-4'}`}>
              {!showTextInput && (
                <>
                  {/* GradientButton（升级自原裸 btn-gradient）：loading 时自带 spinner + 禁用 + aria-busy，
                      「开始录音」额度核对/麦克风探测期间转圈，消除「点了没反应」。皮肤与桌面 CTA 统一。 */}
                  <GradientButton
                    onClick={onStartRecording}
                    loading={startingRec}
                    className="mx-auto flex items-center justify-center gap-2 w-[280px] h-[50px] rounded-full text-[0.875rem] font-semibold"
                  >
                    <Mic2 size={16} className="text-v2-text-secondary" />
                    开始录音
                  </GradientButton>
                  <button onClick={() => onSetShowTextInput(true)} className="w-full text-center text-[0.8125rem] text-v2-text-muted mt-3 cursor-pointer">
                    或用文字输入
                  </button>
                </>
              )}

              {showTextInput && (
                <div className="w-full">
                  <StoryTextPanel
                    value={textStory}
                    onChange={onChangeTextStory}
                    canSubmit={canSubmit}
                    submitting={submitting}
                    onSubmit={onSubmitStory}
                    onSwitchToVoice={() => onSetShowTextInput(false)}
                    qid={submitQid}
                    minH="min-h-[244px]"
                    fadeUp
                  />
                </div>
              )}
            </div>
          </div>

          {!showTextInput && <div className="flex-1" />}
      </div>

      <div className="flex-shrink-0"><TabBar /></div>
    </div>
  )
}
