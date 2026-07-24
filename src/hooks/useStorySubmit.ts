/**
 * @module   useStorySubmit
 * @desc     故事「文字提交」共享 hook —— 封装两层校验与跳转：isGarbageInput 预检（不调 API）→
 *           /api/restructure 查 usable：usable 时把整理结果一并 putHandoffJson({rawText,cleanedText}) 后
 *           跳 /restructure（restructure 页据此免二次整理调用）。首页与 /write 复用同一份，
 *           唯一差异 qid 由入参决定（首页传 ieltsMode&&question?question.id:null，/write 传 ?qid）。
 *           预检 402（匿名整理额度用尽）不跳转，改置 quotaReached，供调用方弹试用结束提示。
 *
 *   注：文字提交尾段与 recording/handleFinish 同构，但 recording 多一套转写前置管线（最短时长 /
 *   blob 取用与大小校验 / /api/transcribe / AbortController 中断），差异大，故本 hook 不并入 recording。
 *
 * @author   LingoBridge
 * @created  2026-07-09
 */
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { isGarbageInput, isTooShortForCorpus, GARBAGE_TOAST_MSG, TOO_SHORT_TOAST_MSG } from '@/lib/utils'
import { putHandoff, putHandoffJson } from '@/lib/handoff'
import { newFlowId } from '@/lib/flow-id'
import { apiFetch } from '@/lib/api-client'

interface UseStorySubmitArgs {
  /** 待提交的故事文本 */
  text: string
  /** 雅思模式携带的题目 id（无则 null，跳转不带 &qid） */
  qid: string | null
}

interface UseStorySubmitReturn {
  submitting: boolean
  toastMsg: string | null
  /** 预检遇匿名整理额度用尽（402）→ true；调用方据此弹试用结束提示（QuotaReached trial 变体），不跳转 */
  quotaReached: boolean
  /** 触发提交（幂等语义与原 handleTextSubmit 一致） */
  submit: () => void
  dismissToast: () => void
  dismissQuota: () => void
}

/**
 * 故事文字提交 hook
 * @param  args  { text, qid }
 * @returns      { submitting, toastMsg, quotaReached, submit, dismissToast, dismissQuota }
 */
export function useStorySubmit({ text, qid }: UseStorySubmitArgs): UseStorySubmitReturn {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [quotaReached, setQuotaReached] = useState(false)

  const submit = useCallback((): void => {
    void (async (): Promise<void> => {
      // 第一层：即时预检，不调 API
      if (isGarbageInput(text)) {
        setToastMsg(GARBAGE_TOAST_MSG)
        return
      }
      // 源头门槛（薄素材防线）：真实但有效字数不足 → 拦下、原文保留续写，引导补充维度（区别于上面的「不像经历」）
      if (isTooShortForCorpus(text)) {
        setToastMsg(TOO_SHORT_TOAST_MSG)
        return
      }
      // 文字路径的流程起点：开启一次新 flow_id，串起 整理→建语料（经 X-Flow-Id 头透传，不进 URL）
      newFlowId()
      setSubmitting(true)
      const qidParam = qid ? `&qid=${qid}` : ''
      try {
        // 第二层：让 restructure 判断 usable
        const res = await apiFetch('/api/restructure', {
          method: 'POST',
          json: { rawText: text },
        })
        // 匿名整理额度用尽：不跳转，弹试用结束提示（避免带到 restructure 页再失败一次）
        if (res.status === 402) {
          setQuotaReached(true)
          return
        }
        // 服务端同意闸拒绝（未捕获同意）：回首页触发同意弹窗，别把用户带到 restructure 页再 403 一次。
        if (res.status === 403) {
          router.push('/')
          return
        }
        if (res.ok) {
          const data = (await res.json()) as { cleanedText: string; usable: boolean; summary?: string }
          if (!data.usable) {
            setToastMsg(GARBAGE_TOAST_MSG)
            return
          }
          // usable：把整理结果（含一句话概括 summary）一并带走，restructure 页免二次整理调用、保存时写进 corpus.summary
          router.push(`/restructure?h=${putHandoffJson({ rawText: text, cleanedText: data.cleanedText, summary: data.summary ?? '' })}${qidParam}`)
          return
        }
        // 其他非 402 错误：放行跳转，由 restructure 页兜底自行整理
        router.push(`/restructure?h=${putHandoff(text)}${qidParam}`)
      } catch {
        // 网络失败：放行，restructure 页兜底
        router.push(`/restructure?h=${putHandoff(text)}${qidParam}`)
      } finally {
        setSubmitting(false)
      }
    })()
  }, [text, qid, router])

  const dismissToast = useCallback((): void => setToastMsg(null), [])
  const dismissQuota = useCallback((): void => setQuotaReached(false), [])

  return { submitting, toastMsg, quotaReached, submit, dismissToast, dismissQuota }
}
