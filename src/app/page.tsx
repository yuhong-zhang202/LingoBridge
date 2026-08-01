/**
 * @module   HomePage
 * @desc     首页外壳 —— 集中持有全部 state / hook / handler（雅思切换题 useSwitchQuestion、文字提交
 *           useStorySubmit、登录用户当月额度核对、Hero 打字机、麦克风权限探测等），组装成一份 HomeViewProps
 *           后按 lg 断点分发两套纯展示视图：<1024 渲染 HomeMobile；≥1024 渲染 HomeDesktop。两端共用同一套
 *           state/handler，功能完全一致。共享弹层（Toast / 首次同意 / 麦克风权限 / 试用额度 / 月额度）留在外壳。
 *           建新故事额度（匿名试用总条数 / 注册用户月额度）走 useStoryQuotaGuard：挂载只预取不渲染，
 *           首页始终正常显示；仅在点「开始录音」/「文本输入」/ 桌面「或用文字输入」时才弹覆盖层。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useNav } from '@/components/NavProgress'
import Toast from '@/components/Toast'
import FirstUseConsent from '@/components/FirstUseConsent'
import MicPermissionSheet from '@/components/MicPermissionSheet'
import QuotaReached from '@/components/QuotaReached'
import ChangelogAnnouncement from '@/components/ChangelogAnnouncement'
import { useSwitchQuestion } from '@/hooks/useSwitchQuestion'
import { useStorySubmit } from '@/hooks/useStorySubmit'
import { useStoryQuotaGuard } from '@/hooks/useStoryQuotaGuard'
import { computeRichness } from '@/lib/story-richness'
import type { HomeViewProps } from './types'

// 路由级代码分割：移动/桌面两套纯展示视图各自独立 chunk，按视口【互斥渲染】——移动端只下载 HomeMobile、
// 桌面端只下载 HomeDesktop，互不下载对方代码（此前 CSS lg:hidden 两套都渲染、两端都下载）。
// loading 占位用页面背景色 bg-bg-page，避免 chunk 加载瞬间闪白。ssr 按现状（默认，page 本身 'use client'）。
const HomeMobile = dynamic(() => import('./HomeMobile'), {
  loading: () => <div className="min-h-screen bg-bg-page" />,
})
const HomeDesktop = dynamic(() => import('./HomeDesktop'), {
  loading: () => <div className="min-h-screen bg-bg-page" />,
})

// Hero 标题第二行（故事模式下打字机逐字浮现）
const HERO_LINE2 = '个性化雅思语料'

export default function HomePage() {
  const { navigate } = useNav()
  const [showTextInput, setShowTextInput] = useState(false)
  const [textStory, setTextStory] = useState('')
  const [ieltsMode, setIeltsMode] = useState(false)
  // 建新故事额度守卫（匿名试用总条数 / 注册用户月额度，共享 hook）：挂载只预取不渲染，
  // 首页永远正常显示，提示只在点「开始录音」/「文本输入」时才弹。
  const storyQuota = useStoryQuotaGuard()
  const [micSheet, setMicSheet] = useState<null | 'denied' | 'unavailable'>(null)
  const [typed, setTyped] = useState('')
  const [reuseTab, setReuseTab] = useState(0)   // 模块五：信息复用 Tab 舞台当前功能
  // 视口判定（客户端）：null=未定（SSR/首帧）→ 显背景占位；resolve 后只挂载匹配的那套视图，
  // 另一套视图的 chunk 永不下载（配合上方 next/dynamic 实现「移动端不下载桌面代码」）。断点 = Tailwind lg(1024)。
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  const { question, loading, error, exhausted, next } = useSwitchQuestion()
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

  // 点「开始录音」先核额度、再探测麦克风：有权限照常进录音页，没权限弹 sheet（避免录音页静默卡死）。
  // checkBlocked / getUserMedia 都是异步慢操作，此前 fire-and-forget 无反馈 → 用户以为按钮坏了。
  async function handleStartRecording() {
    if (await storyQuota.checkBlocked()) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())   // 拿到权限即释放，录音页会重新获取
      navigate(ieltsMode && question ? `/recording?qid=${question.id}` : '/recording')
    } catch (err) {
      const name = (err as DOMException)?.name
      setMicSheet(name === 'NotAllowedError' ? 'denied' : 'unavailable')
    }
  }
  // 额度核对 + 麦克风探测期间按钮转圈（GradientButton loading）；跳转瞬间接力顶部进度条。
  const [startRecording, startingRec] = useAsyncAction(handleStartRecording)

  /** 「文本输入」入口：打开面板前同样核额度；关闭面板不核（无消耗动作） */
  async function handleSetShowTextInput(v: boolean): Promise<void> {
    if (v && await storyQuota.checkBlocked()) return
    setShowTextInput(v)
  }

  // 桌面「或用文字输入」：与移动端文本面板同源的守卫。此前该入口是裸 <Link>，
  // 用户会先进 /write 写完、点提交才被 /write 的守卫拦下 —— 等于白写一场，故前置到这里。
  const writeHref = ieltsMode && question ? `/write?qid=${question.id}` : '/write'
  async function handleOpenWrite(): Promise<void> {
    if (await storyQuota.checkBlocked()) return
    navigate(writeHref)
  }

  const viewProps: HomeViewProps = {
    ieltsMode,
    showTextInput,
    question,
    loading,
    error,
    exhausted,
    textStory,
    submitting,
    canSubmit: computeRichness(textStory).canSubmit,
    startingRec,
    typed,
    reuseTab,
    writeHref,
    onSetShowTextInput: (v) => void handleSetShowTextInput(v),
    onSelectMyStory: () => setIeltsMode(false),
    onSelectIelts: () => { if (!ieltsMode) { setIeltsMode(true); void next() } },
    onNext: () => void next(),
    onStartRecording: () => void startRecording(),
    onOpenWrite: () => void handleOpenWrite(),
    onChangeTextStory: setTextStory,
    onSubmitStory: submit,
    onSelectReuseTab: setReuseTab,
  }

  return (
    <>
      {/* 按视口互斥渲染：未定→背景占位（不闪白）；移动端只挂 HomeMobile、桌面端只挂 HomeDesktop。
          视觉与原 CSS lg:hidden/hidden lg:block 一致，只是改为「只下载/只挂载匹配的那套」。 */}
      {isDesktop === null
        ? <div className="min-h-screen bg-bg-page" />
        : isDesktop
          ? <HomeDesktop {...viewProps} />
          : <HomeMobile {...viewProps} />}

      {/* 版本更新公告卡：进首页主动弹一次（按版本号只弹一次、可关、非阻断），内容来自 CHANGELOG[0]。
          z-40 低于首次同意硬闸（z-50）——新用户先过同意闸，老用户直接见公告。 */}
      <ChangelogAnnouncement />

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
      {/* 建新故事额度已满：只在点「开始录音」/「文本输入」/ 桌面「或用文字输入」时弹，关闭即回首页正常态。
          匿名试用用尽 → trial（引导注册）；注册用户月额度用尽 → story。 */}
      {storyQuota.blockedVariant && (
        <QuotaReached variant={storyQuota.blockedVariant} asOverlay onClose={storyQuota.dismiss} />
      )}
    </>
  )
}
