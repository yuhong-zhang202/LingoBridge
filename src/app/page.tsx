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
import HomeMobile from './HomeMobile'
import HomeDesktop from './HomeDesktop'
import type { HomeViewProps } from './types'

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
  // ⚠️ 测试钩子：URL 带 ?previewQuota=story|ielts 时强制弹额度双维度弹层（填占位假数字），供真机看 UI。
  // 产品方凑不齐 10 条语料、触发不了真实 402，故给个显式带参的预览开关；普通用户无此参、完全不受影响。
  // 用 window.location 读参（避免为一个测试钩子给首页套 useSearchParams 的 Suspense 边界）。
  const [previewQuota, setPreviewQuota] = useState<'story' | 'ielts' | null>(null)
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

  // ⚠️ 测试钩子：挂载读一次 ?previewQuota，命中 story/ielts 即置态、下方强制渲染预览弹层。
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('previewQuota')
    if (p === 'story' || p === 'ielts') setPreviewQuota(p)
  }, [])

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
      {/* ============ 移动端：原竖排布局 ============ */}
      <div className="lg:hidden"><HomeMobile {...viewProps} /></div>

      {/* ============ 桌面端：营销落地页 ============ */}
      <div className="hidden lg:block"><HomeDesktop {...viewProps} /></div>

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
      {/* ⚠️ 测试钩子：?previewQuota=story|ielts 强制弹双维度弹层（占位假数字）。触发侧传大数被夹到 limit（显满），
          对侧给个部分用量。仅显式带参可达，关闭即消失。 */}
      {previewQuota && (
        <QuotaReached
          variant={previewQuota}
          asOverlay
          previewUsed={previewQuota === 'story' ? { story: 999, review: 6 } : { story: 4, review: 999 }}
          onClose={() => setPreviewQuota(null)}
        />
      )}
    </>
  )
}
