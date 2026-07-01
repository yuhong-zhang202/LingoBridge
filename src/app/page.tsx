/**
 * @module   HomePage
 * @desc     首页 —— 移动端保持原竖排（顶栏 + 分段 + Orb + CTA + 文字面板 + 底部 TabBar）；
 *           桌面端为重设计：顶部横向导航 + 开放式 Hero + 三步 + 挑个话题（对齐 lingobridge-home-redesign.html）。
 *           两端共用同一套 state/handler，功能完全一致。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useCallback, useEffect, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { Mic2, RotateCw, ChevronLeft, ArrowRight, Loader2, Pencil, Sparkles, Target, MessageCircle, AudioLines } from 'lucide-react'
import Orb from '@/components/Orb'
import TopNav from '@/components/TopNav'
import TabBar from '@/components/TabBar'
import Tag from '@/components/Tag'
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

// 三步流程（横向时间轴）：accent=true 用青色描边，其余用主橙色描边
const STEPS = [
  { Icon: MessageCircle, accent: false, title: '分享真实经历', desc: '用中文或英文讲讲发生过什么，卡壳也没关系' },
  { Icon: Target,        accent: true,  title: '匹配雅思题',   desc: 'AI 拆解故事角度，找到最贴合的当季真题' },
  { Icon: AudioLines,    accent: false, title: '实时练习对话', desc: '和 AI 即兴对话，把素材讲成脱口而出的回答' },
] as const

// 六个维度（认知展示，无点击）
const DIMENSIONS = [
  { name: '情绪内核', desc: '如何与自己相处' },
  { name: '人际羁绊', desc: '与他人如何联结' },
  { name: '空间感知', desc: '居所、城市与远行' },
  { name: '精神栖所', desc: '书影音与珍视的物件' },
  { name: '成长演进', desc: '技能、蜕变与重要决定' },
  { name: '价值底色', desc: '相信什么，看重什么' },
] as const

// 静态六维雷达几何 —— 坐标算法与题库页 RadarChart 同款（CX/CY/R/LABEL_R、起于顶点 i*60°-90°）
const RADAR = (() => {
  const CX = 100, CY = 100, R = 65, LABEL_R = 83, N = 6
  const ang = (i: number): number => i * (2 * Math.PI / N) - Math.PI / 2
  const pt = (i: number, r: number): [number, number] => [CX + r * Math.cos(ang(i)), CY + r * Math.sin(ang(i))]
  const path = (pts: [number, number][]): string =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('') + 'Z'
  // 装饰用不规则半径比例（情绪/人际/空间/精神/成长/价值）——高低起伏，看起来像真实数据而非满值正六边形
  const RATIOS = [0.90, 0.65, 0.80, 0.58, 0.95, 0.72]
  const dataVerts = RATIOS.map((f, i) => pt(i, R * f))
  return {
    cx: CX, cy: CY,
    grid: [0.33, 0.66, 1].map(l => path(Array.from({ length: N }, (_, i) => pt(i, R * l)))),
    axisEnds: Array.from({ length: N }, (_, i) => pt(i, R)),   // 坐标轴仍到满半径，样式不变
    data: path(dataVerts),                                     // 不规则数据多边形
    verts: dataVerts,                                          // 顶点圆落在各自数据半径上
    labels: Array.from({ length: N }, (_, i) => pt(i, LABEL_R)),
  }
})()

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
        <main className={`${PAGE_CONTAINER} pb-20`}>
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
                    {/* 我的故事 / 雅思题 切换器：App 标准分段控件（与题库页一致），单独占一行 */}
                    <div className="flex w-[240px] rounded-[10px] p-[3px] bg-bg-inner mb-7">
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

                  {/* 右：Orb（继续用项目 Orb 组件，静态展示）—— 略缩小并从右边缘内收，垂直对齐文字块 */}
                  <div className="flex-shrink-0 self-center flex justify-end w-[380px] pr-[28px]">
                    <Orb size={340} pulse={false} />
                  </div>
                </div>
              </section>

              {/* 三步 · 横向时间轴（去卡片化：圆形描边图标 + 渐变连接线 + 文字） */}
              <section className="mt-32">
                <div className="mb-9">
                  <h2 className="text-[28px] font-bold tracking-tight text-v2-text-primary">三步，将真实经历转化为雅思语料</h2>
                  <p className="mt-2 text-[14px] text-v2-text-muted">这正是 LingoBridge 和背题库不一样的地方</p>
                </div>
                {/* 容器被压窄时纵向堆叠(flex-col)，lg 及以上横向时间轴 */}
                <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-start lg:gap-0">
                  {STEPS.map(({ Icon, accent, title, desc }, i) => (
                    <Fragment key={title}>
                      <div className="flex flex-col items-center text-center lg:w-[190px] lg:flex-shrink-0">
                        <div className={`w-9 h-9 rounded-full bg-white border-[1.5px] grid place-items-center ${accent ? 'border-brand-accent' : 'border-brand-primary'}`}>
                          <Icon size={18} strokeWidth={2} className={accent ? 'text-brand-accent' : 'text-brand-primary'} />
                        </div>
                        <h3 className="mt-3 text-[13.5px] font-semibold text-v2-text-primary">{title}</h3>
                        <p className="mt-1.5 text-[11.5px] text-v2-text-secondary leading-relaxed max-w-[180px]">{desc}</p>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className="hidden lg:block flex-1 h-[1.5px] mt-[17px] mx-2 rounded-full" style={{ background: BRAND_GRADIENT }} />
                      )}
                    </Fragment>
                  ))}
                </div>
              </section>

              {/* 六个维度 · 静态雷达 + 极简文字列表（去卡片化，纯认知展示） */}
              <section className="mt-36">
                <div className="mb-9">
                  <h2 className="text-[28px] font-bold tracking-tight text-v2-text-primary">六个维度，连接不同类型的语料和题目</h2>
                  <p className="mt-2 text-[14px] text-v2-text-muted">每讲一个故事，就点亮一个面——反向匹配雅思真题</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
                  {/* 左：静态雷达图（装饰性示意，不绑定真实数据） */}
                  <div className="flex justify-center">
                    <svg viewBox="0 0 200 200" className="w-full max-w-[300px] h-auto" role="img" aria-label="六维故事版图示意">
                      {RADAR.grid.map((d, i) => (
                        <path key={i} d={d} fill="none" className="stroke-bg-muted" strokeWidth="0.5" />
                      ))}
                      {RADAR.axisEnds.map(([x, y], i) => (
                        <line key={i} x1={RADAR.cx} y1={RADAR.cy} x2={x.toFixed(1)} y2={y.toFixed(1)} className="stroke-bg-muted" strokeWidth="0.5" />
                      ))}
                      <path d={RADAR.data} className="fill-brand-primary-light stroke-brand-primary" fillOpacity={0.3} strokeWidth="1.2" />
                      {RADAR.verts.map(([x, y], i) => (
                        <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3" className="fill-brand-primary" />
                      ))}
                      {RADAR.labels.map(([x, y], i) => (
                        <text key={i} x={x.toFixed(1)} y={y.toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize="9" className="fill-v2-text-primary" fontFamily="'PingFang SC',sans-serif">
                          {DIMENSIONS[i].name}
                        </text>
                      ))}
                    </svg>
                  </div>
                  {/* 右：极简维度列表（无卡片、无图标底色块） */}
                  <div>
                    {DIMENSIONS.map(({ name, desc }, i) => (
                      <div key={name} className={`flex items-baseline justify-between py-3.5 ${i < DIMENSIONS.length - 1 ? 'border-b border-black/[0.06]' : ''}`}>
                        <span className="text-[15px] font-semibold text-v2-text-primary">{name}</span>
                        <span className="text-[13px] text-v2-text-muted">{desc}</span>
                      </div>
                    ))}
                  </div>
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
