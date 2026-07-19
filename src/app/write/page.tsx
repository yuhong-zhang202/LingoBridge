/**
 * @module   WritePage
 * @desc     文字模式「故事」页外壳（核心链路第 1 步的文字模式，语音模式是 /recording）——
 *           持有 textStory 状态，提交逻辑复用共享 useStorySubmit（isGarbageInput → 查 usable → putHandoff →
 *           跳 /restructure，带 ?qid），canSubmit 复用 computeRichness；读取可选 ?qid 并取题目做上下文 caption。
 *           本页无全局监听、无麦克风、无共享 ref，用 CSS 双挂载分发（与 recording 一致，安全）。
 *           月额度：挂载只预取不渲染，写作页始终正常显示；仅在用户点「提交」时才弹覆盖层（与首页同范式）。
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { type JSX, useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getQuestionById } from '@/lib/db/questions'
import { getAccount } from '@/lib/auth'
import { countCorpusThisMonth, STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { computeRichness } from '@/lib/story-richness'
import { useStorySubmit } from '@/hooks/useStorySubmit'
import Toast from '@/components/Toast'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import WriteMobile from './WriteMobile'
import WriteDesktop from './WriteDesktop'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { WriteViewProps, WriteQuestionContext } from './types'

function WriteContent(): JSX.Element {
  const router = useRouter()
  const qid = useSearchParams().get('qid')
  const [textStory, setTextStory] = useState('')
  const [questionContext, setQuestionContext] = useState<WriteQuestionContext | null>(null)
  const { submitting, toastMsg, quotaReached, submit, dismissToast, dismissQuota } = useStorySubmit({ text: textStory, qid })

  // 额度预取结果：null = 尚未取到 / 非登录用户（点击时再现取）；true/false = 本月故事额度是否已用完。
  // 只预取、不渲染 —— 额度提示绝不在加载完成时自动盖住写作页，仅在用户真正点「提交」时才弹。
  const [storyQuotaOver, setStoryQuotaOver] = useState<boolean | null>(null)
  const [showStoryQuota, setShowStoryQuota] = useState(false)

  // 登录用户：挂载时预取当月语料数缓存到 storyQuotaOver，供点提交时零延迟判断。仅预取，不改变本页渲染。
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

  /**
   * 提交守卫：本月故事额度已用完时弹覆盖层并返回 true（调用方须中止提交）。
   * 优先用挂载时的预取结果（点击零延迟）；预取未就绪/未取到才现场核一次。
   * 匿名与未登录用户不受月额度约束（各自走试用额度闸），一律放行；核不准也放行，服务端 402 仍是硬防线。
   */
  async function blockedByStoryQuota(): Promise<boolean> {
    let over = storyQuotaOver
    if (over === null) {
      try {
        const acct = await getAccount()
        if (!acct || acct.isAnonymous || !acct.email) return false
        over = (await countCorpusThisMonth()) >= STORY_MONTHLY_LIMIT
        setStoryQuotaOver(over)
      } catch { return false }
    }
    if (over) { setShowStoryQuota(true); return true }
    return false
  }

  /** 「提交」入口：先核月额度，未超额才走共享提交流程 */
  async function handleSubmit(): Promise<void> {
    if (await blockedByStoryQuota()) return
    submit()
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
  const doExit = () => router.push('/')
  const requestExit = () => { if (textStory.trim().length > 0) setConfirmExit(true); else doExit() }

  const viewProps: WriteViewProps = {
    textStory,
    onChangeText: setTextStory,
    canSubmit,
    submitting,
    onSubmit: () => void handleSubmit(),
    onSwitchToVoice: () => router.push(qid ? `/recording?qid=${qid}` : '/recording'),
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
      {/* 登录用户本月故事额度用完：只在点「提交」时弹，关闭即回写作页正常态（已写内容不丢） */}
      {showStoryQuota && <QuotaReached variant="story" asOverlay onClose={() => setShowStoryQuota(false)} />}
      {/* 提交时匿名整理额度用尽：弹试用结束提示（trial 变体），关闭留在本页 */}
      {quotaReached && <QuotaReached variant="trial" asOverlay onClose={dismissQuota} />}
    </>
  )
}

export default function WritePage(): JSX.Element {
  return <Suspense><WriteContent /></Suspense>
}
