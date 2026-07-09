/**
 * @module   WritePage
 * @desc     文字模式「故事」页外壳（核心链路第 1 步的文字模式，语音模式是 /recording）——
 *           持有 textStory 状态与提交逻辑（复刻首页 handleTextSubmit：/api/restructure 查 usable →
 *           putHandoff → 跳 /restructure，带上 ?qid），读取可选 ?qid 并取题目做上下文 caption。
 *           本页无全局监听、无麦克风、无共享 ref，用 CSS 双挂载分发（与 recording 一致，安全）。
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { isGarbageInput, GARBAGE_TOAST_MSG } from '@/lib/utils'
import { putHandoff } from '@/lib/handoff'
import { getQuestionById } from '@/lib/db/questions'
import Toast from '@/components/Toast'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import WriteMobile from './WriteMobile'
import WriteDesktop from './WriteDesktop'
import type { WriteViewProps, WriteQuestionContext } from './types'

function WriteContent(): JSX.Element {
  const router = useRouter()
  const qid = useSearchParams().get('qid')
  const [textStory, setTextStory] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [questionContext, setQuestionContext] = useState<WriteQuestionContext | null>(null)

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

  const canSubmit = textStory.trim().length >= 10

  // 复刻首页 handleTextSubmit：预检垃圾输入 → 查 usable → putHandoff 跳 /restructure（带 qid）
  const handleSubmit = useCallback(async (): Promise<void> => {
    if (isGarbageInput(textStory)) { setToastMsg(GARBAGE_TOAST_MSG); return }
    setSubmitting(true)
    const qidParam = qid ? `&qid=${qid}` : ''
    try {
      const res = await fetch('/api/restructure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: textStory }),
      })
      if (res.ok) {
        const data = (await res.json()) as { cleanedText: string; usable: boolean }
        if (!data.usable) { setToastMsg(GARBAGE_TOAST_MSG); return }
      }
      // API 错误或 usable=true，放行（restructure 页会再跑一次，属已知开销）
      router.push(`/restructure?h=${putHandoff(textStory)}${qidParam}`)
    } catch {
      router.push(`/restructure?h=${putHandoff(textStory)}${qidParam}`)
    } finally {
      setSubmitting(false)
    }
  }, [textStory, qid, router])

  const viewProps: WriteViewProps = {
    textStory,
    onChangeText: setTextStory,
    canSubmit,
    submitting,
    onSubmit: () => void handleSubmit(),
    onSwitchToVoice: () => router.push(qid ? `/recording?qid=${qid}` : '/recording'),
    questionContext,
    onExit: () => router.back(),
  }

  return (
    <>
      <div className="lg:hidden"><WriteMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 外壳（故事步激活）+ WriteDesktop 写作舞台 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="story" onExit={viewProps.onExit}>
          <WriteDesktop {...viewProps} />
        </FlowShellDesktop>
      </div>
      <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />
    </>
  )
}

export default function WritePage(): JSX.Element {
  return <Suspense><WriteContent /></Suspense>
}
