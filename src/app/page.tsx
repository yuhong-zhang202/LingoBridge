/**
 * @module   HomePage
 * @desc     首页 —— 移动端保持原竖排（顶栏 + 分段 + Orb + CTA + 文字面板 + 底部 TabBar）；
 *           桌面端为营销落地页重构：Hero（打字机标题 + Orb）+ 能力三卡 + 匹配漏斗 + Leo 对话 + 信息复用三卡。
 *           两端共用同一套 state/handler，功能完全一致；桌面文案含占位，见各处 TODO。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useEffect, useRef, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Mic2, RotateCw, ChevronLeft, Pencil, Sparkles, Target, MessageCircle, Layers, Puzzle, Volume2, type LucideIcon } from 'lucide-react'
import Orb from '@/components/Orb'
import TopNav from '@/components/TopNav'
import TabBar from '@/components/TabBar'
import Card from '@/components/Card'
import Tag from '@/components/Tag'
import Chip from '@/components/Chip'
import GradientButton from '@/components/GradientButton'
import PartTag from '@/components/PartTag'
import Toast from '@/components/Toast'
import Reveal from '@/components/Reveal'
import FirstUseConsent from '@/components/FirstUseConsent'
import MicPermissionSheet from '@/components/MicPermissionSheet'
import QuotaReached from '@/components/QuotaReached'
import StoryTextPanel from '@/components/StoryTextPanel'
import AiBubble from '@/app/practice/_components/AiBubble'
import UserBubble from '@/app/practice/_components/UserBubble'
import OrbSoft from '@/app/practice/_components/OrbSoft'
import { useSwitchQuestion } from '@/hooks/useSwitchQuestion'
import { useStorySubmit } from '@/hooks/useStorySubmit'
import { computeRichness } from '@/lib/story-richness'
import { getAccount } from '@/lib/auth'
import { countCorpusThisMonth, STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { GRADIENT_BORDER_STYLE, PAGE_CONTAINER } from '@/lib/constants'

// Hero 标题第二行（故事模式下打字机逐字浮现）
const HERO_LINE2 = '个性化雅思语料'

// TODO: 文案待确认 —— 以下桌面营销模块文案取自参考稿占位，非最终产品文案
// 模块二：能力三卡
const FEATURES: { Icon: LucideIcon; img?: string; tint: 'primary' | 'accent'; title: string; lead: string; desc: string }[] = [
  { Icon: Target,        img: '/icon-corpus-match.png', tint: 'primary', title: '语料匹配题目', lead: '你的故事，就是你的素材库', desc: '讲一段真实经历，我们帮你反向匹配到最贴合的当季雅思真题，不用再去题海里瞎撞。' },
  { Icon: MessageCircle, img: '/icon-restructure.png',  tint: 'accent',  title: '重组语料',     lead: '陪你把故事说顺、说地道',   desc: '和对话伙伴 Leo 一起聊这段经历，说得不够好就当场优化、再说一遍——练的是真正开口的能力，不是背答案。' },
  { Icon: Layers,        img: '/icon-reuse.png',        tint: 'primary', title: '信息复用',     lead: '练过的东西，不会白练',     desc: '对话里优化过的好句子、分析出的相关词组、读错的发音，都能存进素材库，用几分钟小练习反复巩固。' },
]

// dot 为步骤号圆圈底色：承载白字，故用达标的 strong/dark/accent-dark（非全局品牌橙绿）
const MATCH_STEPS = [
  { n: 1, dot: 'bg-brand-primary-strong', title: '语料输入',             desc: '录音或文字均可。可选择"分享故事"或"讨论雅思题目"两种模式。想不到经历时，直接选题讨论，用中文口述思路即可。' },
  { n: 2, dot: 'bg-brand-primary-dark',   title: '匹配 Part 1 / Part 2', desc: '基于核心内容，优先匹配可直接作答的 Part 1、2 真题，命中即推荐。' },
  { n: 3, dot: 'bg-brand-accent-dark',    title: '切换语料侧重点',        desc: '核心角度没有对应题目时，调整表达侧重，尝试匹配其他 Part 1、2 真题，扩大覆盖范围。' },
  { n: 4, dot: 'bg-brand-accent-dark',    title: '对话延伸 Part 3',       desc: '与 Leo 练习对话时，话题自然延伸至 Part 3，完成三部分全覆盖。' },
] as const

// 模块四：Leo 对话示意（占位对话）+ 右侧三点说明
const LEO_DIALOGUE = [
  { from: 'leo',  text: 'Oh nice, coffee sounds perfect. Do you sit down right away?' },
  { from: 'user', text: 'I usually just unwind for a moment, and then I make myself a cup of coffee.' },
  { from: 'leo',  text: 'Got it — what does that "unwinding" feel like in your body?' },
] as const

// dot：与模块三步骤圆圈同款（圆形实心填充 + 白色编号 1/2/3，strong/dark/accent-dark）
const RESTRUCTURE_POINTS = [
  { dot: 'bg-brand-primary-strong', title: '句子不满意？点「优化反馈」',   desc: '看看更地道的说法，简单记忆之后自己再重新表达一遍，形成「输入-输出」的循环，而不是照读答案。' },
  { dot: 'bg-brand-primary-dark',   title: '读错的单词，点一下就能收藏',   desc: '发音被听错的词会被记下来，练习结束后能在素材库里做针对性的发音纠错练习。' },
  { dot: 'bg-brand-accent-dark',    title: '练完会有一叠反馈卡片',         desc: '都是这次对话里被优化过的好句子——眼熟的左滑跳过，想留下的右滑收藏进语料。' },
] as const

const tintClass = (t: 'primary' | 'accent'): string =>
  t === 'accent' ? 'bg-brand-accent-light text-brand-accent' : 'bg-brand-primary-light text-brand-primary-dark'

/** 展示性假件容器：整棵子树退出 Tab 序、不可点、移出无障碍树（营销 mockup 复用了真实交互组件，但无实际作用）。
 *  React 18 无 inert 的 JSX 类型且传布尔会告警，故经 ref 挂属性（同 CollectedCard 选择模式的做法）。
 *  不额外加 aria-hidden：现代浏览器下 inert 已移出无障碍树，而在不支持 inert 的旧环境里，
 *  aria-hidden 反而会造出「可聚焦却不被播报」的更差状态。 */
function InertBlock({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.setAttribute('inert', '') }, [])
  return <div ref={ref} className={className}>{children}</div>
}

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
  const [storyQuotaReached, setStoryQuotaReached] = useState(false)
  const [micSheet, setMicSheet] = useState<null | 'denied' | 'unavailable'>(null)
  const [typed, setTyped] = useState('')
  const { question, loading, error, next } = useSwitchQuestion()
  // 文字提交复用共享 hook；qid 取首页语义（雅思模式带当前题 id，否则 null）
  const { submitting, toastMsg, submit, dismissToast } = useStorySubmit({ text: textStory, qid: ieltsMode && question ? question.id : null })

  // 打字机：故事模式下 Hero 标题第二行逐字浮现，打完停顿后循环重放（持续的动态打字效果）。
  // 这是 JS 驱动的循环动画，globals.css 的 reduced-motion 兜底管不住 → 开启「减弱动效」时直接显示完整标题、不启动定时器。
  useEffect(() => {
    if (ieltsMode) { setTyped(''); return }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setTyped(HERO_LINE2); return }
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
                    aria-pressed={!ieltsMode}
                    className={`flex-1 text-center py-2 text-[13px] font-semibold rounded-full transition-all ${!ieltsMode ? 'bg-bg-surface shadow-[0_1px_4px_rgba(0,0,0,0.10)] text-brand-primary-dark' : 'bg-transparent text-v2-text-muted'}`}
                  >
                    我的故事
                  </button>
                  <button
                    onClick={() => { if (!ieltsMode) { setIeltsMode(true); void next() } }}
                    aria-pressed={ieltsMode}
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
                    <StoryTextPanel
                      value={textStory}
                      onChange={setTextStory}
                      canSubmit={computeRichness(textStory).canSubmit}
                      submitting={submitting}
                      onSubmit={submit}
                      onSwitchToVoice={() => setShowTextInput(false)}
                      minH="min-h-[244px]"
                      fadeUp
                    />
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
        {/* 全站统一容器（顶栏与内容同宽对齐，两侧留白一致） */}
        <TopNav />
        <main className={PAGE_CONTAINER}>
          {storyQuotaReached ? (
            <div className="py-20 flex justify-center">
              <QuotaReached variant="story" />
            </div>
          ) : (
            <>
              {/* ===== 模块一：Hero（导航紧跟顶部；标题打字机；右侧 Orb 放大）——整屏高、内容偏上，一屏一模块 ===== */}
              <section className="relative overflow-hidden min-h-[calc(100dvh_-_72px)] flex flex-col justify-center py-12">
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
                  {/* 左：切换器 + 文案 + 操作（整体再右移、更靠中 pl-16）。Reveal 只做整块淡入上浮，内部打字机照旧 */}
                  <Reveal className="max-w-[560px] pl-16">
                    {/* 我的故事 / 雅思题 切换器（功能保留） */}
                    <div className="flex w-[240px] rounded-[10px] p-[3px] bg-bg-muted mb-7">
                      <button
                        onClick={() => setIeltsMode(false)}
                        aria-pressed={!ieltsMode}
                        className={`flex-1 h-[34px] rounded-[8px] text-[13px] font-medium transition-colors ${!ieltsMode ? 'bg-white text-v2-text-primary font-semibold shadow-sm' : 'text-v2-text-muted'}`}
                      >
                        我的故事
                      </button>
                      <button
                        onClick={() => { if (!ieltsMode) { setIeltsMode(true); void next() } }}
                        aria-pressed={ieltsMode}
                        className={`flex-1 h-[34px] rounded-[8px] text-[13px] font-medium transition-colors ${ieltsMode ? 'bg-white text-v2-text-primary font-semibold shadow-sm' : 'text-v2-text-muted'}`}
                      >
                        雅思题
                      </button>
                    </div>

                    {!ieltsMode && (
                      <Tag variant="green" icon={<Sparkles size={15} />} label="从一个真实经历开始" className="mb-6" />
                    )}
                    {!ieltsMode ? (
                      <h1 className="text-[48px] font-bold leading-[1.14] tracking-tight text-v2-text-primary">
                        分享你的经历
                        {/* 第二行右移约一个字，错开成阶梯（个 在 享 下方）；文字逐字打字机浮现 */}
                        <span className="block text-brand-primary ml-[1em]">
                          {typed}
                          <span className="inline-block w-[3px] h-[0.82em] bg-brand-primary align-middle ml-1 animate-blink" />
                        </span>
                      </h1>
                    ) : (
                      <>
                        {/* 题目上方标注 Part（白底渐变边框） */}
                        {!loading && !error && question && (
                          <div className="mb-3"><PartTag label={`Part ${question.part}`} /></div>
                        )}
                        <h1 className="text-[34px] font-bold leading-snug tracking-tight text-v2-text-primary min-h-[40px]">
                          {loading ? '换一题中…' : error ? '没取到题，点下面换一题重试' : question ? (question.part === 2 ? (question.cue_card_title_zh ?? '') : question.question_text_zh) : ''}
                        </h1>
                      </>
                    )}
                    <p className="mt-6 text-[17px] leading-[1.7] text-v2-text-secondary max-w-[470px]">
                      {!ieltsMode ? '不用背模板。把发生过的事讲出来，我们帮你理清逻辑、补上地道表达，再匹配到合适的雅思口语题。' : '聊聊你的看法'}
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
                      <Link href={ieltsMode && question ? `/write?qid=${question.id}` : '/write'} className="inline-flex items-center gap-1.5 text-[14px] text-v2-text-muted hover:text-v2-text-secondary">
                        <Pencil size={15} />或用文字输入
                      </Link>
                    </div>
                  </Reveal>

                  {/* 右：Orb（现有组件，放大到 400；不加浮动小卡片）——比文案再上移一点 */}
                  <div className="flex justify-center items-center -mt-8">
                    <Orb size={400} pulse={false} />
                  </div>
                </div>
              </section>

              {/* ===== 模块二：我们能为你做什么（能力三卡）——整屏高、内容居中 ===== */}
              <section className="min-h-[calc(100dvh_-_72px)] flex flex-col justify-center py-16">
                <Reveal>
                  <SectionHead
                    eyebrow="从一段经历到一次自信开口"
                    title={<>我们能为你做<span className="text-brand-primary">什么</span></>}
                    sub="不是又一个题库 App，是帮你把自己的故事，练成能考场脱口而出的表达"
                  />
                </Reveal>
                <div className="grid grid-cols-3 gap-6">
                  {FEATURES.map(({ Icon, img, tint, title, lead, desc }, i) => (
                    <Reveal key={title} delay={i * 0.08}>
                    <Card className="px-6 pt-8 pb-7 text-center transition-transform duration-200 hover:-translate-y-1">
                      {img ? (
                        /* 拼图图标（已抠除白底的透明 PNG），尺寸对齐原图标 64px */
                        <Image src={img} alt="" width={128} height={128} className="mx-auto mb-5 w-16 h-16 object-contain" />
                      ) : (
                        <div className={`mx-auto mb-5 w-16 h-16 rounded-[18px] grid place-items-center ${tintClass(tint)}`}>
                          <Icon size={28} strokeWidth={2} />
                        </div>
                      )}
                      <h3 className="text-[16px] font-semibold text-v2-text-primary">{title}</h3>
                      <p className="mt-2 text-[13.5px] font-semibold text-brand-primary-dark">{lead}</p>
                      <p className="mt-1.5 text-[13px] text-v2-text-secondary leading-relaxed">{desc}</p>
                    </Card>
                    </Reveal>
                  ))}
                </div>
              </section>

              {/* ===== 模块三：语料匹配题目怎么运作（漏斗 + 四步）整屏高、内容居中 ===== */}
              <section className="min-h-[calc(100dvh_-_72px)] flex flex-col justify-center py-16">
                <Reveal>
                  <SectionHead
                    eyebrow="语料匹配题目"
                    title={<>一段语料，覆盖雅思口语<span className="text-brand-primary">三个部分</span></>}
                    sub="系统逐层匹配、动态调整，帮你覆盖 Part 1、2、3 全部题型。"
                  />
                </Reveal>
                <div className="grid grid-cols-[0.85fr_1.15fr] gap-14 items-center">
                  {/* 左：漏斗示意图（品牌配色螺旋丝带，已抠除背景的透明 PNG）；靠右上偏移贴近文案 */}
                  <Reveal className="flex flex-col">
                    <Image
                      src="/funnel-spiral.png"
                      alt="语料匹配漏斗示意"
                      width={2124}
                      height={2016}
                      className="w-full max-w-[460px] h-auto ml-auto translate-x-8 -translate-y-10"
                    />
                  </Reveal>

                  {/* 右：三步说明 + 六维度提示 */}
                  <div className="flex flex-col gap-7">
                    {MATCH_STEPS.map(({ n, dot, title, desc }, i) => (
                      <Reveal key={n} delay={i * 0.08} className="flex gap-4">
                        <div className={`w-[30px] h-[30px] rounded-full flex-shrink-0 grid place-items-center text-white text-[14px] font-bold ${dot}`}>{n}</div>
                        <div>
                          <h4 className="text-[15.5px] font-semibold text-v2-text-primary">{title}</h4>
                          <p className="mt-1.5 text-[13.5px] text-v2-text-secondary leading-relaxed">{desc}</p>
                        </div>
                      </Reveal>
                    ))}
                    <Reveal delay={MATCH_STEPS.length * 0.08} className="bg-bg-muted rounded-[12px] px-4 py-3.5 text-[12.5px] text-v2-text-secondary leading-relaxed">
                      每道候选题按与语料的贴合度排序，优先展示最顺手的表达。判断依据是
                      <b className="text-v2-text-primary font-semibold">六个维度</b>
                      ：情绪、人际、空间、精神世界、成长、价值观。
                    </Reveal>
                  </div>
                </div>
              </section>

              {/* ===== 模块四：重组语料怎么运作（Leo 对话示意 + 三点） ===== */}
              {/* TODO: 文案待确认 —— Leo 对话为占位示意；如需可复用真实 AiBubble/UserBubble 组件渲染 */}
              <section className="min-h-[calc(100dvh_-_72px)] flex flex-col justify-center py-16">
                <Reveal>
                  <SectionHead
                    eyebrow="重组语料"
                    title={<>和 Leo 一起，把故事练成<span className="text-brand-primary">脱口而出</span></>}
                    sub="根据你在题目分析里选的雅思水平，Leo 会陪你就这段经历继续聊下去"
                  />
                </Reveal>
                <div className="grid grid-cols-[0.95fr_1.05fr] gap-14 items-center">
                  {/* 左：练习对话 mockup —— 复用真实 AiBubble/UserBubble，与练习页视觉一致（不再手写、避免漂移）。
                      整卡 inert：✨ 优化反馈 / 点击说话胶囊都是示意，不该被 Tab 到或被读屏播报 */}
                  <Reveal>
                  <InertBlock>
                  <Card className="p-6">
                    {/* 题目条（练习页同款样式） */}
                    <div className="flex items-center gap-2 bg-bg-page border border-black/[0.05] rounded-[8px] px-[11px] py-[6px] mb-4">
                      <span className="text-[11px] text-v2-text-muted flex-shrink-0">Part 1</span>
                      <div className="w-px h-3 bg-black/10 flex-shrink-0" />
                      <span className="text-[12px] font-medium text-v2-text-secondary flex-1 truncate min-w-0">What do you usually do when you are resting?</span>
                    </div>

                    {/* 对话（真实气泡组件；用户气泡带 ✨ 优化反馈入口） */}
                    {LEO_DIALOGUE.map(({ from, text }, i) =>
                      from === 'leo'
                        ? <AiBubble key={i} text={text} />
                        : <UserBubble key={i} text={text} onPolish={() => {}} />
                    )}

                    {/* 输入胶囊（练习页同款：换说法 Orb + 点击说话） */}
                    <div className="mt-1 flex items-center gap-3">
                      <OrbSoft size={40} />
                      <div className="flex flex-1 items-center justify-center gap-2 rounded-full py-3" style={GRADIENT_BORDER_STYLE}>
                        <Mic2 size={16} className="text-brand-primary" />
                        <span className="text-[13px] font-medium text-v2-text-secondary">点击说话</span>
                      </div>
                    </div>
                  </Card>
                  </InertBlock>
                  </Reveal>

                  {/* 右：三点说明 */}
                  <div className="flex flex-col gap-6">
                    {RESTRUCTURE_POINTS.map(({ dot, title, desc }, i) => (
                      <Reveal key={title} delay={i * 0.08} className="flex gap-3.5">
                        {/* 与模块三步骤圆圈同款：30px 圆形实心填充 + 白色编号 */}
                        <div className={`w-[30px] h-[30px] rounded-full flex-shrink-0 grid place-items-center text-white text-[14px] font-bold ${dot}`}>
                          {i + 1}
                        </div>
                        <div>
                          <h4 className="text-[15px] font-semibold text-v2-text-primary">{title}</h4>
                          <p className="mt-1 text-[13.5px] text-v2-text-secondary leading-relaxed">{desc}</p>
                        </div>
                      </Reveal>
                    ))}
                  </div>
                </div>
              </section>

              {/* ===== 模块五：信息复用怎么用（三卡等高） ===== */}
              {/* TODO: 文案待确认 —— 三张卡的示意内容为占位；如需可复用真实 拼句/复习卡/发音 组件缩略渲染 */}
              <section className="min-h-[calc(100dvh_-_72px)] flex flex-col justify-center py-16">
                <Reveal>
                  <SectionHead
                    eyebrow="信息复用"
                    title={<>收藏的内容，去<span className="text-brand-primary">素材库</span>继续巩固</>}
                    sub="三种不同的练习，分别对应你收藏的三类东西"
                  />
                </Reveal>
                <div className="grid grid-cols-3 gap-6 items-stretch">
                  {/* 拼句练习 */}
                  <Reveal delay={0} className="h-full">
                  <Card className="p-5 h-full flex flex-col transition-transform duration-200 hover:-translate-y-1">
                    {/* 预览区为展示性假件（词块 Chip 渲染为原生 button）：整块 inert，标题/正文仍在其外可访问 */}
                    <InertBlock className="relative h-[190px] rounded-[16px] bg-brand-primary-light/40 border border-brand-primary/15 mb-5 flex flex-col items-center justify-center gap-3 px-5 overflow-hidden">
                      <div className="absolute top-3 left-3 w-7 h-7 rounded-[9px] bg-white/80 border border-brand-primary/15 grid place-items-center text-brand-primary-dark">
                        <Puzzle size={14} strokeWidth={2} />
                      </div>
                      {/* 拼装中的一行（含一个待填空槽） */}
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        <Chip variant="default" size="sm">My</Chip>
                        <Chip variant="default" size="sm">roommate</Chip>
                        <span className="h-[24px] w-[54px] rounded-full border border-dashed border-brand-primary/45 bg-white/70" />
                        <Chip variant="default" size="sm">my</Chip>
                        <Chip variant="default" size="sm">card</Chip>
                      </div>
                      {/* 待选词块：高亮的是下一个要拖入的 */}
                      <div className="flex items-center gap-1.5">
                        <Chip variant="gradient" size="sm">stole</Chip>
                        <Chip variant="default" size="sm">actually</Chip>
                      </div>
                    </InertBlock>
                    <h3 className="text-[15.5px] font-semibold text-v2-text-primary">拼句练习</h3>
                    <p className="mt-1.5 text-[13px] text-v2-text-secondary leading-relaxed">收藏的句子会被拆成词块，打乱后让你按顺序拼回去，练的是语序和用词的肌肉记忆。</p>
                  </Card>
                  </Reveal>

                  {/* Anki 复习 */}
                  <Reveal delay={0.08} className="h-full">
                  <Card className="p-5 h-full flex flex-col transition-transform duration-200 hover:-translate-y-1">
                    <InertBlock className="relative h-[190px] rounded-[16px] bg-brand-accent-light/40 border border-brand-accent/20 mb-5 flex items-center justify-center gap-3 px-4 overflow-hidden">
                      <div className="absolute top-3 left-3 w-7 h-7 rounded-[9px] bg-white/80 border border-brand-accent/25 grid place-items-center text-brand-accent">
                        <Layers size={14} strokeWidth={2} />
                      </div>
                      {/* 正面 */}
                      <div className="w-[96px] h-[116px] bg-white rounded-[12px] border border-black/[0.04] shadow-[0_2px_10px_rgba(0,0,0,0.05)] flex flex-col items-center justify-center gap-2 px-2 text-center">
                        <Tag variant="green" label="感受" className="text-[9px] px-[6px] py-[2px]" />
                        <div className="text-[13px] font-bold text-v2-text-primary leading-tight">有点纠结</div>
                      </div>
                      <RotateCw size={15} strokeWidth={2.2} className="text-brand-primary flex-shrink-0" />
                      {/* 背面 */}
                      <div className="w-[96px] h-[116px] bg-white rounded-[12px] border border-brand-accent/25 shadow-[0_2px_10px_rgba(0,0,0,0.05)] flex flex-col items-center justify-center gap-1 px-2 text-center">
                        <div className="text-[13px] font-bold text-brand-accent leading-tight">kind of torn</div>
                        <div className="text-[10px] text-v2-text-muted">有点纠结</div>
                      </div>
                    </InertBlock>
                    <h3 className="text-[15.5px] font-semibold text-v2-text-primary">Anki 复习</h3>
                    <p className="mt-1.5 text-[13px] text-v2-text-secondary leading-relaxed">收藏的词组按间隔重复的节奏安排复习提醒，帮你把一时记住的生词变成长期记忆。</p>
                  </Card>
                  </Reveal>

                  {/* 发音教学 */}
                  <Reveal delay={0.16} className="h-full">
                  <Card className="p-5 h-full flex flex-col transition-transform duration-200 hover:-translate-y-1">
                    <InertBlock className="relative h-[190px] rounded-[16px] bg-brand-primary-light/40 border border-brand-primary/15 mb-5 flex items-center justify-center px-5 overflow-hidden">
                      <div className="absolute top-3 left-3 w-7 h-7 rounded-[9px] bg-white/80 border border-brand-primary/15 grid place-items-center text-brand-primary-dark">
                        <Volume2 size={14} strokeWidth={2} />
                      </div>
                      <div className="w-full bg-white rounded-[12px] border border-black/[0.04] shadow-[0_2px_10px_rgba(0,0,0,0.05)] p-4">
                        <div className="flex items-center justify-between mb-2.5">
                          <span className="text-[11px] text-v2-text-muted">想说的词</span>
                          <span className="text-[13px] font-bold text-brand-accent">Gym <span className="font-normal text-v2-text-muted">/dʒɪm/</span></span>
                        </div>
                        <div className="h-px bg-black/[0.05] mb-2.5" />
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-v2-text-muted">被听成</span>
                          <span className="text-[13px] font-bold text-error">drink <span className="font-normal text-v2-text-muted">/drɪŋk/</span></span>
                        </div>
                      </div>
                    </InertBlock>
                    <h3 className="text-[15.5px] font-semibold text-v2-text-primary">发音教学</h3>
                    <p className="mt-1.5 text-[13px] text-v2-text-secondary leading-relaxed">告诉你被系统听成了什么、和正确发音的区别在哪，针对性练到能被准确识别为止。</p>
                  </Card>
                  </Reveal>
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      {/* 共享：提示 / 首次同意 / 麦克风权限弹层 */}
      <Toast message={toastMsg} onDismiss={dismissToast} />
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
