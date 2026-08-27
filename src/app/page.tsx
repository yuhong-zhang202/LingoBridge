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
import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useNav } from '@/components/NavProgress'
import Toast from '@/components/Toast'
import FirstUseConsent from '@/components/FirstUseConsent'
import MicPermissionSheet from '@/components/MicPermissionSheet'
import QuotaReached from '@/components/QuotaReached'
import ChangelogAnnouncement from '@/components/ChangelogAnnouncement'
import TargetBandNudge from '@/components/TargetBandNudge'
import FeedbackReplyPopup from '@/components/FeedbackReplyPopup'
import { useSwitchQuestion } from '@/hooks/useSwitchQuestion'
import { useStorySubmit } from '@/hooks/useStorySubmit'
import { useStoryQuotaGuard } from '@/hooks/useStoryQuotaGuard'
import { computeRichness } from '@/lib/story-richness'
import { track } from '@/lib/client-events'
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
  // 文字采集只算【开始一次】：面板开→关→开三次会报三条 capture_started，把这一级的分母灌大、
  // 转化率被稀释（同一个人同一次停留其实只开始了一次采集）。ref 守卫，同一次页面停留只报一次；
  // 两个开面板入口（文本按钮 / 麦克风失败后「改用文字」）共用它，换哪条路进来都只算一次。
  const textCaptureStartedRef = useRef(false)
  /** 报一次文字采集开始（同一次页面停留只报一次） */
  const trackTextCaptureStarted = (): void => {
    if (textCaptureStartedRef.current) return
    textCaptureStartedRef.current = true
    track('flow.capture_started', { mode: 'text' })
  }
  const { question, loading, error, exhausted, next } = useSwitchQuestion()
  // 文字提交复用共享 hook；qid 取首页语义（雅思模式带当前题 id，否则 null）
  const { submitting, toastMsg, quotaVariant, submit, dismissToast, dismissQuota } = useStorySubmit({ text: textStory, qid: ieltsMode && question ? question.id : null })

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
    // 【必须在额度守卫之前报】被额度拦下的人也是「点了开始录音」的人；埋在守卫之后，
    // 额度拦截就会伪装成「用户根本没点」，漏斗直接归错格。埋点 fire-and-forget，不影响下面任何分支。
    track('flow.story_entry', { entry: 'record', mode: ieltsMode ? 'ielts' : 'story' })
    if (await storyQuota.checkBlocked()) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      track('flow.mic_permission', { result: 'granted', surface: 'home' })
      stream.getTracks().forEach((t) => t.stop())   // 拿到权限即释放，录音页会重新获取
      navigate(ieltsMode && question ? `/recording?qid=${question.id}` : '/recording')
    } catch (err) {
      const name = (err as DOMException)?.name
      track('flow.mic_permission', { result: name === 'NotAllowedError' ? 'denied' : 'unavailable', surface: 'home' })
      setMicSheet(name === 'NotAllowedError' ? 'denied' : 'unavailable')
    }
  }
  // 额度核对 + 麦克风探测期间按钮转圈（GradientButton loading）；跳转瞬间接力顶部进度条。
  const [startRecording, startingRec] = useAsyncAction(handleStartRecording)

  /**
   * 打开文字输入面板 —— 两个入口共用这一条路径（此前各写各的，「麦克风失败→改用文字」那条绕过了
   * 文本按钮那条，漏了埋点、成了漏斗盲区；分两处维护则下次改口径必漏一处）。
   * @param source  'text'＝首页「文本输入」按钮；'mic-fallback'＝麦克风失败后在 sheet 里点「改用文字」
   *
   * ⚠️ 两条路径【不对称，别抹平】：mic-fallback 那条在点「开始录音」时已报过
   * story_entry(entry='record')、也已在 handleStartRecording 里过完额度守卫，故此处不重复报、不重复核。
   *
   * ⚠️ 埋点顺序是硬约束：story_entry 在额度守卫【之前】（被拦下的人也是点了入口的人；埋在守卫之后，
   * 额度拦截就会伪装成「用户根本没点」），capture_started 在守卫【之后】（真进到输入态才算开始采集）。
   * 整个「被额度拦掉多少人」就靠这两者的差值，颠倒任一个差值恒为 0。
   * ⚠️【这个差值必须按 distinct user_id 算，不能用裸计数】：story_entry 每次开面板都报，而
   * capture_started 有 ref 守卫、同一次停留只报一次（否则开→关→开会把 D2 的分母灌大）。
   * 两者去重口径不同，裸计数相减会凭空造出「被额度拦掉的人」——开关两次面板就多算一个。
   * 同理 capture_started(mode='text') 还有 /write 挂载这第二个来源，也只能按人聚合看。
   */
  async function openTextPanel(source: 'text' | 'mic-fallback'): Promise<void> {
    if (source === 'text') {
      track('flow.story_entry', { entry: 'text', mode: ieltsMode ? 'ielts' : 'story' })
      if (await storyQuota.checkBlocked()) return
    }
    trackTextCaptureStarted()
    setShowTextInput(true)
  }

  // 桌面「或用文字输入」：与移动端文本面板同源的守卫。此前该入口是裸 <Link>，
  // 用户会先进 /write 写完、点提交才被 /write 的守卫拦下 —— 等于白写一场，故前置到这里。
  const writeHref = ieltsMode && question ? `/write?qid=${question.id}` : '/write'
  async function handleOpenWrite(): Promise<void> {
    // 同上：在守卫之前报，否则被额度拦下的桌面用户不产生入口事件
    track('flow.story_entry', { entry: 'write', mode: ieltsMode ? 'ielts' : 'story' })
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
    // 开面板走统一入口（埋点 + 额度守卫都在里面）；关面板无消耗动作、不报不核
    onSetShowTextInput: (v) => { if (v) void openTextPanel('text'); else setShowTextInput(false) },
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

      {/* 目标分提醒：分析页词组改按目标分出词后，提醒【已注册未设目标分】用户去设一次（终生只弹一次、可关、非阻断）。
          门控含「已看过当前版本公告」→ 与 ChangelogAnnouncement 串行不叠屏；匿名不弹（门控含 !isAnonymous）。
          z 低于同意硬闸（组件内已包 relative z-40 压住 ProfileModal 的 z-50）。 */}
      <TargetBandNudge />

      {/* 反馈闭环：提过反馈的人，在他那条被处理并写了回复之后，进首页告诉他一次（弹窗带上他自己的原话）。
          串行链的最后一环（门控含「公告已看过 + 目标分提醒已看过」）；已读记在服务端 feedback.notified_at，
          所以换设备不会重弹、清缓存也不会重弹。仅注册用户、仅主动反馈（服务端已过滤）。 */}
      <FeedbackReplyPopup />

      {/* 共享：提示 / 首次同意 / 麦克风权限弹层 */}
      <Toast message={toastMsg} onDismiss={dismissToast} />
      <FirstUseConsent />
      <MicPermissionSheet
        open={micSheet !== null}
        reason={micSheet ?? 'denied'}
        onUseText={() => {
          setMicSheet(null)
          // 与文本按钮开的是同一个面板，故走同一个 openTextPanel（口径只有一份，改一处两条路径同步）。
          // source='mic-fallback' 使它只报 capture_started：story_entry 在点「开始录音」时已报过
          // （entry='record'）、额度守卫也已在 handleStartRecording 里过完，此处都不重复。
          // 但 capture_started 必须补：不补就成漏斗盲区——「麦克风失败→改用文字」的人有 story_entry
          // 却没有 capture_started，会被算成「点了入口但没进采集」，与真正被额度拦掉的人混在同一格里。
          void openTextPanel('mic-fallback')
        }}
        onDismiss={() => setMicSheet(null)}
      />
      {/* 提交途中撞额度：整理 402 → trial（匿名试用用尽）；建语料 402 → 按服务端 reason 分 trial / story
          （文字路径 2026-08-27 起在提交时直接建语料，故这里会出现注册用户的月额度变体）。关闭留在本页。 */}
      {quotaVariant && <QuotaReached variant={quotaVariant} surface="home" asOverlay onClose={dismissQuota} />}
      {/* 建新故事额度已满：只在点「开始录音」/「文本输入」/ 桌面「或用文字输入」时弹，关闭即回首页正常态。
          匿名试用用尽 → trial（引导注册）；注册用户月额度用尽 → story。 */}
      {storyQuota.blockedVariant && (
        <QuotaReached variant={storyQuota.blockedVariant} surface="home" asOverlay onClose={storyQuota.dismiss} />
      )}
    </>
  )
}
