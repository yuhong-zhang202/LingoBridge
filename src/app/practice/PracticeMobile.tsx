/**
 * @module   PracticeMobile
 * @desc     练习对话页移动端视图 —— 现有移动端版式原样搬入、改接 props 的纯展示组件（视觉与逻辑一字不改）。
 *           TopBar + StepBar、题目条、消息列表（AiBubble/UserBubble + 发音纠错卡）、换说法弹窗、fixed 底部输入条全部照旧。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { Fragment } from 'react'
import { Mic, Clock, X, Send } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'
import EmptyState from '@/components/EmptyState'
import { useAccount } from '@/hooks/useAccount'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import OrbSoft from './_components/OrbSoft'
import AiBubble from './_components/AiBubble'
import UserBubble from './_components/UserBubble'
import RephrasePopup from './_components/RephrasePopup'
import VoiceBar from './_components/VoiceBar'
import PronounceCapturePopup from './_components/PronounceCapturePopup'
import type { PracticeViewProps } from './types'

export default function PracticeMobile({
  scaffold, messages, phase, error, showPolish, polishLoading, polishResult, capture, audioLevel,
  recTime, nearLimit, micLabel, capHint, isCapped,
  popupRef, orbRef, bottomRef, pronounceRef,
  onStartRecord, onCancelRecord, onSend, onWordTap, onPolish, onReopenPolish, onClosePolish,
  onSavePronunciation, onCloseCapture, onEnd, onRetry,
}: PracticeViewProps): JSX.Element {
  // 用户气泡头像（共享缓存，无额外请求）；未上传/匿名时为 null，UserBubble 回退 OrbWarm
  const { account } = useAccount()
  const avatarUrl = account?.avatarUrl ?? null

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      <TopBar title="练习对话" />
      <StepBar currentStep="practice" />

      {/* 题目条：固定在流程轴下方，不随对话滚动 */}
      <div className="flex-shrink-0 px-5 pt-2 pb-3">
        <div className="flex items-center gap-2 bg-bg-page border border-black/[0.05] rounded-[8px] px-[11px] py-[6px]">
          <span className="text-[11px] text-v2-text-muted flex-shrink-0">Part {scaffold?.part ?? 1}</span>
          <div className="w-px h-3 bg-black/10 flex-shrink-0" />
          <span className="text-[12px] font-medium text-v2-text-secondary flex-1 truncate min-w-0">
            {scaffold?.displayEn ?? '加载中…'}
          </span>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto px-5 pt-0 scroll-pb-[140px] relative z-10 lg:max-w-3xl lg:mx-auto lg:w-full ${capture ? 'pb-[220px]' : 'pb-[100px]'}`}>
        {phase === 'init' && (
          <div className="text-center text-[13px] text-v2-text-muted py-16">教练正在准备…</div>
        )}
        {phase === 'error' && (
          <EmptyState
            title="教练没接上"
            subtitle="刚才好像没连上，点下面再试一次就好。"
            ctaLabel="重试"
            onCta={onRetry}
            orbSize={100}
          />
        )}

        {/* 对话列表 */}
        {messages.map((m, i) =>
          m.role === 'assistant'
            ? <AiBubble key={i} text={m.content} />
            : <Fragment key={i}>
                <UserBubble
                  text={m.content}
                  avatarUrl={avatarUrl}
                  onWordTap={(word) => onWordTap(word, m.content, i)}
                  onPolish={() => onPolish(m.content, i)}
                />
                {capture?.msgIndex === i && (
                  <div ref={pronounceRef}>
                    <PronounceCapturePopup
                      heard={capture.heard}
                      savedIds={capture.savedIds}
                      onSave={onSavePronunciation}
                      onClose={onCloseCapture}
                    />
                  </div>
                )}
              </Fragment>
        )}

        {/* 处理中提示 */}
        {phase === 'transcribing' && <UserBubble text="…" avatarUrl={avatarUrl} />}
        {phase === 'replying' && <AiBubble text="…" />}
        {error && phase === 'idle' && (
          <p className="text-center text-[12px] text-v2-text-muted mb-2">{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 遮罩 + 换个说法弹窗 */}
      {showPolish && <div className="fixed inset-0 z-[19]" onClick={onClosePolish} />}
      {showPolish && (
        <RephrasePopup
          loading={polishLoading}
          result={polishResult}
          onClose={onClosePolish}
          popupRef={popupRef}
        />
      )}


      {/* 底部输入区 */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] lg:max-w-3xl bg-bg-page border-t border-black/[0.05] z-20 px-[14px]"
        style={{ paddingTop: 18, paddingBottom: 'max(18px, env(safe-area-inset-bottom))' }}
      >
        {isCapped ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-[13px] text-v2-text-secondary">聊得很充分啦，这轮就到这里吧</p>
            <button
              onClick={onEnd}
              className="px-6 py-3 rounded-full text-[14px] font-medium text-v2-text-secondary active:scale-[0.97] transition-transform duration-150"
              style={GRADIENT_BORDER_STYLE}
            >
              查看反馈
            </button>
          </div>
        ) : (
        <>
        {/* 临近上限提示：常驻一行小字（Part 2 含"2 分钟喊停"，其余朴素） */}
        {nearLimit && (
          <div className="flex items-start gap-1.5 mb-2.5 px-1 text-[11px] leading-[1.4] text-warning">
            <Clock size={13} className="flex-shrink-0 mt-px" />
            <span>{capHint}</span>
          </div>
        )}

        <div className="flex items-center gap-[12px]">
          <button
            ref={orbRef}
            onClick={onReopenPolish}
            aria-label="换个说法"
            className="flex-shrink-0 active:scale-[0.97] transition-transform duration-150"
          >
            <OrbSoft size={50} />
          </button>

          {phase === 'recording' ? (
            // 录音态：容器本身不可点，仅「×」取消与「发送」可点
            <div
              className="flex flex-1 items-center gap-[6px] pl-[8px] pr-[6px]"
              style={{ ...GRADIENT_BORDER_STYLE, height: 52, borderRadius: 9999 }}
            >
              <button
                onClick={onCancelRecord}
                aria-label="取消录音"
                className="flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center text-v2-text-muted active:scale-[0.97] transition-transform"
              >
                <X size={19} />
              </button>
              <VoiceBar audioLevel={audioLevel} />
              <span className={`text-[12px] font-medium flex-shrink-0 min-w-[28px] text-right ${nearLimit ? 'text-warning' : 'text-v2-text-muted'}`}>
                {recTime}
              </span>
              <button
                onClick={onSend}
                aria-label="发送"
                className="flex-shrink-0 w-[38px] h-[38px] btn-gradient-circle text-brand-primary"
              >
                <Send size={18} />
              </button>
            </div>
          ) : (
            // 空闲 / 处理态：点击说话胶囊
            <button
              className="flex flex-1 items-center justify-center gap-[9px] active:scale-[0.97] transition-transform duration-150 disabled:opacity-50"
              style={{ ...GRADIENT_BORDER_STYLE, height: 52, borderRadius: 9999 }}
              disabled={phase !== 'idle'}
              onClick={onStartRecord}
            >
              <Mic size={19} className="text-brand-primary" />
              <span className="text-[14px] font-medium text-v2-text-secondary">{micLabel}</span>
            </button>
          )}
          <button
            onClick={onEnd}
            className="flex-shrink-0 rounded-full border border-black/[0.12] px-4 py-2 text-[13px] text-v2-text-muted active:scale-[0.97] transition-transform"
          >
            结束
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  )
}
