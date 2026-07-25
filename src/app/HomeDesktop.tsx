/**
 * @module   HomeDesktop
 * @desc     首页桌面端营销落地页视图 —— 现有版式原样搬入、改接 props 的纯展示组件（视觉/文案一字不改）：
 *           Hero（打字机标题 + Orb）+ 能力三卡 + 匹配漏斗四步 + Leo 对话示意 + 信息复用 Tab 舞台。
 *           桌面专用的静态常量（FEATURES / MATCH_STEPS / LEO_DIALOGUE / RESTRUCTURE_POINTS / REUSE）
 *           与展示性子组件（SectionHead / InertBlock / PreviewSentence·Anki·Pron / tintClass）随视图内聚于此。
 *           数据与副作用由 page.tsx 外壳经 props 下发；桌面文案含占位，见各处 TODO。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { type JSX, useEffect, useRef, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Mic2, RotateCw, Pencil, Sparkles, Target, MessageCircle, Layers, Volume2, type LucideIcon } from 'lucide-react'
import Orb from '@/components/Orb'
import TopNav from '@/components/TopNav'
import Card from '@/components/Card'
import Tag from '@/components/Tag'
import Chip from '@/components/Chip'
import GradientButton from '@/components/GradientButton'
import PartTag from '@/components/PartTag'
import Reveal from '@/components/Reveal'
import AiBubble from '@/app/practice/_components/AiBubble'
import UserBubble from '@/app/practice/_components/UserBubble'
import OrbSoft from '@/app/practice/_components/OrbSoft'
import { GRADIENT_BORDER_STYLE, GRADIENT_BORDER_STYLE_FULL_OPAQUE, BRAND_GRADIENT_VERTICAL, PAGE_CONTAINER } from '@/lib/constants'
import type { HomeViewProps } from './types'

// TODO: 文案待确认 —— 以下桌面营销模块文案取自参考稿占位，非最终产品文案
// 模块二：能力三卡
const FEATURES: { Icon: LucideIcon; img?: string; tint: 'primary' | 'accent'; title: string; lead: string; desc: string }[] = [
  { Icon: Target,        img: '/icon-corpus-match.png', tint: 'primary', title: '语料匹配题目', lead: '你的故事，就是你的素材库', desc: '讲一段真实经历，我们帮你反向匹配到最贴合的当季雅思真题，不用再去题海里瞎撞。' },
  { Icon: MessageCircle, img: '/icon-restructure.png',  tint: 'accent',  title: '重组语料',     lead: '陪你把故事说顺、说地道',   desc: '和对话伙伴 Leo 一起聊这段经历，说得不够好就当场优化、再说一遍——练的是真正开口的能力，不是背答案。' },
  { Icon: Layers,        img: '/icon-reuse.png',        tint: 'primary', title: '信息复用',     lead: '练过的东西，不会白练',     desc: '对话里优化过的好句子、分析出的相关词组、读错的发音，都能存进素材库，用几分钟小练习反复巩固。' },
]

// 步骤号圆圈：白底 + 深灰编号(v2-text-secondary，与「点击说话」等渐变描边元素同色)，外环官方品牌渐变描边（橙→绿，DESIGN.md §渐变规范），
// 全站统一 GRADIENT_BORDER_STYLE 常量（background-clip 技巧、单层即可），禁止自编渐变色值。
const MATCH_STEPS = [
  { n: 1, title: '语料输入',             desc: '录音或文字均可。可选择"分享故事"或"讨论雅思题目"两种模式。想不到经历时，直接选题讨论，用中文口述思路即可。' },
  { n: 2, title: '匹配 Part 1 / Part 2', desc: '基于核心内容，优先匹配可直接作答的 Part 1、2 真题，命中即推荐。' },
  { n: 3, title: '切换语料侧重点',        desc: '核心角度没有对应题目时，调整表达侧重，尝试匹配其他 Part 1、2 真题，扩大覆盖范围。' },
  { n: 4, title: '对话延伸 Part 3',       desc: '与 Leo 练习对话时，话题自然延伸至 Part 3，完成三部分全覆盖。' },
] as const

// 模块四：Leo 对话示意（占位对话）+ 右侧三点说明
const LEO_DIALOGUE = [
  { from: 'leo',  text: 'Oh nice, coffee sounds perfect. Do you sit down right away?' },
  { from: 'user', text: 'I usually just unwind for a moment, and then I make myself a cup of coffee.' },
  { from: 'leo',  text: 'Got it — what does that "unwinding" feel like in your body?' },
] as const

// 与模块三步骤圆圈同款：白底 + 深灰编号 1/2/3 + 官方 GRADIENT_BORDER_STYLE 渐变描边（橙→绿）
const RESTRUCTURE_POINTS = [
  { title: '句子不满意？点「优化反馈」',   desc: '看看更地道的说法，简单记忆之后自己再重新表达一遍，形成「输入-输出」的循环，而不是照读答案。' },
  { title: '读错的单词，点一下就能收藏',   desc: '发音被听错的词会被记下来，练习结束后能在素材库里做针对性的发音纠错练习。' },
  { title: '练完会有一叠反馈卡片',         desc: '都是这次对话里被优化过的好句子——眼熟的左滑跳过，想留下的右滑收藏进语料。' },
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
function SectionHead({ eyebrow, title, sub }: { eyebrow?: string; title: ReactNode; sub: string }) {
  return (
    <div className="text-center max-w-[560px] mx-auto mb-14">
      {eyebrow && <p className="text-[12.5px] font-semibold text-brand-accent tracking-wide mb-2.5">{eyebrow}</p>}
      <h2 className="text-[30px] font-bold tracking-tight text-v2-text-primary leading-snug mb-4">{title}</h2>
      <p className="text-[15px] text-v2-text-secondary leading-relaxed">{sub}</p>
    </div>
  )
}

/** 模块五 Tab 舞台内的三张真实 UI 缩略卡（拼句 SentenceOrderGame / Anki FlashCard / 发音 PronunciationCard 同款样式） */
function PreviewSentence() {
  return (
    <div className="relative w-[300px] -rotate-1 bg-white rounded-[16px] border border-black/[0.05] shadow-[0_16px_36px_-14px_rgba(180,120,70,0.26)] px-4 py-4">
      <p className="text-[10.5px] text-v2-text-muted text-center">拼出更地道的说法</p>
      <div className="mt-3 pb-2 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2 border-b-2 border-dashed border-brand-primary-light">
        <Chip variant="default" size="sm" className="border-success text-success bg-success/10">We</Chip>
        <Chip variant="default" size="sm" className="border-success text-success bg-success/10">ended</Chip>
        <Chip variant="default" size="sm">up</Chip>
        <Chip variant="default" size="sm">talking</Chip>
      </div>
      <p className="text-[10px] text-v2-text-muted text-center mt-3 mb-1.5">词库</p>
      <div className="flex justify-center gap-1.5">
        <Chip variant="default" size="sm">for</Chip>
        <Chip variant="default" size="sm">hours</Chip>
      </div>
    </div>
  )
}

function PreviewAnki() {
  return (
    <div className="relative w-[160px] h-[204px]">
      <div className="absolute inset-0 rotate-[6deg] translate-x-2.5 bg-white rounded-[18px] border border-black/[0.04] shadow-[0_6px_18px_-6px_rgba(0,0,0,0.10)]" />
      <div className="absolute inset-0 -rotate-2 bg-white rounded-[18px] shadow-[0_14px_32px_-12px_rgba(180,120,70,0.26)] overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ background: BRAND_GRADIENT_VERTICAL }} />
        <div className="h-full pl-4 pr-3 pt-3 pb-3.5 flex flex-col">
          <Tag variant="green" label="感受" className="self-start text-[9px] px-[6px] py-[2px]" />
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <p className="text-[18px] font-bold text-v2-text-primary leading-tight">有点纠结</p>
            <p className="text-[11px] text-brand-accent mt-2">想想英文怎么说?</p>
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <span className="text-[9px] text-v2-text-muted">记忆进度</span>
            <span className="flex gap-[3px]">
              {[1, 2, 3, 4, 5].map(i => (
                <span key={i} className={`w-[5px] h-[5px] rounded-full ${i <= 2 ? 'bg-brand-primary' : 'bg-warm-line'}`} />
              ))}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function PreviewPron() {
  return (
    <div style={GRADIENT_BORDER_STYLE_FULL_OPAQUE} className="relative w-[290px] -rotate-1 rounded-[16px] px-4 py-3.5 shadow-[0_16px_36px_-14px_rgba(180,120,70,0.26)]">
      <p className="text-[10px] text-v2-text-muted mb-[5px]">想说的词</p>
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-[14px] text-v2-text-primary"><span className="font-medium">Gym</span><span className="ml-2 text-[11px] text-v2-text-secondary">/dʒɪm/</span></span>
        <Volume2 size={13} className="text-v2-text-muted" />
      </div>
      <p className="text-[10px] text-v2-text-muted mb-[5px]">被听成</p>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-[14px] text-v2-text-primary"><span className="font-medium">drink</span><span className="ml-2 text-[11px] text-v2-text-secondary">/drɪŋk/</span></span>
        <Volume2 size={13} className="text-v2-text-muted" />
      </div>
      <div className="rounded-[10px] bg-bg-page px-3 py-2.5">
        <p className="text-[10px] text-v2-text-muted mb-0.5">怎么念</p>
        <p className="text-[11px] text-v2-text-primary leading-[1.55]">起音是浊辅音 /dʒ/，别读成 /dr/；先咬住上齿龈再送气。</p>
      </div>
    </div>
  )
}

/** 三种复用练习：Tab 舞台数据（对应收藏类型 + 真实 UI 预览 + 光晕色） */
const REUSE: { tab: string; collected: string; title: string; desc: string; glow: string; Preview: () => JSX.Element }[] = [
  { tab: '拼句练习', collected: '收藏的句子', title: '拼句练习', desc: '收藏的句子会被拆成词块，打乱后让你按顺序拼回去，练的是语序和用词的肌肉记忆。', glow: 'rgba(240,188,160,0.40)', Preview: PreviewSentence },
  { tab: '词组闪卡', collected: '收藏的词组', title: '词组闪卡', desc: '收藏的词组按间隔重复的节奏安排复习提醒，帮你把一时记住的生词变成长期记忆。（与「题库速览」的整题题卡是两回事——这里练的是词组）', glow: 'rgba(168,210,196,0.42)', Preview: PreviewAnki },
  { tab: '发音教学', collected: '读错的发音', title: '发音教学', desc: '告诉你被系统听成了什么、和正确发音的区别在哪，针对性练到能被准确识别为止。', glow: 'rgba(240,188,160,0.40)', Preview: PreviewPron },
]

export default function HomeDesktop({
  ieltsMode,
  question,
  loading,
  error,
  exhausted,
  startingRec,
  typed,
  reuseTab,
  writeHref,
  onSelectMyStory,
  onSelectIelts,
  onNext,
  onStartRecording,
  onOpenWrite,
  onSelectReuseTab,
}: HomeViewProps) {
  const ActivePreview = REUSE[reuseTab].Preview

  return (
    <div className="min-h-screen bg-bg-page">
      {/* 全站统一容器（顶栏与内容同宽对齐，两侧留白一致） */}
      <TopNav />
      {/* 首页永远正常渲染；月额度用完的提示由外壳在点击故事入口时以覆盖层弹出 */}
      <main className={PAGE_CONTAINER}>
            {/* ===== 模块一：Hero（导航紧跟顶部；标题打字机；右侧 Orb 放大）——整屏高、内容偏上，一屏一模块 ===== */}
            <section className="relative overflow-hidden min-h-[calc(100dvh_-_72px)] flex flex-col justify-center py-12">
              {/* 极淡氛围光（装饰，置于 Orb 背后）。收敛透明落点，使柔光在 section 右侧
                  overflow-hidden 裁切线之前已自然羽化到全透明，避免右缘出现硬竖线。 */}
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  top: '-120px', right: '-20px', width: '640px', height: '640px',
                  background: 'radial-gradient(circle, rgba(240,188,160,0.18) 0%, rgba(168,210,196,0.12) 24%, rgba(188,210,168,0.07) 35%, transparent 46%)',
                  filter: 'blur(60px)', zIndex: 0,
                }}
              />
              <div className="relative z-[1] grid grid-cols-2 gap-10 items-center pl-12">
                {/* 左：切换器 + 文案 + 操作（整体再右移、更靠中 pl-16）。Reveal 只做整块淡入上浮，内部打字机照旧 */}
                <Reveal className="max-w-[560px] pl-16">
                  {/* 我的故事 / 雅思题 切换器（功能保留） */}
                  <div className="flex w-[240px] rounded-[10px] p-[3px] bg-bg-muted mb-7">
                    <button
                      onClick={onSelectMyStory}
                      aria-pressed={!ieltsMode}
                      className={`flex-1 h-[34px] rounded-[8px] text-[13px] font-medium transition-colors ${!ieltsMode ? 'bg-white text-v2-text-primary font-semibold shadow-sm' : 'text-v2-text-muted'}`}
                    >
                      我的故事
                    </button>
                    <button
                      onClick={onSelectIelts}
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
                        {loading ? '换一题中…' : error ? '没取到题，点下面换一题重试' : exhausted ? '本季真题你都练过啦，换季会上新题' : question ? (question.part === 2 ? (question.cue_card_title_zh ?? '') : question.question_text_zh) : ''}
                      </h1>
                    </>
                  )}
                  <p className="mt-6 text-[17px] leading-[1.7] text-v2-text-secondary max-w-[470px]">
                    {!ieltsMode ? '不用背模板。把发生过的事讲出来，我们帮你理清逻辑、补上地道表达，再匹配到合适的雅思口语题。' : '聊聊你的看法'}
                  </p>
                  {ieltsMode && !exhausted && (
                    <button onClick={onNext} className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-v2-text-muted hover:opacity-70">
                      <RotateCw size={13} />换一题
                    </button>
                  )}
                  <div className="mt-9 flex items-center gap-5 flex-wrap">
                    <GradientButton onClick={onStartRecording} loading={startingRec} className="inline-flex items-center gap-2.5 px-7 py-[15px] rounded-full text-[15px] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
                      <Mic2 size={18} />开始录音
                    </GradientButton>
                    {/* 保留 <Link>（而非改 button）：右键「在新标签打开」/ 中键 / ctrl+click / 悬停预览 /
                        屏幕阅读器的链接语义都得以保留。普通左键改走 onOpenWrite —— 先核建新故事额度，
                        超额直接弹覆盖层、不跳转，避免用户进 /write 写完才被拦（白写一场）。
                        带修饰键的点击一律放行原生行为：那条路仍有 /write 自身的守卫 + 服务端 402 兜底。 */}
                    <Link
                      href={writeHref}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                        e.preventDefault()
                        onOpenWrite()
                      }}
                      className="inline-flex items-center gap-1.5 text-[14px] text-v2-text-muted hover:text-v2-text-secondary"
                    >
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
                  title={<>我们能为你做<span className="text-brand-primary">什么</span></>}
                  sub="不是又一个题库 App，是帮你把自己的故事，练成能考场脱口而出的表达"
                />
              </Reveal>
              {/* items-stretch 虽是 grid 默认值，但下方 Reveal/Card 的 h-full 等高依赖它，显式写出以免后续改对齐时静默失效 */}
              <div className="grid grid-cols-3 gap-6 items-stretch">
                {FEATURES.map(({ Icon, img, tint, title, lead, desc }, i) => (
                  /* h-full 逐层下传：Reveal 撑满 grid row（由最高卡定高）、Card 再撑满 Reveal，
                     使三卡等高且与文案长度解耦（文案仍为 TODO 占位，故不用 min-h 锁死行数） */
                  <Reveal key={title} delay={i * 0.08} className="h-full">
                  {/* 整卡不可点、无链接，故不做 hover 上浮（上浮是"可点击"的交互暗示）；无其他 hover 态，transition 一并移除 */}
                  <Card className="px-6 pt-8 pb-7 text-center h-full">
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
                  {MATCH_STEPS.map(({ n, title, desc }, i) => (
                    <Reveal key={n} delay={i * 0.08} className="flex gap-4">
                      <div className="w-[30px] h-[30px] rounded-full flex-shrink-0 grid place-items-center text-[14px] font-bold text-v2-text-secondary" style={GRADIENT_BORDER_STYLE}>{n}</div>
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
                  {RESTRUCTURE_POINTS.map(({ title, desc }, i) => (
                    <Reveal key={title} delay={i * 0.08} className="flex gap-3.5">
                      {/* 与模块三步骤圆圈同款：30px 白底 + 深灰编号 + 官方 GRADIENT_BORDER_STYLE 渐变描边 */}
                      <div className="w-[30px] h-[30px] rounded-full flex-shrink-0 grid place-items-center text-[14px] font-bold text-v2-text-secondary" style={GRADIENT_BORDER_STYLE}>
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

            {/* ===== 模块五：信息复用（错落式展示——三种练习对应三类收藏，各占一行、左右交错，预览为带景深的微缩场景） ===== */}
            {/* TODO: 文案待确认 —— 预览为展示性假件（真实拼句/闪卡/发音示意），整块 inert */}
            <section className="min-h-[calc(100dvh_-_72px)] flex flex-col justify-center py-16">
              <Reveal>
                <SectionHead
                  title={<>收藏的内容，去<span className="text-brand-primary">素材库</span>继续巩固</>}
                  sub="三种不同的练习，分别对应你收藏的三类东西"
                />
              </Reveal>

              {/* 分段切换（同首页「我的故事/雅思题」切换器样式） */}
              <Reveal className="flex justify-center -mt-7 mb-8">
                <div className="inline-flex bg-bg-muted rounded-[12px] p-[3px]">
                  {REUSE.map((r, i) => (
                    <button
                      key={r.tab}
                      onClick={() => onSelectReuseTab(i)}
                      aria-pressed={reuseTab === i}
                      className={`px-5 h-[38px] rounded-[9px] text-[14px] whitespace-nowrap transition-colors ${reuseTab === i ? 'bg-white text-v2-text-primary font-semibold shadow-sm' : 'text-v2-text-muted font-medium'}`}
                    >
                      {r.tab}
                    </button>
                  ))}
                </div>
              </Reveal>

              {/* 舞台：当前功能的真实 UI 预览（左）+ 说明（右），切换淡入。预览整块 inert */}
              <Reveal>
                <div key={reuseTab} className="animate-fade-up grid lg:grid-cols-2 gap-10 lg:gap-16 items-center rounded-[28px] bg-bg-surface border border-black/[0.05] shadow-[0_22px_54px_-22px_rgba(180,120,70,0.22)] px-8 py-10 lg:px-12">
                  <InertBlock className="relative h-[300px] rounded-[24px] overflow-hidden bg-bg-muted/40 border border-black/[0.04] flex items-center justify-center px-6">
                    <div aria-hidden className="pointer-events-none absolute -top-16 -left-10 w-72 h-72 rounded-full" style={{ background: `radial-gradient(circle, ${REUSE[reuseTab].glow}, transparent 70%)`, filter: 'blur(30px)' }} />
                    <ActivePreview />
                  </InertBlock>
                  <div>
                    <p className="text-[12.5px] font-semibold text-brand-accent tracking-wide mb-2.5">对应 · {REUSE[reuseTab].collected}</p>
                    <h3 className="text-[26px] font-bold text-v2-text-primary tracking-tight">{REUSE[reuseTab].title}</h3>
                    <p className="mt-3.5 text-[15px] text-v2-text-secondary leading-[1.8] max-w-[400px]">{REUSE[reuseTab].desc}</p>
                  </div>
                </div>
              </Reveal>

            </section>
      </main>
    </div>
  )
}
