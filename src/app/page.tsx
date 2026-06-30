/**
 * @module   HomePage
 * @desc     首页 —— 移动端保持原竖排（顶栏 + 分段 + Orb + CTA + 文字面板 + 底部 TabBar）；
 *           桌面端为重设计：顶部横向导航 + 开放式 Hero + 三步 + 挑个话题（对齐 lingobridge-home-redesign.html）。
 *           两端共用同一套 state/handler，功能完全一致。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Mic2, RotateCw, ChevronLeft, ArrowRight, Loader2, Pencil, Sparkles, Puzzle, Target, PartyPopper, Smartphone, Mountain, User, ChevronRight } from 'lucide-react'
import Orb from '@/components/Orb'
import TopNav from '@/components/TopNav'
import TabBar from '@/components/TabBar'
import Card from '@/components/Card'
import Tag from '@/components/Tag'
import Chip from '@/components/Chip'
import GradientButton from '@/components/GradientButton'
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

const STEPS = [
  { Icon: Mic2,   accent: false, label: 'Step 01', title: '讲出真实经历', desc: '用中文或英文，说说发生过什么。卡壳也没关系，先把事讲完整。' },
  { Icon: Puzzle, accent: true,  label: 'Step 02', title: 'AI 帮你拆逻辑', desc: '理清结构、补上自然的表达，把口水话变成考官想听的回答。' },
  { Icon: Target, accent: false, label: 'Step 03', title: '匹配雅思题', desc: '一个故事，往往能对应好几道口语题——素材一次准备，反复复用。' },
] as const

const TOPICS = [
  { Icon: PartyPopper, title: 'Describe a celebration you remember', meta: 'Part 2 · 经历类' },
  { Icon: Smartphone,  title: 'Talk about an app you use a lot',     meta: 'Part 1 · 日常类' },
  { Icon: Mountain,    title: 'Describe a place in nature you like', meta: 'Part 2 · 地点类' },
  { Icon: User,        title: 'A person who influenced you',         meta: 'Part 2 · 人物类' },
] as const

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
    <>
      {/* ============ 移动端：原竖排布局（保持原样） ============ */}
      <div className="lg:hidden relative h-dvh bg-bg-page flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        {showTextInput ? (
          <div className="flex items-center justify-between h-[52px] px-5 relative z-10">
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
          <div className="flex items-center justify-between h-[52px] px-5 relative z-10">
            <span className="text-[16px] font-bold text-v2-text-primary">LingoBridge</span>
          </div>
        )}

        {/* 主体 */}
        {storyQuotaReached ? (
          <div className="flex-1 min-h-0 flex items-center justify-center relative z-10 overflow-y-auto pb-[72px]">
            <QuotaReached variant="story" />
          </div>
        ) : (
          <div className={`flex-1 min-h-0 flex flex-col relative z-10 overflow-y-auto ${showTextInput ? 'px-6 pt-5 pb-[120px]' : 'items-center px-7 pt-6 pb-[72px]'}`}>
            {!showTextInput && (
              <div className="flex justify-center mb-7">
                <div className="bg-bg-muted rounded-full p-1 inline-flex w-[228px]">
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
              </div>
            )}

            {!showTextInput && <Orb size={300} pulse={false} />}
            {!showTextInput && <div className="h-[41px]" />}

            <div className="w-full flex flex-col items-center">
              {!showTextInput && (
                <div className="text-center w-full">
                  {!ieltsMode ? (
                    <>
                      <h1 className="text-[20px] font-bold text-v2-text-primary tracking-tight">说说你的故事</h1>
                      <p className="text-[13px] text-v2-text-muted mt-2">精准匹配雅思口语题目</p>
                    </>
                  ) : (
                    <>
                      {!loading && error ? (
                        <p className="w-full text-center text-[13px] text-v2-text-muted min-h-[28px]">没取到题，点下面换一题重试</p>
                      ) : (
                        <h1 className="w-full text-center text-[20px] font-bold text-v2-text-primary tracking-tight leading-snug min-h-[28px]">
                          {loading ? '换一题中…' : question ? (question.part === 2 ? (question.cue_card_title_zh ?? '') : question.question_text_zh) : ''}
                        </h1>
                      )}
                      <p className="text-[13px] text-v2-text-muted mt-2">聊聊你的看法</p>
                      <button onClick={() => void next()} className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-v2-text-muted active:opacity-60">
                        <RotateCw size={12} />换一题
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className={`w-full ${showTextInput ? 'mt-0' : 'mt-4'}`}>
                {!showTextInput && (
                  <>
                    <button onClick={() => void handleStartRecording()} className="btn-gradient mx-auto w-[280px] h-[50px]">
                      <Mic2 size={16} className="text-v2-text-secondary" />
                      开始录音
                    </button>
                    <button onClick={() => setShowTextInput(true)} className="w-full text-center text-[13px] text-v2-text-muted mt-3 cursor-pointer">
                      或用文字输入
                    </button>
                  </>
                )}

                {showTextInput && (
                  <div className="w-full animate-fade-up">
                    <div className="w-full bg-bg-surface border border-black/[0.06] rounded-[18px] pt-[18px] px-4 pb-[13px]">
                      <textarea
                        value={textStory}
                        onChange={e => setTextStory(e.target.value)}
                        placeholder={'用中文聊聊最近的一件小事，尽量说具体些……\n\n和谁一起、做了什么、当时心里什么感觉，都可以写进来。'}
                        className="w-full min-h-[244px] resize-none bg-transparent outline-none text-[15px] leading-[1.85] text-v2-text-primary placeholder:text-v2-text-muted"
                        autoFocus
                      />
                      <div className="flex items-center justify-between pt-[11px] border-t border-black/[0.05]">
                        <button onClick={() => setShowTextInput(false)} className="flex items-center gap-1.5 text-[13px] text-v2-text-muted active:opacity-60">
                          <Mic2 size={15} />改用录音
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
                )}
              </div>
            </div>

            {!showTextInput && <div className="flex-1" />}
          </div>
        )}

        <div className="flex-shrink-0"><TabBar /></div>
      </div>

      {/* ============ 桌面端：顶部导航 + 开放式 Hero + 三步 + 挑个话题 ============ */}
      <div className="hidden lg:block min-h-screen bg-bg-page">
        <TopNav />
        <main className="max-w-[1080px] mx-auto px-14 pb-20">
          {storyQuotaReached ? (
            <div className="py-20 flex justify-center">
              <QuotaReached variant="story" />
            </div>
          ) : (
            <>
              {/* Hero（开放式，无方框） */}
              <section className="relative pt-[88px] pb-2">
                {/* 极淡氛围光（参考 .hero::before，置于 Orb 背后；不贴顶，避免 standalone 顶部色差缝） */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute"
                  style={{
                    top: '-40px', right: '-40px', width: '620px', height: '620px',
                    background: 'radial-gradient(circle, rgba(240,188,160,0.14) 0%, rgba(168,210,196,0.10) 38%, rgba(188,210,168,0.06) 56%, transparent 72%)',
                    filter: 'blur(40px)', zIndex: 0,
                  }}
                />
                <div className="relative z-[1] flex flex-row items-center gap-10">
                  {/* 左：切换器 + 文案 + 操作 */}
                  <div className="flex-1 max-w-[560px]">
                    {/* 我的故事 / 雅思题 切换器（原功能保留） */}
                    <div className="inline-flex items-center gap-1 bg-bg-muted rounded-full p-1 mb-7">
                      <Chip variant="ghost" active={!ieltsMode} onClick={() => setIeltsMode(false)}>我的故事</Chip>
                      <Chip variant="ghost" active={ieltsMode} onClick={() => { if (!ieltsMode) { setIeltsMode(true); void next() } }}>雅思题</Chip>
                    </div>

                    {showTextInput ? (
                      /* 文字输入面板 */
                      <div className="animate-fade-up max-w-[520px]">
                        <div className="bg-bg-surface border border-black/[0.06] rounded-[18px] pt-[18px] px-4 pb-[13px]">
                          <textarea
                            value={textStory}
                            onChange={e => setTextStory(e.target.value)}
                            placeholder={'用中文聊聊最近的一件小事，尽量说具体些……\n\n和谁一起、做了什么、当时心里什么感觉，都可以写进来。'}
                            className="w-full min-h-[180px] resize-none bg-transparent outline-none text-[15px] leading-[1.85] text-v2-text-primary placeholder:text-v2-text-muted"
                            autoFocus
                          />
                          <div className="flex items-center justify-between pt-[11px] border-t border-black/[0.05]">
                            <button onClick={() => setShowTextInput(false)} className="flex items-center gap-1.5 text-[13px] text-v2-text-muted hover:opacity-70">
                              <Mic2 size={15} />改用录音
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
                    ) : (
                      <>
                        {!ieltsMode && (
                          <Tag variant="green" icon={<Sparkles size={15} />} label="从一个真实经历开始" className="mb-6" />
                        )}
                        <h1 className={!ieltsMode
                          ? 'text-[52px] font-bold leading-[1.12] tracking-tight text-v2-text-primary'
                          : 'text-[34px] font-bold leading-snug tracking-tight text-v2-text-primary min-h-[40px]'}>
                          {!ieltsMode
                            ? '说说你的故事'
                            : (loading ? '换一题中…' : error ? '没取到题，点下面换一题重试' : question ? (question.part === 2 ? (question.cue_card_title_zh ?? '') : question.question_text_zh) : '')}
                        </h1>
                        <p className="mt-5 text-[17px] leading-[1.7] text-v2-text-secondary max-w-[470px]">
                          {!ieltsMode ? '不用背模板。把发生过的事讲出来，AI 帮你理清逻辑、补上地道表达，再匹配到合适的雅思口语题。' : '聊聊你的看法'}
                        </p>
                        {ieltsMode && (
                          <button onClick={() => void next()} className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-v2-text-muted hover:opacity-70">
                            <RotateCw size={13} />换一题
                          </button>
                        )}
                        <div className="mt-9 flex items-center gap-5 flex-wrap">
                          <GradientButton onClick={() => void handleStartRecording()} className="inline-flex items-center gap-2.5 px-7 py-[15px] rounded-full text-[15px] font-semibold">
                            <Mic2 size={18} />开始录音
                          </GradientButton>
                          <button onClick={() => setShowTextInput(true)} className="inline-flex items-center gap-1.5 text-[14px] text-v2-text-muted hover:text-v2-text-secondary">
                            <Pencil size={15} />或用文字输入
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* 右：Orb（继续用项目 Orb 组件，静态展示） */}
                  <div className="flex-shrink-0 self-center flex justify-center w-[380px]">
                    <Orb size={360} pulse={false} />
                  </div>
                </div>
              </section>

              {/* 三步 */}
              <section className="mt-20">
                <div className="mb-7">
                  <h2 className="text-[28px] font-bold tracking-tight text-v2-text-primary">三步，把经历变成高分回答</h2>
                  <p className="mt-2 text-[14px] text-v2-text-muted">这正是 LingoBridge 和背题库不一样的地方</p>
                </div>
                <div className="grid grid-cols-3 gap-6">
                  {STEPS.map(({ Icon, accent, label, title, desc }) => (
                    <Card key={label} className="p-7 transition-transform hover:-translate-y-0.5">
                      <div className={`w-12 h-12 rounded-[14px] grid place-items-center ${accent ? 'bg-brand-accent-light text-brand-accent' : 'bg-bg-muted text-v2-text-secondary'}`}>
                        <Icon size={22} />
                      </div>
                      <div className="mt-[22px] text-[12px] font-semibold tracking-[0.08em] uppercase text-v2-text-muted">{label}</div>
                      <h3 className="mt-2 text-[18px] font-semibold text-v2-text-primary">{title}</h3>
                      <p className="mt-3 text-[15px] leading-[1.7] text-v2-text-secondary">{desc}</p>
                    </Card>
                  ))}
                </div>
              </section>

              {/* 挑个话题 */}
              <section className="mt-20">
                <div className="mb-7">
                  <h2 className="text-[28px] font-bold tracking-tight text-v2-text-primary">挑个话题，现在就试试</h2>
                  <p className="mt-2 text-[14px] text-v2-text-muted">想不到讲什么？从这些常见话题起步</p>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  {TOPICS.map(({ Icon, title, meta }) => (
                    <Card key={title} className="p-[18px] flex items-center gap-4">
                      <div className="w-11 h-11 rounded-[12px] grid place-items-center bg-bg-muted text-v2-text-secondary flex-shrink-0">
                        <Icon size={22} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[17px] font-semibold text-v2-text-primary truncate">{title}</div>
                        <div className="mt-1 text-[13px] font-medium tracking-[0.04em] uppercase text-v2-text-muted">{meta}</div>
                      </div>
                      <ChevronRight size={20} className="text-v2-text-muted flex-shrink-0" />
                    </Card>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      {/* 共享：提示 / 首次同意 / 麦克风权限弹层 */}
      <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />
      <FirstUseConsent />
      <MicPermissionSheet
        open={micSheet !== null}
        reason={micSheet ?? 'denied'}
        onUseText={() => { setMicSheet(null); setShowTextInput(true) }}
        onDismiss={() => setMicSheet(null)}
      />
    </>
  )
}
