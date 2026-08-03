/**
 * @module   WritePage
 * @desc     文字模式「故事」页外壳（核心链路第 1 步的文字模式，语音模式是 /recording）——
 *           持有 textStory 状态，提交逻辑复用共享 useStorySubmit（isGarbageInput → 查 usable → putHandoff →
 *           跳 /restructure，带 ?qid），canSubmit 复用 computeRichness；读取可选 ?qid 并取题目做上下文 caption。
 *           本页无全局监听、无麦克风、无共享 ref，用 CSS 双挂载分发（与 recording 一致，安全）。
 *           建新故事额度（匿名试用总条数 / 注册用户月额度）走 useStoryQuotaGuard：挂载只预取不渲染，
 *           写作页始终正常显示；仅在用户点「提交」/「切换到语音」时才弹覆盖层（与首页同范式）。
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { type JSX, useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { getQuestionById } from '@/lib/db/questions'
import { computeRichness } from '@/lib/story-richness'
import { track } from '@/lib/client-events'
import { useStorySubmit } from '@/hooks/useStorySubmit'
import { useStoryQuotaGuard } from '@/hooks/useStoryQuotaGuard'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useNav } from '@/components/NavProgress'
import Toast from '@/components/Toast'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import WriteMobile from './WriteMobile'
import WriteDesktop from './WriteDesktop'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { WriteViewProps, WriteQuestionContext } from './types'

function WriteContent(): JSX.Element {
  // 「切换到语音」跳 /recording、退出跳首页均走 navigate → 点击当帧亮顶部进度条（消冷缓存空窗）
  const { navigate } = useNav()
  const qid = useSearchParams().get('qid')
  const [textStory, setTextStory] = useState('')
  const [questionContext, setQuestionContext] = useState<WriteQuestionContext | null>(null)
  // 埋点用状态（不参与渲染/分支，故用 ref）：
  //   submittedRef  是否已【离开采集态】—— 口径对齐录音页（recording/page.tsx 只在 proceed 时置真）：
  //                 被 garbage / text_too_short 打回时人还在本页、还在写，此时关页走人就是真放弃，
  //                 必须能报出 capture_abandoned。此前「点过提交就永久置真」会把这批人全屏蔽掉，
  //                 而「被打回后放弃」恰恰是最该看见的一格（text 路径放弃率会系统性偏低）。
  //   abandonedRef  放弃事件全生命周期只报一次 —— pagehide 与卸载可能先后触发
  //   textRef       卸载时要读当时的字数，而放弃 effect 是空依赖（只挂一次），故用 ref 同步
  const submittedRef = useRef(false)
  const abandonedRef = useRef(false)
  const textRef = useRef('')
  useEffect(() => { textRef.current = textStory }, [textStory])

  // onOutcome：submit() 内部才知道本次结局，靠它把 submittedRef 与真实结局对齐（打回则复位）。
  // proceed / quota_blocked / consent_blocked 三种都会把用户带离本页或就地终结本次采集 → 置真；
  // garbage / text_too_short 是「打回重写」→ 复位为假。纯通知，不参与 useStorySubmit 的任何分支。
  const { submitting, toastMsg, quotaReached, submit, dismissToast, dismissQuota } = useStorySubmit({
    text: textStory,
    qid,
    onOutcome: (outcome) => { submittedRef.current = outcome !== 'garbage' && outcome !== 'text_too_short' },
  })

  // 建新故事额度守卫（匿名试用总条数 / 注册用户月额度，共享 hook）：挂载只预取不渲染，
  // 写作页始终正常显示，提示只在用户点「提交」/「切换到语音」时才弹。
  const storyQuota = useStoryQuotaGuard()

  // 采集开始 / 中途放弃埋点。放弃的两条出口都要盯：站内跳走（组件卸载）与关标签页/切后台（pagehide）；
  // 后者页面随时会被冻结，必须走 keepalive 的 fetch（sendBeacon 设不了 Authorization 头，见 client-events 顶注）。
  // 本页【不报 capture_submitted】—— 已由 useStorySubmit 覆盖，这里再报就是双计。
  useEffect(() => {
    track('flow.capture_started', { mode: 'text' })
    const reportAbandon = (exit: 'nav' | 'pagehide'): void => {
      if (submittedRef.current || abandonedRef.current) return
      abandonedRef.current = true
      track(
        'flow.capture_abandoned',
        { mode: 'text', exit, charCount: textRef.current.trim().length },
        exit === 'pagehide' ? { keepalive: true } : undefined,
      )
    }
    // persisted=true ＝ 页面进 bfcache（iOS 切后台/后退最常见），用户很可能马上回来接着写。
    // 此时报 abandoned 会双错：把「回来了的人」算成放弃，且 abandonedRef 被用掉后他【真放弃时反而不报】。
    // 故只在 persisted=false（真正卸载）时报。代价是 iOS 上一部分真放弃收不到，abandoned 偏低——
    // 宁可偏低：偏低能用「有 capture_started 但此后 24h 无任何事件」推断口径补，偏高则无从分辨。
    const onPageHide = (e: PageTransitionEvent): void => { if (!e.persisted) reportAbandon('pagehide') }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      reportAbandon('nav')
    }
  }, [])

  /** 「提交」入口：先核额度，未超额才走共享提交流程 */
  async function handleSubmit(): Promise<void> {
    if (await storyQuota.checkBlocked()) {
      // 【漏斗盲区补丁】本页守卫【前置】于 useStorySubmit：被额度拦下时 submit() 根本不跑，
      // 那边的 quota_blocked 无人上报 → /write 的额度拦截会在漏斗里凭空消失（看着像用户自己没提交）。
      // 录音页守卫在 handleFinish 内部、由同一函数上报，不存在这个问题；只有本页要单独补。
      track('flow.capture_submitted', { mode: 'text', outcome: 'quota_blocked', charCount: textStory.trim().length })
      submittedRef.current = true   // 已判定结局，离开页面不再叠报「放弃」
      return
    }
    // 这里【不】置 submittedRef —— 结局未定（可能被 garbage / text_too_short 打回、人还在页面上）。
    // 置真/复位一律交给上面的 onOutcome，与 useStorySubmit 上报的结局同一时刻、同一个值。
    submit()
  }
  // checkBlocked（查额度，跨新加坡可 1-2s）期间也让提交按钮转圈：guard pending OR 进 submitting，
  // 与其后 useStorySubmit 自持的 submitting 无缝接力（submit() 首个 await 前即同步置 submitting=true）。
  const [runSubmit, checkingSubmit] = useAsyncAction(handleSubmit)

  /**
   * 「切换到语音」入口：与首页「开始录音」同一道守卫。
   * 录音页下一步就是花钱的 ASR，若额度满还放进去，用户录完、转完文字（真花钱）才在保存时被 402 拦 ——
   * 用户时间白花、ASR 费用也白花。故在离开本页前就拦住。
   */
  async function handleSwitchToVoice(): Promise<void> {
    // 【必须在额度守卫之前报】被额度拦下的人也是点了「切换到语音」的人；埋在守卫之后，
    // 额度拦截就会伪装成「用户根本没点」。fire-and-forget，不影响下面的分支。
    // mode 必须按 qid 判：首页三个入口全是 ieltsMode ? 'ielts' : 'story'，此处此前写死 'story'，
    // 于是「带着题目进来、改用语音」的雅思用户会被记成故事模式，两种模式的入口分布长期偏斜。
    track('flow.story_entry', { entry: 'record_from_write', mode: qid ? 'ielts' : 'story' })
    if (await storyQuota.checkBlocked()) return
    navigate(qid ? `/recording?qid=${qid}` : '/recording')
  }

  // ?qid 存在时取题目做上下文 caption（客户端读，找不到/出错静默忽略，不挡写作）
  useEffect(() => {
    if (!qid) { setQuestionContext(null); return }
    let cancelled = false
    void getQuestionById(qid).then((q) => {
      if (cancelled || !q) return
      setQuestionContext({
        part: q.part,
        en: q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text,
        zh: q.part === 2 ? (q.cue_card_title_zh ?? '') : (q.question_text_zh ?? ''),
      })
    }).catch(() => { /* 静默 */ })
    return () => { cancelled = true }
  }, [qid])

  const canSubmit = computeRichness(textStory).canSubmit

  // 未保存退出确认（仅桌面接线；移动端仍走 doExit 直接退，行为不变）。
  const [confirmExit, setConfirmExit] = useState(false)
  const doExit = () => navigate('/')
  const requestExit = () => { if (textStory.trim().length > 0) setConfirmExit(true); else doExit() }

  const viewProps: WriteViewProps = {
    textStory,
    onChangeText: setTextStory,
    canSubmit,
    submitting: submitting || checkingSubmit,
    onSubmit: () => void runSubmit(),
    onSwitchToVoice: () => void handleSwitchToVoice(),
    questionContext,
    onExit: doExit,
  }

  return (
    <>
      <div className="lg:hidden"><WriteMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 外壳（故事步激活）+ WriteDesktop 写作舞台。
          ✕ 与 Esc③ 都走 requestExit：有未提交内容时先弹确认。 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="story" onExit={requestExit}>
          <WriteDesktop {...viewProps} onExit={requestExit} />
        </FlowShellDesktop>
        <ConfirmDialog
          open={confirmExit}
          title="还没保存哦"
          description="你写的内容还没提交，离开就没啦。确定要离开吗？"
          confirmText="离开"
          cancelText="留下继续"
          onConfirm={() => { setConfirmExit(false); doExit() }}
          onCancel={() => setConfirmExit(false)}
        />
      </div>
      <Toast message={toastMsg} onDismiss={dismissToast} />
      {/* 建新故事额度已满：只在点「提交」/「切换到语音」时弹，关闭即回写作页正常态（已写内容不丢）。
          匿名试用用尽 → trial（引导注册）；注册用户月额度用尽 → story。 */}
      {storyQuota.blockedVariant && (
        <QuotaReached variant={storyQuota.blockedVariant} surface="write" asOverlay onClose={storyQuota.dismiss} />
      )}
      {/* 提交时匿名整理额度用尽：弹试用结束提示（trial 变体），关闭留在本页 */}
      {quotaReached && <QuotaReached variant="trial" surface="write" asOverlay onClose={dismissQuota} />}
    </>
  )
}

export default function WritePage(): JSX.Element {
  return <Suspense><WriteContent /></Suspense>
}
