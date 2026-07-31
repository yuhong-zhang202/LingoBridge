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
import { type JSX, useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { getQuestionById } from '@/lib/db/questions'
import { computeRichness } from '@/lib/story-richness'
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
  const { submitting, toastMsg, quotaReached, submit, dismissToast, dismissQuota } = useStorySubmit({ text: textStory, qid })

  // 建新故事额度守卫（匿名试用总条数 / 注册用户月额度，共享 hook）：挂载只预取不渲染，
  // 写作页始终正常显示，提示只在用户点「提交」/「切换到语音」时才弹。
  const storyQuota = useStoryQuotaGuard()

  /** 「提交」入口：先核额度，未超额才走共享提交流程 */
  async function handleSubmit(): Promise<void> {
    if (await storyQuota.checkBlocked()) return
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
        <QuotaReached variant={storyQuota.blockedVariant} asOverlay onClose={storyQuota.dismiss} />
      )}
      {/* 提交时匿名整理额度用尽：弹试用结束提示（trial 变体），关闭留在本页 */}
      {quotaReached && <QuotaReached variant="trial" asOverlay onClose={dismissQuota} />}
    </>
  )
}

export default function WritePage(): JSX.Element {
  return <Suspense><WriteContent /></Suspense>
}
