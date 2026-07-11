/**
 * @module   useStorySubmit
 * @desc     故事「文字提交」共享 hook —— 封装两层校验与跳转：isGarbageInput 预检（不调 API）→
 *           /api/restructure 查 usable → putHandoff → 跳 /restructure（带上 qid）。首页与 /write 复用同一份，
 *           唯一差异 qid 由入参决定（首页传 ieltsMode&&question?question.id:null，/write 传 ?qid）。
 *
 *   注：文字提交尾段与 recording/handleFinish 同构（都是 isGarbageInput → usable → putHandoff → 跳 /restructure），
 *   但 recording 多一套转写前置管线（最短时长 / blob 取用与大小校验 / /api/transcribe / AbortController 中断），
 *   差异大，故本 hook 不并入 recording；日后若要统一录音路径再单独评估。
 *
 * @author   LingoBridge
 * @created  2026-07-09
 */
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { isGarbageInput, GARBAGE_TOAST_MSG } from '@/lib/utils'
import { putHandoff } from '@/lib/handoff'
import { getSupabase } from '@/lib/supabase'

/** 取当前 session 的 Bearer 头，供受保护 API 鉴权使用（无 session 时返回空对象） */
async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await getSupabase().auth.getSession()
  const token = session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

interface UseStorySubmitArgs {
  /** 待提交的故事文本 */
  text: string
  /** 雅思模式携带的题目 id（无则 null，跳转不带 &qid） */
  qid: string | null
}

interface UseStorySubmitReturn {
  submitting: boolean
  toastMsg: string | null
  /** 触发提交（幂等语义与原 handleTextSubmit 一致） */
  submit: () => void
  dismissToast: () => void
}

/**
 * 故事文字提交 hook
 * @param  args  { text, qid }
 * @returns      { submitting, toastMsg, submit, dismissToast }
 */
export function useStorySubmit({ text, qid }: UseStorySubmitArgs): UseStorySubmitReturn {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  const submit = useCallback((): void => {
    void (async (): Promise<void> => {
      // 第一层：即时预检，不调 API
      if (isGarbageInput(text)) {
        setToastMsg(GARBAGE_TOAST_MSG)
        return
      }
      setSubmitting(true)
      const qidParam = qid ? `&qid=${qid}` : ''
      try {
        // 第二层：让 restructure 判断 usable
        const res = await fetch('/api/restructure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ rawText: text }),
        })
        if (res.ok) {
          const data = (await res.json()) as { cleanedText: string; usable: boolean }
          if (!data.usable) {
            setToastMsg(GARBAGE_TOAST_MSG)
            return
          }
        }
        // API 错误或 usable=true，放行（restructure 页会再跑一次，属已知开销）
        router.push(`/restructure?h=${putHandoff(text)}${qidParam}`)
      } catch {
        router.push(`/restructure?h=${putHandoff(text)}${qidParam}`)
      } finally {
        setSubmitting(false)
      }
    })()
  }, [text, qid, router])

  const dismissToast = useCallback((): void => setToastMsg(null), [])

  return { submitting, toastMsg, submit, dismissToast }
}
