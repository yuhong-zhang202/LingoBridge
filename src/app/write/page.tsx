/**
 * @module   WritePage
 * @desc     文字模式「故事」页外壳（核心链路第 1 步的文字模式，语音模式是 /recording）——
 *           持有 textStory 状态，提交逻辑复用共享 useStorySubmit（isGarbageInput → 查 usable → putHandoff →
 *           跳 /restructure，带 ?qid），canSubmit 复用 computeRichness；读取可选 ?qid 并取题目做上下文 caption。
 *           本页无全局监听、无麦克风、无共享 ref，用 CSS 双挂载分发（与 recording 一致，安全）。
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getQuestionById } from '@/lib/db/questions'
import { computeRichness } from '@/lib/story-richness'
import { useStorySubmit } from '@/hooks/useStorySubmit'
import Toast from '@/components/Toast'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import WriteMobile from './WriteMobile'
import WriteDesktop from './WriteDesktop'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { WriteViewProps, WriteQuestionContext } from './types'

function WriteContent(): JSX.Element {
  const router = useRouter()
  const qid = useSearchParams().get('qid')
  const [textStory, setTextStory] = useState('')
  const [questionContext, setQuestionContext] = useState<WriteQuestionContext | null>(null)
  const { submitting, toastMsg, submit, dismissToast } = useStorySubmit({ text: textStory, qid })

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
    onSubmit: submit,
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
    </>
  )
}

export default function WritePage(): JSX.Element {
  return <Suspense><WriteContent /></Suspense>
}
