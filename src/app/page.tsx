/**
 * @module   HomePage
 * @desc     首页外壳 —— 集中持有全部 state / hook / handler（雅思切换题 useSwitchQuestion、文字提交
 *           useStorySubmit、登录用户当月额度核对、Hero 打字机、麦克风权限探测等），组装成一份 HomeViewProps
 *           后按 lg 断点分发两套纯展示视图：<1024 渲染 HomeMobile；≥1024 渲染 HomeDesktop。两端共用同一套
 *           state/handler，功能完全一致。共享弹层（Toast / 首次同意 / 麦克风权限 / 试用额度 / 月额度）留在外壳。
 *           月额度：挂载只预取不渲染，首页始终正常显示；仅在点「开始录音」/「文本输入」时才弹覆盖层。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Toast from '@/components/Toast'
import FirstUseConsent from '@/components/FirstUseConsent'
import MicPermissionSheet from '@/components/MicPermissionSheet'
import QuotaReached from '@/components/QuotaReached'
import { useSwitchQuestion } from '@/hooks/useSwitchQuestion'
import { useStorySubmit } from '@/hooks/useStorySubmit'
import { computeRichness } from '@/lib/story-richness'
import { getAccount } from '@/lib/auth'
import { countCorpusThisMonth, STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import HomeMobile from './HomeMobile'
import HomeDesktop from './HomeDesktop'
import type { HomeViewProps } from './types'

// Hero 标题第二行（故事模式下打字机逐字浮现）
const HERO_LINE2 = '个性化雅思语料'

export default function HomePage() {
  const router = useRouter()
  const [showTextInput, setShowTextInput] = useState(false)
  const [textStory, setTextStory] = useState('')
  const [ieltsMode, setIeltsMode] = useState(false)
  // 额度预取结果：null = 尚未取到 / 非登录用户（点击时再现取）；true/false = 本月故事额度是否已用完。
  // 只预取、不渲染 —— 额度提示绝不在加载完成时自动盖住首页，仅在用户真正点故事入口时才弹。
  const [storyQuotaOver, setStoryQuotaOver] = useState<boolean | null>(null)
  const [showStoryQuota, setShowStoryQuota] = useState(false)
  const [micSheet, setMicSheet] = useState<null | 'denied' | 'unavailable'>(null)
  const [typed, setTyped] = useState('')
  const [reuseTab, setReuseTab] = useState(0)   // 模块五：信息复用 Tab 舞台当前功能
  const { question, loading, error, next } = useSwitchQuestion()
  // 文字提交复用共享 hook；qid 取首页语义（雅思模式带当前题 id，否则 null）
  const { submitting, toastMsg, quotaReached, submit, dismissToast, dismissQuota } = useStorySubmit({ text: textStory, qid: ieltsMode && question ? question.id : null })

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

  /**
   * 故事入口守卫：本月故事额度已用完时弹覆盖层并返回 true（调用方须中止后续动作）。
   * 优先用挂载时的预取结果（点击零延迟）；预取未就绪/未取到才现场核一次。
   * 匿名与未登录用户不受月额度约束（各自走试用额度闸），一律放行。
   */
  async function blockedByStoryQuota(): Promise<boolean> {
    let over = storyQuotaOver
    if (over === null) {
      try {
        const acct = await getAccount()
        if (!acct || acct.isAnonymous || !acct.email) return false
        over = (await countCorpusThisMonth()) >= STORY_MONTHLY_LIMIT
        setStoryQuotaOver(over)
      } catch { return false }   // 静默：核不准额度不挡用户，服务端 402 仍是硬防线
    }
    if (over) { setShowStoryQuota(true); return true }
    return false
  }

  // 点「开始录音」先核额度、再探测麦克风：有权限照常进录音页，没权限弹 sheet（避免录音页静默卡死）
  async function handleStartRecording() {
    if (await blockedByStoryQuota()) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())   // 拿到权限即释放，录音页会重新获取
      router.push(ieltsMode && question ? `/recording?qid=${question.id}` : '/recording')
    } catch (err) {
      const name = (err as DOMException)?.name
      setMicSheet(name === 'NotAllowedError' ? 'denied' : 'unavailable')
    }
  }

  // 登录用户：挂载时预取当月语料数缓存到 storyQuotaOver，供点击故事入口时零延迟判断。
  // 仅预取，不改变首页渲染 —— 首页永远正常显示，额度提示只在点击时弹（见 blockedByStoryQuota）。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const acct = await getAccount()
        const loggedIn = !!acct && !acct.isAnonymous && !!acct.email
        if (!loggedIn) return
        const n = await countCorpusThisMonth()
        if (!cancelled) setStoryQuotaOver(n >= STORY_MONTHLY_LIMIT)
      } catch { /* 静默：不挡正常流程 */ }
    })()
    return () => { cancelled = true }
  }, [])

  /** 「文本输入」入口：打开面板前同样核额度；关闭面板不核（无消耗动作） */
  async function handleSetShowTextInput(v: boolean): Promise<void> {
    if (v && await blockedByStoryQuota()) return
    setShowTextInput(v)
  }

  const viewProps: HomeViewProps = {
    ieltsMode,
    showTextInput,
    question,
    loading,
    error,
    textStory,
    submitting,
    canSubmit: computeRichness(textStory).canSubmit,
    typed,
    reuseTab,
    onSetShowTextInput: (v) => void handleSetShowTextInput(v),
    onSelectMyStory: () => setIeltsMode(false),
    onSelectIelts: () => { if (!ieltsMode) { setIeltsMode(true); void next() } },
    onNext: () => void next(),
    onStartRecording: () => void handleStartRecording(),
    onChangeTextStory: setTextStory,
    onSubmitStory: submit,
    onSelectReuseTab: setReuseTab,
  }

  return (
    <>
      {/* ============ 移动端：原竖排布局 ============ */}
      <div className="lg:hidden"><HomeMobile {...viewProps} /></div>

      {/* ============ 桌面端：营销落地页 ============ */}
      <div className="hidden lg:block"><HomeDesktop {...viewProps} /></div>

      {/* 共享：提示 / 首次同意 / 麦克风权限弹层 */}
      <Toast message={toastMsg} onDismiss={dismissToast} />
      <FirstUseConsent />
      <MicPermissionSheet
        open={micSheet !== null}
        reason={micSheet ?? 'denied'}
        onUseText={() => { setMicSheet(null); setShowTextInput(true) }}
        onDismiss={() => setMicSheet(null)}
      />
      {/* 提交时匿名整理额度用尽：弹试用结束提示（trial 变体），关闭留在本页 */}
      {quotaReached && <QuotaReached variant="trial" asOverlay onClose={dismissQuota} />}
      {/* 登录用户本月故事额度用完：只在点「开始录音」/「文本输入」时弹，关闭即回首页正常态 */}
      {showStoryQuota && <QuotaReached variant="story" asOverlay onClose={() => setShowStoryQuota(false)} />}
    </>
  )
}
