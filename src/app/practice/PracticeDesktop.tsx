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
import { useEffect, useRef, Fragment } from 'react'
import { Mic, Clock, X, Send } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import OrbSoft from './_components/OrbSoft'
import AiBubble from './_components/AiBubble'
import UserBubble from './_components/UserBubble'
import RephrasePopup from './_components/RephrasePopup'
import VoiceBar from './_components/VoiceBar'
import PronounceCapturePopup from './_components/PronounceCapturePopup'
import type { PracticeViewProps } from './types'

/** 舞台高度：满屏减去外壳 72px 顶栏（绑定视口，让消息列表内部滚动、输入条钉底） */
const STAGE = 'h-[calc(100vh-72px)]'

export default function PracticeDesktop({
  scaffold, messages, phase, error, showPolish, polishLoading, polishResult, capture, audioLevel,
  recTime, nearLimit, micLabel, capHint, isCapped,
  popupRef, orbRef, bottomRef, pronounceRef,
  onStartRecord, onCancelRecord, onSend, onWordTap, onPolish, onReopenPolish, onClosePolish,
  onSavePronunciation, onCloseCapture, onEnd, onRetry,
}: PracticeViewProps): JSX.Element {

  // 键盘：Space 空闲=开始录音 / 录音=发送；Esc 录音时取消。弹窗打开或焦点在输入框时不响应，避免误触
  // （发音纠错卡里要能正常打空格）。transcribing/replying 不允许。用 ref 持最新值，监听只订阅一次。
  const latest = useRef({ phase, showPolish, capture, onStartRecord, onCancelRecord, onSend })
  latest.current = { phase, showPolish, capture, onStartRecord, onCancelRecord, onSend }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const s = latest.current
      if (s.showPolish || s.capture) return
      if (e.code === 'Space') {
        // Space 交还给聚焦的原生控件（结束 / 换说法 / 发送等按钮）自行激活，不劫持去录音
        if (t?.closest('button, a, [role="button"]')) return
        if (s.phase === 'idle') { e.preventDefault(); s.onStartRecord() }
        else if (s.phase === 'recording') { e.preventDefault(); s.onSend() }
      } else if (e.key === 'Escape') {
        if (s.phase === 'recording') s.onCancelRecord()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (phase === 'init') {
    return (
      <div className={`${STAGE} flex items-center justify-center px-8`}>
        <p className="text-[13px] text-v2-text-muted">教练正在准备…</p>
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
      <div className="w-full max-w-[600px] flex-1 min-h-0 flex flex-col">

        {/* 题目条（舞台顶部安静 caption，样式对齐移动端题目条） */}
        <div className="shrink-0 pt-6 pb-3">
          <div className="flex items-center gap-2 bg-bg-page border border-black/[0.05] rounded-[8px] px-[11px] py-[6px]">
            <span className="text-[11px] text-v2-text-muted flex-shrink-0">Part {scaffold?.part ?? 1}</span>
            <div className="w-px h-3 bg-black/10 flex-shrink-0" />
            <span className="text-[12px] font-medium text-v2-text-secondary flex-1 truncate min-w-0">
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
          {phase === 'transcribing' && <UserBubble text="…" />}
          {phase === 'replying' && <AiBubble text="…" />}
          {error && phase === 'idle' && (
            <p className="text-center text-[12px] text-v2-text-muted mb-2">{error}</p>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 遮罩 + 换个说法弹窗（复用不改；fixed 定位由组件自身持有，单挂载下无双监听冲突） */}
        {showPolish && <div className="fixed inset-0 z-[19]" onClick={onClosePolish} />}
        {showPolish && (
          <RephrasePopup loading={polishLoading} result={polishResult} onClose={onClosePolish} popupRef={popupRef} />
        )}

        {/* 输入区：flex 钉底（不 fixed），随 600px 列居中 */}
        <div className="shrink-0 border-t border-black/[0.05] pt-4 pb-6">
          {isCapped ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-[13px] text-v2-text-secondary">聊得很充分啦，这轮就到这里吧</p>
              <button
                onClick={onEnd}
                className="px-6 py-3 rounded-full text-[14px] font-medium text-v2-text-secondary active:scale-[0.97] transition-[transform,box-shadow] duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_22px_rgba(0,0,0,0.09)]"
                style={GRADIENT_BORDER_STYLE}
              >
                查看反馈
              </button>
            </div>
          ) : (
            <>
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
                    <span className={`text-[12px] font-medium flex-shrink-0 min-w-[28px] text-right tabular-nums ${nearLimit ? 'text-warning' : 'text-v2-text-muted'}`}>
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
                    <Mic size={19} className="text-brand-primary" />
                    <span className="text-[14px] font-medium text-v2-text-secondary">{micLabel}</span>
                  </button>
                )}

                <button
                  onClick={onEnd}
                  className="flex-shrink-0 rounded-full border border-black/[0.12] px-4 py-2 text-[13px] text-v2-text-muted active:scale-[0.97] transition-transform hover:-translate-y-[1px]"
                >
                  结束
                </button>
              </div>

              <p className="mt-3 text-center text-[12px] text-v2-text-muted">Space 说话 / 发送 · Esc 取消</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
