/**
 * @module   PracticeDesktop
 * @desc     练习对话页桌面视图（focus 档）—— FlowShellDesktop 沉浸外壳内 max-w-[600px] 居中聊天舞台：
 *           [题目条 shrink-0] → [消息列表 flex-1 唯一滚动区] → [输入条 shrink-0，flex 钉底不 fixed]。
 *           复用 OrbSoft/AiBubble/UserBubble/RephrasePopup/VoiceBar/PronounceCapturePopup，state/回调/ref 经 props。
 *           桌面独有：Space 空闲开始/录音发送、Esc 录音取消；点击说话/结束/换说法 Orb 的 hover 浮起。
 *           单挂载：本组件仅在 ≥1024px 时渲染，键盘监听随之只在桌面存在（外壳单实例录音器，绝不自建）。
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { type JSX, useEffect, useRef, useState, Fragment } from 'react'
import { Mic, Clock, X, Send, Loader2 } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import ConfirmDialog from '@/components/ConfirmDialog'
import GradientButton from '@/components/GradientButton'
import { useAccount } from '@/hooks/useAccount'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import OrbSoft from './_components/OrbSoft'
import AiBubble from './_components/AiBubble'
import UserBubble from './_components/UserBubble'
import RephrasePopup from './_components/RephrasePopup'
import VoiceBar from './_components/VoiceBar'
import PronounceCapturePopup from './_components/PronounceCapturePopup'
import InlineTopProgress from './_components/InlineTopProgress'
import TranscribeFailCard from './_components/TranscribeFailCard'
import ReplyFailCard from './_components/ReplyFailCard'
import type { PracticeViewProps } from './types'

/** 舞台高度：满屏减去外壳 72px 顶栏（绑定视口，让消息列表内部滚动、输入条钉底） */
const STAGE = 'h-[calc(100vh-72px)]'

export default function PracticeDesktop({
  scaffold, messages, phase, error, showPolish, polishLoading, polishResult, capture, audioLevel,
  recTime, nearLimit, micLabel, capHint, isCapped,
  popupRef, orbRef, bottomRef, pronounceRef,
  onStartRecord, onCancelRecord, onSend, onWordTap, onPolish, onReopenPolish, onClosePolish,
  onSavePronunciation, onCloseCapture, onEnd, onRetry,
  onRetryTranscribe,
  onRetryReply, replyFailAttempt,
}: PracticeViewProps): JSX.Element {

  // 键盘：Space 空闲=开始录音 / 录音=发送；Esc 录音时取消。弹窗打开或焦点在输入框时不响应，避免误触
  // （发音纠错卡里要能正常打空格）。transcribing/replying 不允许。用 ref 持最新值，监听只订阅一次。
  // 「结束」二次确认（仅手动结束入口；满 8 轮的「查看反馈」不弹）
  const [confirmEnd, setConfirmEnd] = useState(false)

  // 用户气泡头像（共享缓存，无额外请求）；未上传/匿名时为 null，UserBubble 回退 OrbWarm
  const { account } = useAccount()
  const avatarUrl = account?.avatarUrl ?? null

  const latest = useRef({ phase, showPolish, capture, onStartRecord, onCancelRecord, onSend, onClosePolish, onCloseCapture, onRetryTranscribe, onRetryReply })
  latest.current = { phase, showPolish, capture, onStartRecord, onCancelRecord, onSend, onClosePolish, onCloseCapture, onRetryTranscribe, onRetryReply }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return
      const t = e.target as HTMLElement | null
      const s = latest.current
      // ① Esc 就近关浮层（换说法弹窗 / 发音纠错卡，含其输入框内也能关）→ 录音时取消 → 否则不退页
      if (e.key === 'Escape') {
        if (s.showPolish) { s.onClosePolish(); return }
        if (s.capture) { s.onCloseCapture(); return }
        if (s.phase === 'recording') { s.onCancelRecord(); return }
        return
      }
      // 失败态 Enter → 重试转写（焦点在「重试转写」按钮上时交还原生激活，不重复触发）
      if (e.key === 'Enter' && s.phase === 'transcribeFailed') {
        if (t?.closest('button, a, [role="button"]')) return
        e.preventDefault(); s.onRetryTranscribe(); return
      }
      // 回复失败态 Enter → 再试一次（同样焦点在「再试一次」按钮上时交还原生激活，不重复触发）
      if (e.key === 'Enter' && s.phase === 'replyFailed') {
        if (t?.closest('button, a, [role="button"]')) return
        e.preventDefault(); s.onRetryReply(); return
      }
      // 其余键：输入框内让位、弹窗开时不响应
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (s.showPolish || s.capture) return
      if (e.code === 'Space') {
        // Space 交还给聚焦的原生控件（结束 / 换说法 / 发送等按钮）自行激活，不劫持去录音
        if (t?.closest('button, a, [role="button"]')) return
        if (s.phase === 'idle') { e.preventDefault(); s.onStartRecord() }
        else if (s.phase === 'recording') { e.preventDefault(); s.onSend() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (phase === 'init') {
    return (
      <div className={`${STAGE} flex items-center justify-center px-8`}>
        <p className="text-[0.8125rem] text-v2-text-muted">教练正在准备…</p>
      </div>
    )
  }
  if (phase === 'error') {
    return (
      <div className={`${STAGE} flex items-center justify-center px-8`}>
        <EmptyState
          title="教练没接上"
          subtitle="刚才好像没连上，点下面再试一次就好。"
          ctaLabel="重试"
          onCta={onRetry}
          orbSize={100}
        />
      </div>
    )
  }

  return (
    <div className={`${STAGE} flex flex-col items-center px-8`}>
      {/* 转写排队自动重试：页内顶部涓流条 + sr-only 安抚播报（视觉与全局条一致，但不走 useNav） */}
      {phase === 'queued' && <InlineTopProgress />}
      {/* relative：给「换个说法」弹窗做 absolute 定位基准，弹窗宽度收进本列而非横跨全屏 */}
      <div className="relative w-full max-w-[600px] flex-1 min-h-0 flex flex-col">

        {/* 题目条（舞台顶部安静 caption，样式对齐移动端题目条） */}
        <div className="shrink-0 pt-6 pb-3">
          <div className="flex items-center gap-2 bg-bg-page border border-black/[0.05] rounded-[8px] px-[11px] py-[6px]">
            <span className="text-[0.6875rem] text-v2-text-muted flex-shrink-0">Part {scaffold?.part ?? 1}</span>
            <div className="w-px h-3 bg-black/10 flex-shrink-0" />
            <span className="text-[0.75rem] font-medium text-v2-text-secondary flex-1 truncate min-w-0">
              {scaffold?.displayEn ?? '加载中…'}
            </span>
          </div>
        </div>

        {/* 消息列表：唯一滚动区 */}
        <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-4" aria-live="polite">
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
          {(phase === 'transcribing' || phase === 'queued') && <UserBubble text="…" avatarUrl={avatarUrl} />}
          {phase === 'replying' && <AiBubble text="…" />}
          {error && phase === 'idle' && (
            <p className="text-center text-[0.75rem] text-v2-text-muted mb-2">{error}</p>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 遮罩 + 换个说法弹窗（desktop 变体：absolute 收进本列，宽度与对话气泡对齐） */}
        {showPolish && <div className="fixed inset-0 z-[19]" onClick={onClosePolish} />}
        {showPolish && (
          <RephrasePopup loading={polishLoading} result={polishResult} onClose={onClosePolish} popupRef={popupRef} variant="desktop" />
        )}

        {/* 输入区：flex 钉底（不 fixed），随 600px 列居中 */}
        <div className="shrink-0 border-t border-black/[0.05] pt-4 pb-6">
          {isCapped ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-[0.8125rem] text-v2-text-secondary">聊得很充分啦，这轮就到这里吧</p>
              <GradientButton
                onClick={onEnd}
                className="px-6 py-3 rounded-full text-[0.875rem] font-medium transition-[transform,box-shadow] duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_22px_rgba(0,0,0,0.09)]"
              >
                查看反馈
              </GradientButton>
            </div>
          ) : phase === 'transcribeFailed' ? (
            <TranscribeFailCard onRetry={onRetryTranscribe} />
          ) : phase === 'replyFailed' ? (
            <ReplyFailCard onRetry={onRetryReply} attempt={replyFailAttempt} />
          ) : (
            <>
              {nearLimit && (
                <div className="flex items-start gap-1.5 mb-2.5 px-1 text-[0.6875rem] leading-[1.4] text-warning-text">
                  <Clock size={13} className="flex-shrink-0 mt-px" />
                  <span>{capHint}</span>
                </div>
              )}

              {/* 排队自动重试安抚微文案：明确「不用重说」，别让用户以为卡死 */}
              {phase === 'queued' && (
                <p className="mb-2.5 px-1 text-[0.6875rem] leading-[1.4] text-v2-text-muted">
                  现在人有点多，正在为你自动重试，不用重说，通常几秒就好
                </p>
              )}

              <div className="flex items-center gap-[12px]">
                <button
                  ref={orbRef}
                  onClick={onReopenPolish}
                  aria-label="换个说法"
                  className="flex-shrink-0 active:scale-[0.97] transition-transform duration-150 hover:-translate-y-[1px]"
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
                    <div className="contents" aria-hidden="true"><VoiceBar audioLevel={audioLevel} /></div>
                    <span className={`text-[0.75rem] font-medium flex-shrink-0 min-w-[28px] text-right tabular-nums ${nearLimit ? 'text-warning-text' : 'text-v2-text-muted'}`}>
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
                    className="flex flex-1 items-center justify-center gap-[9px] active:scale-[0.97] transition-transform duration-150 hover:-translate-y-[1px] disabled:opacity-50"
                    style={{ ...GRADIENT_BORDER_STYLE, height: 52, borderRadius: 9999 }}
                    disabled={phase !== 'idle'}
                    onClick={onStartRecord}
                  >
                    {phase === 'transcribing' || phase === 'queued'
                      ? <Loader2 size={19} className="text-brand-primary animate-spin" />
                      : <Mic size={19} className="text-brand-primary" />}
                    <span className="text-[0.875rem] font-medium text-v2-text-secondary">{micLabel}</span>
                  </button>
                )}

                <button
                  onClick={() => setConfirmEnd(true)}
                  className="flex-shrink-0 rounded-full border border-black/[0.12] px-4 py-2 text-[0.8125rem] text-v2-text-muted active:scale-[0.97] transition-transform hover:-translate-y-[1px]"
                >
                  结束
                </button>
              </div>

              <p className="mt-3 text-center text-[0.75rem] text-v2-text-muted">Space 说话 / 发送 · Esc 取消</p>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmEnd}
        title="结束这场练习？"
        description="结束后本场会保存进反馈，并计入本月练习额度。确定结束吗？"
        confirmText="结束"
        cancelText="继续练习"
        onConfirm={() => { setConfirmEnd(false); onEnd() }}
        onCancel={() => setConfirmEnd(false)}
      />
    </div>
  )
}
