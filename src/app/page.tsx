'use client'
import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Mic2, RotateCw, ChevronLeft, ArrowRight, Loader2, Pencil } from 'lucide-react'
import Orb from '@/components/Orb'
import TabBar from '@/components/TabBar'
import Toast from '@/components/Toast'
import FirstUseConsent from '@/components/FirstUseConsent'
import MicPermissionSheet from '@/components/MicPermissionSheet'
import QuotaReached from '@/components/QuotaReached'
import SegmentDots from '@/app/question-bank/SegmentDots'
import { useSwitchQuestion } from '@/hooks/useSwitchQuestion'
import { isGarbageInput, GARBAGE_TOAST_MSG } from '@/lib/utils'
import { putHandoff } from '@/lib/handoff'
import { getAccount } from '@/lib/auth'
import { countCorpusThisMonth, STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'

export default function HomePage() {
  const router = useRouter()
  const [showTextInput, setShowTextInput] = useState(false)
  const [textStory, setTextStory] = useState('')
  const [ieltsMode, setIeltsMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [storyQuotaReached, setStoryQuotaReached] = useState(false)
  const [micSheet, setMicSheet] = useState<null | 'denied' | 'unavailable'>(null)
  const { question, loading, error, next } = useSwitchQuestion()

  // 点「开始录音」先探测麦克风：有权限照常进录音页，没权限弹 sheet（避免录音页静默卡死）
  async function handleStartRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())   // 拿到权限即释放，录音页会重新获取
      router.push(ieltsMode && question ? `/recording?qid=${question.id}` : '/recording')
    } catch (err) {
      const name = (err as DOMException)?.name
      setMicSheet(name === 'NotAllowedError' ? 'denied' : 'unavailable')
    }
  }

  // 登录用户：挂载时核当月语料数，达上限即把首页主区切换为「额度用完」态
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const acct = await getAccount()
        const loggedIn = !!acct && !acct.isAnonymous && !!acct.email
        if (!loggedIn) return
        const n = await countCorpusThisMonth()
        if (!cancelled && n >= STORY_MONTHLY_LIMIT) setStoryQuotaReached(true)
      } catch { /* 静默：不挡正常流程 */ }
    })()
    return () => { cancelled = true }
  }, [])

  // 文字输入派生状态
  const len = textStory.trim().length
  const pct = Math.min(100, (len / 90) * 100)
  const richnessFilled = Math.round((pct / 100) * 18)
  const isRich = pct >= 80
  const richState =
    len === 0   ? '越具体匹配越准' :
    pct < 30    ? '还比较简单，多展开一些' :
    pct < 80    ? '渐入佳境，再补点细节' :
                  '很丰富啦 ✨ 可以开始匹配'
  const canSubmit = len >= 10

  const handleTextSubmit = useCallback(async (): Promise<void> => {
    // 第一层：即时预检，不调 API
    if (isGarbageInput(textStory)) {
      setToastMsg(GARBAGE_TOAST_MSG)
      return
    }
    setSubmitting(true)
    const qidParam = ieltsMode && question ? `&qid=${question.id}` : ''
    try {
      // 第二层：让 restructure 判断 usable
      const res = await fetch('/api/restructure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: textStory }),
      })
      if (res.ok) {
        const data = (await res.json()) as { cleanedText: string; usable: boolean }
        if (!data.usable) {
          setToastMsg(GARBAGE_TOAST_MSG)
          return
        }
      }
      // API 错误或 usable=true，放行（restructure 页会再跑一次，属已知开销）
      router.push(`/restructure?h=${putHandoff(textStory)}${qidParam}`)
    } catch {
      router.push(`/restructure?h=${putHandoff(textStory)}${qidParam}`)
    } finally {
      setSubmitting(false)
    }
  }, [textStory, router, ieltsMode, question])

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden lg:pl-[256px]">
      <div className="ambient-light" />

      {/* 顶部栏（桌面端隐藏：侧栏已有 Logo） */}
      {showTextInput ? (
        <div className="flex items-center justify-between h-[52px] px-5 relative z-10 lg:hidden">
          <button
            onClick={() => setShowTextInput(false)}
            aria-label="返回"
            className="w-[30px] h-[30px] rounded-full bg-bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex items-center justify-center"
          >
            <ChevronLeft size={15} className="text-v2-text-secondary" />
          </button>
          <span className="text-[15px] font-semibold text-v2-text-primary">写下你的故事</span>
          <div className="w-[30px]" />
        </div>
      ) : (
        <div className="flex items-center justify-between h-[52px] px-5 relative z-10 lg:hidden">
          <span className="text-[16px] font-bold text-v2-text-primary">
            LingoBridge
          </span>
        </div>
      )}

      {/* 主体：故事额度用完时整块替换为 QuotaReached（不展示录音/文字入口） */}
      {storyQuotaReached ? (
        <div className="flex-1 min-h-0 flex items-center justify-center relative z-10 overflow-y-auto pb-[72px]">
          <QuotaReached variant="story" />
        </div>
      ) : (
      <>
      {/* 移动端：竖排布局（桌面端用下面的 2 栏 hero） */}
      <div className={`flex-1 min-h-0 flex flex-col relative z-10 overflow-y-auto lg:hidden ${showTextInput ? 'px-6 pt-5 pb-[120px]' : 'items-center px-7 pt-6 pb-[72px]'}`}>

        {/* 分段控件：故事模式 / 雅思题模式（在 Orb 上方） */}
        {!showTextInput && (
          <div className="flex justify-center mb-7">
            <div className="bg-bg-muted rounded-full p-1 inline-flex w-[228px]">
              <button
                onClick={() => setIeltsMode(false)}
                className={`flex-1 text-center py-2 text-[13px] font-semibold rounded-full transition-all ${
                  !ieltsMode
                    ? 'bg-bg-surface shadow-[0_1px_4px_rgba(0,0,0,0.10)] text-brand-primary-dark'
                    : 'bg-transparent text-v2-text-muted'
                }`}
              >
                我的故事
              </button>
              <button
                onClick={() => { if (!ieltsMode) { setIeltsMode(true); void next() } }}
                className={`flex-1 text-center py-2 text-[13px] font-semibold rounded-full transition-all ${
                  ieltsMode
                    ? 'bg-bg-surface shadow-[0_1px_4px_rgba(0,0,0,0.10)] text-brand-primary-dark'
                    : 'bg-transparent text-v2-text-muted'
                }`}
              >
                雅思题
              </button>
            </div>
          </div>
        )}

        {/* Orb（故事/录音态居中展示；文字态的小 Orb 放在引导气泡行内） */}
        {!showTextInput && <Orb size={300} pulse={false} />}

        {/* Orb 与下方间距：仅故事/录音态需要 */}
        {!showTextInput && <div className="h-[41px]" />}

        {/* 文字 + 操作区 */}
        <div className="w-full flex flex-col items-center">

          {!showTextInput && (
            <div className="text-center w-full">
              {!ieltsMode ? (
                <>
                  <h1 className="text-[20px] font-bold text-v2-text-primary tracking-tight">
                    说说你的故事
                  </h1>
                  <p className="text-[13px] text-v2-text-muted mt-2">
                    精准匹配雅思口语题目
                  </p>
                </>
              ) : (
                <>
                  {!loading && error ? (
                    <p className="w-full text-center text-[13px] text-v2-text-muted min-h-[28px]">
                      没取到题，点下面换一题重试
                    </p>
                  ) : (
                    <h1 className="w-full text-center text-[20px] font-bold text-v2-text-primary tracking-tight leading-snug min-h-[28px]">
                      {loading
                        ? '换一题中…'
                        : question
                          ? (question.part === 2 ? (question.cue_card_title_zh ?? '') : question.question_text_zh)
                          : ''}
                    </h1>
                  )}
                  <p className="text-[13px] text-v2-text-muted mt-2">
                    聊聊你的看法
                  </p>
                  <button
                    onClick={() => void next()}
                    className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-v2-text-muted active:opacity-60"
                  >
                    <RotateCw size={12} />
                    换一题
                  </button>
                </>
              )}
            </div>
          )}

          {/* 操作区 */}
          <div className={`w-full ${showTextInput ? 'mt-0' : 'mt-4'}`}>

            {!showTextInput && (
              <>
                {/* 主按钮：开始录音 */}
                <button
                  onClick={() => void handleStartRecording()}
                  className="btn-gradient mx-auto w-[280px] h-[50px]"
                >
                  <Mic2 size={16} className="text-v2-text-secondary" />
                  开始录音
                </button>

                {/* 文字输入入口 */}
                <button
                  onClick={() => setShowTextInput(true)}
                  className="w-full text-center text-[13px] text-v2-text-muted mt-3 cursor-pointer"
                >
                  或用文字输入
                </button>
              </>
            )}

            {showTextInput && (
              <div className="w-full animate-fade-up">
                {/* 输入卡 */}
                <div className="w-full bg-bg-surface border border-black/[0.06] rounded-[18px] pt-[18px] px-4 pb-[13px]">
                  <textarea
                    value={textStory}
                    onChange={e => setTextStory(e.target.value)}
                    placeholder={'用中文聊聊最近的一件小事，尽量说具体些……\n\n和谁一起、做了什么、当时心里什么感觉，都可以写进来。'}
                    className="w-full min-h-[244px] resize-none bg-transparent outline-none text-[15px] leading-[1.85] text-v2-text-primary placeholder:text-v2-text-muted"
                    autoFocus
                  />
                  <div className="flex items-center justify-between pt-[11px] border-t border-black/[0.05]">
                    <button
                      onClick={() => setShowTextInput(false)}
                      className="flex items-center gap-1.5 text-[13px] text-v2-text-muted active:opacity-60"
                    >
                      <Mic2 size={15} />
                      改用录音
                    </button>
                    <button
                      disabled={!canSubmit || submitting}
                      onClick={() => void handleTextSubmit()}
                      aria-label="开始匹配题目"
                      className={
                        canSubmit && !submitting
                          ? 'btn-gradient-circle w-[42px] h-[42px]'
                          : 'flex items-center justify-center w-[42px] h-[42px] rounded-full bg-bg-muted cursor-not-allowed'
                      }
                    >
                      {submitting ? (
                        <Loader2 size={18} className="text-v2-text-muted animate-spin" />
                      ) : (
                        <ArrowRight size={18} className={canSubmit ? 'text-brand-primary-dark' : 'text-v2-text-muted'} />
                      )}
                    </button>
                  </div>
                </div>

                {/* 丰富度 */}
                <div className="mt-[22px] px-1">
                  <div className="flex items-baseline justify-between mb-[11px]">
                    <span className="text-[12px] text-v2-text-muted tracking-[0.3px]">丰富度</span>
                    <span className={`text-[13px] ${isRich ? 'text-brand-accent font-medium' : 'text-v2-text-secondary'}`}>{richState}</span>
                  </div>
                  <SegmentDots total={18} filled={richnessFilled} />
                </div>

                {/* 要素提示行 */}
                <div className="mt-4 px-1 text-[12px] leading-[1.7] text-v2-text-muted">
                  试着带到：<span className="text-v2-text-secondary font-medium">时间 · 人物 · 发生的事 · 你的做法和感受</span>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* 剩余空白沉到底部（仅故事/录音态需要；文字态内容长，否则会压住可滚动空间） */}
        {!showTextInput && <div className="flex-1" />}
      </div>

      {/* 桌面端：2 栏 hero（参照 web.html home-hero）——左 文案+操作，右 Orb */}
      <div className="hidden lg:flex flex-1 min-h-0 items-center px-16 relative z-10 overflow-y-auto">
        <div className="grid grid-cols-2 items-center gap-16 w-full">
          {/* 左：分段 + 标题 + 副标题 + 操作 */}
          <div className="flex flex-col items-start max-w-md">
            {/* 分段控件（复用 ieltsMode） */}
            <div className="bg-bg-muted rounded-full p-1 inline-flex w-[228px] mb-8">
              <button
                onClick={() => setIeltsMode(false)}
                className={`flex-1 text-center py-2 text-[13px] font-semibold rounded-full transition-all ${!ieltsMode ? 'bg-bg-surface shadow-[0_1px_4px_rgba(0,0,0,0.10)] text-brand-primary-dark' : 'bg-transparent text-v2-text-muted'}`}
              >
                我的故事
              </button>
              <button
                onClick={() => { if (!ieltsMode) { setIeltsMode(true); void next() } }}
                className={`flex-1 text-center py-2 text-[13px] font-semibold rounded-full transition-all ${ieltsMode ? 'bg-bg-surface shadow-[0_1px_4px_rgba(0,0,0,0.10)] text-brand-primary-dark' : 'bg-transparent text-v2-text-muted'}`}
              >
                雅思题
              </button>
            </div>

            {/* 标题 + 副标题 */}
            {!ieltsMode ? (
              <>
                <h1 className="text-[34px] font-bold text-v2-text-primary tracking-tight leading-tight">说说你的故事</h1>
                <p className="text-[15px] text-v2-text-secondary leading-relaxed mt-3 max-w-md">不用背模板。把真实经历讲出来，AI 帮你拆解逻辑、匹配到合适的雅思口语题目。</p>
              </>
            ) : (
              <>
                <h1 className="text-[28px] font-bold text-v2-text-primary tracking-tight leading-snug min-h-[40px]">
                  {loading ? '换一题中…' : error ? '没取到题，点下面换一题重试' : question ? (question.part === 2 ? (question.cue_card_title_zh ?? '') : question.question_text_zh) : ''}
                </h1>
                <p className="text-[15px] text-v2-text-secondary leading-relaxed mt-3">聊聊你的看法</p>
                <button onClick={() => void next()} className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-v2-text-muted hover:opacity-70">
                  <RotateCw size={13} />换一题
                </button>
              </>
            )}

            {/* 操作区：默认（开始录音 + 或用文字输入）/ 文字面板 */}
            {!showTextInput ? (
              <div className="flex items-center gap-4 mt-8">
                <button onClick={() => void handleStartRecording()} className="btn-gradient w-[200px] h-[52px]">
                  <Mic2 size={16} className="text-v2-text-secondary" />
                  开始录音
                </button>
                <button onClick={() => setShowTextInput(true)} className="inline-flex items-center gap-1.5 text-[14px] text-v2-text-muted hover:text-v2-text-secondary">
                  <Pencil size={14} />
                  或用文字输入
                </button>
              </div>
            ) : (
              <div className="w-full mt-8 animate-fade-up">
                <div className="w-full bg-bg-surface border border-black/[0.06] rounded-[18px] pt-[18px] px-4 pb-[13px]">
                  <textarea
                    value={textStory}
                    onChange={e => setTextStory(e.target.value)}
                    placeholder={'用中文聊聊最近的一件小事，尽量说具体些……\n\n和谁一起、做了什么、当时心里什么感觉，都可以写进来。'}
                    className="w-full min-h-[180px] resize-none bg-transparent outline-none text-[15px] leading-[1.85] text-v2-text-primary placeholder:text-v2-text-muted"
                    autoFocus
                  />
                  <div className="flex items-center justify-between pt-[11px] border-t border-black/[0.05]">
                    <button onClick={() => setShowTextInput(false)} className="flex items-center gap-1.5 text-[13px] text-v2-text-muted hover:opacity-70">
                      <Mic2 size={15} />
                      改用录音
                    </button>
                    <button
                      disabled={!canSubmit || submitting}
                      onClick={() => void handleTextSubmit()}
                      aria-label="开始匹配题目"
                      className={canSubmit && !submitting ? 'btn-gradient-circle w-[42px] h-[42px]' : 'flex items-center justify-center w-[42px] h-[42px] rounded-full bg-bg-muted cursor-not-allowed'}
                    >
                      {submitting ? <Loader2 size={18} className="text-v2-text-muted animate-spin" /> : <ArrowRight size={18} className={canSubmit ? 'text-brand-primary-dark' : 'text-v2-text-muted'} />}
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex items-baseline justify-between px-1">
                  <span className="text-[12px] text-v2-text-muted tracking-[0.3px]">丰富度</span>
                  <span className={`text-[13px] ${isRich ? 'text-brand-accent font-medium' : 'text-v2-text-secondary'}`}>{richState}</span>
                </div>
                <div className="mt-2 px-1"><SegmentDots total={18} filled={richnessFilled} /></div>
              </div>
            )}
          </div>

          {/* 右：Orb */}
          <div className="flex items-center justify-center">
            <Orb size={400} pulse={false} />
          </div>
        </div>
      </div>
      </>
      )}

      <div className="flex-shrink-0"><TabBar /></div>
      <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />
      <FirstUseConsent />
      <MicPermissionSheet
        open={micSheet !== null}
        reason={micSheet ?? 'denied'}
        onUseText={() => { setMicSheet(null); setShowTextInput(true) }}
        onDismiss={() => setMicSheet(null)}
      />
    </div>
  )
}
