/**
 * @module   HomePage
 * @desc     首页 —— 移动端保持原竖排（顶栏 + 分段 + Orb + CTA + 文字面板 + 底部 TabBar）；
 *           桌面端为营销落地页重构：Hero（打字机标题 + Orb）+ 能力三卡 + 匹配漏斗 + Leo 对话 + 信息复用三卡。
 *           两端共用同一套 state/handler，功能完全一致；桌面文案含占位，见各处 TODO。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useCallback, useEffect, type ReactNode } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Mic2, RotateCw, ChevronLeft, ArrowRight, Loader2, Pencil, Sparkles, Target, MessageCircle, Layers, Wand2, RefreshCw } from 'lucide-react'
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
import { PAGE_CONTAINER, BRAND_GRADIENT } from '@/lib/constants'

// Hero 标题第二行（故事模式下打字机逐字浮现）
const HERO_LINE2 = '个性化雅思语料'

// TODO: 文案待确认 —— 以下桌面营销模块文案取自参考稿占位，非最终产品文案
// 模块二：能力三卡
const FEATURES = [
  { Icon: Target,        tint: 'primary', title: '语料匹配题目', lead: '你的故事，就是你的素材库', desc: '讲一段真实经历，AI 帮你反向匹配到最贴合的当季雅思真题，不用再去题海里瞎撞。' },
  { Icon: MessageCircle, tint: 'accent',  title: '重组语料',     lead: '陪你把故事说顺、说地道',   desc: '和 AI 对话伙伴 Leo 一起聊这段经历，说得不够好就当场优化、再说一遍——练的是真正开口的能力，不是背答案。' },
  { Icon: Layers,        tint: 'primary', title: '信息复用',     lead: '练过的东西，不会白练',     desc: '对话里优化过的好句子、分析出的相关词组、读错的发音，都能存进素材库，用几分钟小练习反复巩固。' },
] as const

const MATCH_STEPS = [
  { n: 1, dot: 'bg-brand-primary',      title: '先看你这段故事最核心讲的是什么', desc: '直接拿这个核心去题库里找最匹配的雅思题——一次就命中，直接推给你。' },
  { n: 2, dot: 'bg-brand-accent',       title: '没找到？换个角度再试一次',       desc: '如果最核心的重点暂时没有对应的题，我们会看看这段故事还能讲出什么别的重点，换个角度再匹配一次。' },
  { n: 3, dot: 'bg-brand-primary-dark', title: '两个角度都没有？我们如实告诉你', desc: '不会为了凑数硬塞一道不搭边的题给你——而是坦诚说明，并且认可这段经历本身就很值得讲。' },
] as const

// 模块四：Leo 对话示意（占位对话）+ 右侧三点说明
const LEO_DIALOGUE = [
  { from: 'leo',  text: 'Oh nice, coffee sounds perfect. Do you sit down right away?' },
  { from: 'user', text: 'I usually just unwind for a moment, and then I make myself a cup of coffee.' },
  { from: 'leo',  text: 'Got it — what does that "unwinding" feel like in your body?' },
] as const

const RESTRUCTURE_POINTS = [
  { Icon: Wand2,  title: '句子不满意？点「优化反馈」',   desc: '看看更地道的说法，简单记忆之后自己再重新表达一遍，形成「输入-输出」的循环，而不是照读答案。' },
  { Icon: Mic2,   title: '读错的单词，点一下就能收藏',   desc: '发音被听错的词会被记下来，练习结束后能在素材库里做针对性的发音纠错练习。' },
  { Icon: Layers, title: '练完会有一叠反馈卡片',         desc: '都是这次对话里被优化过的好句子——眼熟的左滑跳过，想留下的右滑收藏进语料。' },
] as const

const tintClass = (t: 'primary' | 'accent'): string =>
  t === 'accent' ? 'bg-brand-accent-light text-brand-accent' : 'bg-brand-primary-light text-brand-primary-dark'

/** 桌面营销区块统一居中页头：小标签 + 标题（可含 accent）+ 副标题 */
function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub: string }) {
  return (
    <div className="text-center max-w-[560px] mx-auto mb-14">
      <p className="text-[12.5px] font-semibold text-brand-accent tracking-wide mb-2.5">{eyebrow}</p>
      <h2 className="text-[30px] font-bold tracking-tight text-v2-text-primary leading-snug mb-4">{title}</h2>
      <p className="text-[15px] text-v2-text-secondary leading-relaxed">{sub}</p>
    </div>
  )
}

export default function HomePage() {
  const router = useRouter()
  const [showTextInput, setShowTextInput] = useState(false)
  const [textStory, setTextStory] = useState('')
  const [ieltsMode, setIeltsMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [storyQuotaReached, setStoryQuotaReached] = useState(false)
  const [micSheet, setMicSheet] = useState<null | 'denied' | 'unavailable'>(null)
  const [typed, setTyped] = useState('')
  const { question, loading, error, next } = useSwitchQuestion()

  // 打字机：故事模式下 Hero 标题第二行逐字浮现，打完停顿后循环重放（持续的动态打字效果）
  useEffect(() => {
    if (ieltsMode) { setTyped(''); return }
    let i = 0
    let timer = 0
    const step = () => {
      i += 1
      setTyped(HERO_LINE2.slice(0, i))
      if (i >= HERO_LINE2.length) {
        timer = window.setTimeout(() => { i = 0; setTyped(''); step() }, 2000)
      } else {
        timer = window.setTimeout(step, 160)
      }
    }
    step()
    return () => window.clearTimeout(timer)
  }, [ieltsMode])

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

  // 文字输入面板（移动端/桌面端共用结构，尺寸由外层控制）
  const textPanel = (minH: string) => (
    <div className="w-full animate-fade-up">
      <div className="w-full bg-bg-surface border border-black/[0.06] rounded-[18px] pt-[18px] px-4 pb-[13px]">
        <textarea
          value={textStory}
          onChange={e => setTextStory(e.target.value)}
          placeholder={'用中文聊聊最近的一件小事，尽量说具体些……\n\n和谁一起、做了什么、当时心里什么感觉，都可以写进来。'}
          className={`w-full ${minH} resize-none bg-transparent outline-none text-[15px] leading-[1.85] text-v2-text-primary placeholder:text-v2-text-muted`}
          autoFocus
        />
        <div className="flex items-center justify-between pt-[11px] border-t border-black/[0.05]">
          <button onClick={() => setShowTextInput(false)} className="flex items-center gap-1.5 text-[13px] text-v2-text-muted hover:opacity-70 active:opacity-60">
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
  )

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
                  <div className="w-full">
                    {textPanel('min-h-[244px]')}
                  </div>
                )}
              </div>
            </div>

            {!showTextInput && <div className="flex-1" />}
          </div>
        )}

        <div className="flex-shrink-0"><TabBar /></div>
      </div>

      {/* ============ 桌面端：营销落地页（Hero + 能力三卡 + 匹配漏斗 + Leo 对话 + 信息复用） ============ */}
      <div className="hidden lg:block min-h-screen bg-bg-page">
        <TopNav />
        <main className={PAGE_CONTAINER}>
          {storyQuotaReached ? (
            <div className="py-20 flex justify-center">
              <QuotaReached variant="story" />
            </div>
          ) : (
            <>
              {/* ===== 模块一：Hero（导航紧跟顶部；标题打字机；右侧 Orb 放大）——整屏高、内容偏上，一屏一模块 ===== */}
              <section className="relative overflow-hidden min-h-[calc(100dvh_-_72px)] flex flex-col justify-start pt-[8vh] pb-12">
                {/* 极淡氛围光（装饰，置于 Orb 背后） */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute"
                  style={{
                    top: '-120px', right: '-60px', width: '640px', height: '640px',
                    background: 'radial-gradient(circle, rgba(240,188,160,0.18) 0%, rgba(168,210,196,0.12) 38%, rgba(188,210,168,0.07) 56%, transparent 72%)',
                    filter: 'blur(60px)', zIndex: 0,
                  }}
                />
                <div className="relative z-[1] grid grid-cols-2 gap-10 items-center pl-12">
                  {/* 左：切换器 + 文案 + 操作（整体再右移、更靠中 pl-16） */}
                  <div className="max-w-[560px] pl-16">
                    {/* 我的故事 / 雅思题 切换器（功能保留） */}
                    <div className="flex w-[240px] rounded-[10px] p-[3px] bg-bg-muted mb-7">
                      <button
                        onClick={() => setIeltsMode(false)}
                        className={`flex-1 h-[34px] rounded-[8px] text-[13px] font-medium transition-colors ${!ieltsMode ? 'bg-white text-v2-text-primary font-semibold shadow-sm' : 'text-v2-text-muted'}`}
                      >
                        我的故事
                      </button>
                      <button
                        onClick={() => { if (!ieltsMode) { setIeltsMode(true); void next() } }}
                        className={`flex-1 h-[34px] rounded-[8px] text-[13px] font-medium transition-colors ${ieltsMode ? 'bg-white text-v2-text-primary font-semibold shadow-sm' : 'text-v2-text-muted'}`}
                      >
                        雅思题
                      </button>
                    </div>

                    {showTextInput ? (
                      <div className="max-w-[520px]">{textPanel('min-h-[180px]')}</div>
                    ) : (
                      <>
                        {!ieltsMode && (
                          <Tag variant="green" icon={<Sparkles size={15} />} label="从一个真实经历开始" className="mb-6" />
                        )}
                        {!ieltsMode ? (
                          <h1 className="text-[56px] font-bold leading-[1.14] tracking-tight text-v2-text-primary">
                            分享你的经历
                            {/* 第二行右移约一个字，错开成阶梯（个 在 享 下方）；文字逐字打字机浮现 */}
                            <span className="block text-brand-primary ml-[1em]">
                              {typed}
                              <span className="inline-block w-[3px] h-[0.82em] bg-brand-primary align-middle ml-1 animate-blink" />
                            </span>
                          </h1>
                        ) : (
                          <h1 className="text-[34px] font-bold leading-snug tracking-tight text-v2-text-primary min-h-[40px]">
                            {loading ? '换一题中…' : error ? '没取到题，点下面换一题重试' : question ? (question.part === 2 ? (question.cue_card_title_zh ?? '') : question.question_text_zh) : ''}
                          </h1>
                        )}
                        <p className="mt-6 text-[17px] leading-[1.7] text-v2-text-secondary max-w-[470px]">
                          {!ieltsMode ? '不用背模板。把发生过的事讲出来，AI 帮你理清逻辑、补上地道表达，再匹配到合适的雅思口语题。' : '聊聊你的看法'}
                        </p>
                        {ieltsMode && (
                          <button onClick={() => void next()} className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-v2-text-muted hover:opacity-70">
                            <RotateCw size={13} />换一题
                          </button>
                        )}
                        <div className="mt-9 flex items-center gap-5 flex-wrap">
                          <GradientButton onClick={() => void handleStartRecording()} className="inline-flex items-center gap-2.5 px-7 py-[15px] rounded-full text-[15px] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
                            <Mic2 size={18} />开始录音
                          </GradientButton>
                          <button onClick={() => setShowTextInput(true)} className="inline-flex items-center gap-1.5 text-[14px] text-v2-text-muted hover:text-v2-text-secondary">
                            <Pencil size={15} />或用文字输入
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* 右：Orb（现有组件，放大到 400；不加浮动小卡片）——比文案再上移一点 */}
                  <div className="flex justify-center items-center -mt-8">
                    <Orb size={400} pulse={false} />
                  </div>
                </div>
              </section>

              {/* ===== 模块二：我们能为你做什么（能力三卡）——整屏高、内容居中 ===== */}
              <section className="min-h-[calc(100dvh_-_72px)] flex flex-col justify-center py-16">
                <SectionHead
                  eyebrow="从一段经历到一次自信开口"
                  title={<>我们能为你做<span className="text-brand-primary">什么</span></>}
                  sub="不是又一个题库 App，是帮你把自己的故事，练成能考场脱口而出的表达"
                />
                <div className="grid grid-cols-3 gap-6">
                  {FEATURES.map(({ Icon, tint, title, lead, desc }) => (
                    <Card key={title} className="px-6 pt-8 pb-7 text-center transition-transform duration-200 hover:-translate-y-1">
                      <div className={`mx-auto mb-5 w-16 h-16 rounded-[18px] grid place-items-center ${tintClass(tint)}`}>
                        <Icon size={28} strokeWidth={2} />
                      </div>
                      <h3 className="text-[16px] font-semibold text-v2-text-primary">{title}</h3>
                      <p className="mt-2 text-[13.5px] font-semibold text-brand-primary-dark">{lead}</p>
                      <p className="mt-1.5 text-[13px] text-v2-text-secondary leading-relaxed">{desc}</p>
                    </Card>
                  ))}
                </div>
              </section>

              {/* ===== 模块三：语料匹配题目怎么运作（漏斗 + 三步）——整屏高、内容居中 ===== */}
              <section className="min-h-[calc(100dvh_-_72px)] flex flex-col justify-center py-16">
                <SectionHead
                  eyebrow="语料匹配题目"
                  title={<>你的故事，怎么变成<span className="text-brand-primary">一道题</span></>}
                  sub="不是关键词硬凑，我们分三步来找最适合你这段经历的题"
                />
                <div className="grid grid-cols-[0.85fr_1.15fr] gap-14 items-center">
                  {/* 左：漏斗示意图（品牌配色螺旋丝带，已抠除背景的透明 PNG） */}
                  <div className="flex flex-col items-center">
                    <Image
                      src="/funnel-spiral.png"
                      alt="三步匹配漏斗示意"
                      width={2124}
                      height={2016}
                      className="w-full max-w-[340px] h-auto"
                    />
                  </div>

                  {/* 右：三步说明 + 六维度提示 */}
                  <div className="flex flex-col gap-7">
                    {MATCH_STEPS.map(({ n, dot, title, desc }) => (
                      <div key={n} className="flex gap-4">
                        <div className={`w-[30px] h-[30px] rounded-full flex-shrink-0 grid place-items-center text-white text-[13px] font-bold ${dot}`}>{n}</div>
                        <div>
                          <h4 className="text-[15.5px] font-semibold text-v2-text-primary">{title}</h4>
                          <p className="mt-1.5 text-[13.5px] text-v2-text-secondary leading-relaxed">{desc}</p>
                        </div>
                      </div>
                    ))}
                    <div className="bg-bg-muted rounded-[12px] px-4 py-3.5 text-[12.5px] text-v2-text-secondary leading-relaxed">
                      <b className="text-v2-text-primary font-semibold">找到的题不止一道时</b>，我们会按「用这段故事能不能直接答上」从高到低帮你排好序，最顺手的排最前面。这套判断背后是我们总结的
                      <b className="text-v2-text-primary font-semibold"> 六个维度 </b>
                      ——情绪、人际、空间、精神世界、成长、价值观，帮 AI 更准确地读懂你故事里的重点。
                    </div>
                  </div>
                </div>
              </section>

              {/* ===== 模块四：重组语料怎么运作（Leo 对话示意 + 三点） ===== */}
              {/* TODO: 文案待确认 —— Leo 对话为占位示意；如需可复用真实 AiBubble/UserBubble 组件渲染 */}
              <section className="min-h-[calc(100dvh_-_72px)] flex flex-col justify-center py-16">
                <SectionHead
                  eyebrow="重组语料"
                  title={<>和 Leo 一起，把故事练成<span className="text-brand-primary">脱口而出</span></>}
                  sub="根据你在题目分析里选的雅思水平，Leo 会陪你就这段经历继续聊下去"
                />
                <div className="grid grid-cols-[0.95fr_1.05fr] gap-14 items-center">
                  {/* 左：练习对话 mockup */}
                  <Card className="p-5">
                    {/* 步骤条示意 */}
                    <div className="flex items-center gap-1.5 mb-4 px-0.5">
                      {[0, 1, 2, 3].map(i => (
                        <div key={i} className="flex items-center flex-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-brand-primary" />
                          <span className="flex-1 h-[1.5px] bg-brand-primary" />
                        </div>
                      ))}
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-primary ring-[3px] ring-brand-primary/25" />
                    </div>
                    <span className="inline-block text-[11px] text-v2-text-secondary bg-bg-muted rounded-[8px] px-2.5 py-1.5 mb-3.5">
                      Part 1 · What do you usually do when you are resting?
                    </span>
                    {LEO_DIALOGUE.map(({ from, text }, i) => (
                      <div key={i} className={`flex gap-2 mb-3 items-start ${from === 'user' ? 'flex-row-reverse' : ''}`}>
                        <span className="w-[26px] h-[26px] rounded-full flex-shrink-0" style={{ background: BRAND_GRADIENT }} />
                        <div className={`relative max-w-[76%] px-3.5 py-2.5 text-[12.5px] leading-relaxed ${from === 'user' ? 'bg-brand-accent-light text-v2-text-primary rounded-[13px] rounded-tr-[4px]' : 'bg-bg-muted text-v2-text-primary rounded-[13px] rounded-tl-[4px]'}`}>
                          {from === 'user' && <span className="absolute -top-2 -left-2 text-[12px]">✨</span>}
                          {text}
                        </div>
                      </div>
                    ))}
                    <div className="mt-2.5 flex items-center justify-center gap-1.5 border border-brand-primary rounded-full py-2.5 text-[12px] font-semibold text-brand-primary-dark">
                      <Mic2 size={14} />按住说话
                    </div>
                  </Card>

                  {/* 右：三点说明 */}
                  <div className="flex flex-col gap-6">
                    {RESTRUCTURE_POINTS.map(({ Icon, title, desc }) => (
                      <div key={title} className="flex gap-3.5">
                        <div className="w-[34px] h-[34px] rounded-[10px] flex-shrink-0 grid place-items-center bg-brand-accent-light text-brand-accent">
                          <Icon size={17} strokeWidth={2} />
                        </div>
                        <div>
                          <h4 className="text-[15px] font-semibold text-v2-text-primary">{title}</h4>
                          <p className="mt-1 text-[13.5px] text-v2-text-secondary leading-relaxed">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* ===== 模块五：信息复用怎么用（三卡等高） ===== */}
              {/* TODO: 文案待确认 —— 三张卡的示意内容为占位；如需可复用真实 拼句/复习卡/发音 组件缩略渲染 */}
              <section className="min-h-[calc(100dvh_-_72px)] flex flex-col justify-center py-16">
                <SectionHead
                  eyebrow="信息复用"
                  title={<>收藏的内容，去<span className="text-brand-primary">素材库</span>继续巩固</>}
                  sub="三种不同的练习，分别对应你收藏的三类东西"
                />
                <div className="grid grid-cols-3 gap-6 items-stretch">
                  {/* 拼句练习 */}
                  <Card className="p-5 h-full flex flex-col">
                    <div className="h-[180px] rounded-[12px] bg-bg-muted mb-4 flex items-center justify-center px-4">
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {['actually', 'gym', 'roommate', 'card.', 'my', 'stole', 'My'].map((w, i) => (
                          <Chip key={i} variant="default" size="sm">{w}</Chip>
                        ))}
                      </div>
                    </div>
                    <h3 className="text-[15.5px] font-semibold text-v2-text-primary">拼句练习</h3>
                    <p className="mt-1.5 text-[13px] text-v2-text-secondary leading-relaxed">收藏的句子会被拆成词块，打乱后让你按顺序拼回去，练的是语序和用词的肌肉记忆。</p>
                  </Card>

                  {/* Anki 复习 */}
                  <Card className="p-5 h-full flex flex-col">
                    <div className="h-[180px] rounded-[12px] bg-bg-muted mb-4 flex flex-col items-center justify-center gap-2.5 px-4">
                      <div className="flex items-center gap-2">
                        {/* 正面 / 背面 —— 同尺寸并排 */}
                        <div className="w-24 h-[104px] bg-white rounded-[10px] px-2 py-2.5 flex flex-col items-center justify-center text-center">
                          <Tag variant="green" label="感受" className="text-[9px] px-[6px] py-[2px]" />
                          <div className="mt-1.5 text-[12.5px] font-bold text-v2-text-primary leading-tight">有点纠结</div>
                        </div>
                        <RefreshCw size={16} strokeWidth={2.2} className="text-v2-text-muted flex-shrink-0" />
                        <div className="w-24 h-[104px] bg-white rounded-[10px] px-2 py-2.5 flex flex-col items-center justify-center text-center">
                          <Tag variant="green" label="感受" className="text-[9px] px-[6px] py-[2px]" />
                          <div className="mt-1.5 text-[12.5px] font-bold text-v2-text-primary leading-tight">kind of torn</div>
                          <div className="text-[10px] text-brand-accent mt-0.5">有点纠结</div>
                        </div>
                      </div>
                      <p className="text-[11px] text-v2-text-muted text-center max-w-[220px] leading-snug">点击卡片翻面，背面会给出这个表达的解释和例句</p>
                    </div>
                    <h3 className="text-[15.5px] font-semibold text-v2-text-primary">Anki 复习</h3>
                    <p className="mt-1.5 text-[13px] text-v2-text-secondary leading-relaxed">收藏的词组按间隔重复的节奏安排复习提醒，帮你把一时记住的生词变成长期记忆。</p>
                  </Card>

                  {/* 发音教学 */}
                  <Card className="p-5 h-full flex flex-col">
                    <div className="h-[180px] rounded-[12px] bg-bg-muted mb-4 flex items-center justify-center px-4">
                      <div className="w-full bg-white rounded-[10px] p-3.5 text-[12px]">
                        <div className="flex justify-between mb-2">
                          <span className="text-v2-text-secondary">想说的词</span>
                          <span className="font-bold text-brand-accent">Gym /dʒɪm/</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[11px] text-v2-text-muted">被听成 →</span>
                          <span className="font-bold text-error">drink /drɪŋk/</span>
                        </div>
                      </div>
                    </div>
                    <h3 className="text-[15.5px] font-semibold text-v2-text-primary">发音教学</h3>
                    <p className="mt-1.5 text-[13px] text-v2-text-secondary leading-relaxed">告诉你被系统听成了什么、和正确发音的区别在哪，针对性练到能被准确识别为止。</p>
                  </Card>
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
