/**
 * @module   useStorySubmit
 * @desc     故事「文字提交」共享 hook —— 封装两层校验与跳转：isGarbageInput 预检（不调 API）→
 *           /api/restructure 查 usable：usable 时把整理结果一并 putHandoffJson({rawText,cleanedText}) 后
 *           跳 /restructure（restructure 页据此免二次整理调用）。首页与 /write 复用同一份，
 *           唯一差异 qid 由入参决定（首页传 ieltsMode&&question?question.id:null，/write 传 ?qid）。
 *           预检 402（匿名整理额度用尽）不跳转，改置 quotaReached，供调用方弹试用结束提示。
 *
 *   注：语音路径的对称实现是 `hooks/useVoiceStorySubmit`。两者【对 /api/restructure 的分支判定
 *   已收敛到 `lib/restructure-gate` 这一份真源】，不再各写一份（分叉过一次、付过学费，见该文件顶注）；
 *   剩下的差异是语音独有的转写前置管线（最短时长 / blob 取用与大小校验 / /api/transcribe /
 *   AbortController 中断）与埋点上的 mode（text / voice），差异大，故两个 hook 不合并成一个。
 *
 * @author   LingoBridge
 * @created  2026-07-09
 */
import { useState, useCallback, useRef } from 'react'
import { useNav } from '@/components/NavProgress'
import { isGarbageInput, isTooShortForCorpus, GARBAGE_TOAST_MSG, TOO_SHORT_TOAST_MSG } from '@/lib/utils'
import { putHandoff, putHandoffJson } from '@/lib/handoff'
import { newFlowId } from '@/lib/flow-id'
import { apiFetch } from '@/lib/api-client'
import { evaluateRestructureResponse } from '@/lib/restructure-gate'
import { track } from '@/lib/client-events'
// 提交结局 / AI 调用结局的取值域【一律来自 event-schema 这一份真源】，本 hook 不再手抄：
// 服务端 sanitize 对不认识的值是【静默丢弃】，打错一个字母就成了「埋了但库里查不到」，本地测不出来。
import type { CaptureOutcome, AiResult } from '@/lib/event-schema'

interface UseStorySubmitArgs {
  /** 待提交的故事文本 */
  text: string
  /** 雅思模式携带的题目 id（无则 null，跳转不带 &qid） */
  qid: string | null
  /**
   * 本次提交定局时回调结局（与上报 capture_submitted 同一时刻、同一个值）。
   * 存在的理由：/write 需要知道「用户是被放行了还是被打回了」才能判断他到底算不算离开采集态
   * （被打回时人还在页面上），而 submit() 内部才知道结局。纯通知，绝不参与任何分支/时序。
   */
  onOutcome?: (outcome: CaptureOutcome) => void
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
export function useStorySubmit({ text, qid, onOutcome }: UseStorySubmitArgs): UseStorySubmitReturn {
  // 用 useNav 而非 useRouter：跳 /restructure（会加载/AI 页）时点击当帧即亮顶部进度条，消除跳转白屏窗口
  const { navigate } = useNav()
  // 回调存 ref、不进 submit 的依赖：调用方多半传内联箭头函数，进依赖会让 submit 每次渲染都换新引用
  const onOutcomeRef = useRef(onOutcome)
  onOutcomeRef.current = onOutcome
  const [submitting, setSubmitting] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [quotaReached, setQuotaReached] = useState(false)

  const submit = useCallback((): void => {
    void (async (): Promise<void> => {
      // ——— 本次提交的埋点脚手架（全部 fire-and-forget，不参与任何分支判断、不改任何时序）———
      // charCount 只记【长度】，绝不带正文（隐私铁律）
      const charCount = text.trim().length
      let submitReported = false
      /** 本次提交的结局：每条执行路径【恰好】报一条，重复报会让「提交结局分布」重复计数 */
      const reportSubmit = (outcome: CaptureOutcome): void => {
        if (submitReported) return
        submitReported = true
        track('flow.capture_submitted', { mode: 'text', outcome, charCount })
        onOutcomeRef.current?.(outcome)
      }
      /** 整理调用的起始时刻；null = 请求还没发出（预检就退了）→ 不带 latencyMs */
      let t0: number | null = null
      const since = (): number | undefined => (t0 === null ? undefined : performance.now() - t0)
      let aiReported = false
      /** 整理这一次调用的结局：与 reportSubmit 同款「只报一条」—— 成功分支之后若再抛错落进 catch，不挡就把同一次调用记两遍 */
      const reportAi = (result: AiResult, httpStatus: number): void => {
        if (aiReported) return
        aiReported = true
        track('flow.ai_call', { stage: 'restructure', mode: 'text', result, httpStatus, latencyMs: since() })
      }

      // 第一层：即时预检，不调 API
      if (isGarbageInput(text)) {
        reportSubmit('garbage')
        setToastMsg(GARBAGE_TOAST_MSG)
        return
      }
      // 源头门槛（薄素材防线）：真实但有效字数不足 → 拦下、原文保留续写，引导补充维度（区别于上面的「不像经历」）
      if (isTooShortForCorpus(text)) {
        reportSubmit('text_too_short')
        setToastMsg(TOO_SHORT_TOAST_MSG)
        return
      }
      // 文字路径的流程起点：开启一次新 flow_id，串起 整理→建语料（经 X-Flow-Id 头透传，不进 URL）
      newFlowId()
      setSubmitting(true)
      const qidParam = qid ? `&qid=${qid}` : ''
      try {
        // 第二层：让 restructure 判断 usable
        t0 = performance.now()
        const res = await apiFetch('/api/restructure', {
          method: 'POST',
          json: { rawText: text },
        })
        // 分支判定收敛在 lib/restructure-gate（语音路径共用同一份，见该文件顶注）。
        // ai_call 在【每一条分支】上都排在 capture_submitted 之前，故可统一提到判定之后发一次。
        const gate = await evaluateRestructureResponse(res)
        reportAi(gate.ai, gate.httpStatus)
        switch (gate.action) {
          // 匿名整理额度用尽：不跳转，弹试用结束提示（避免带到 restructure 页再失败一次）
          case 'quota':
            reportSubmit('quota_blocked')
            setQuotaReached(true)
            return
          // 服务端同意闸拒绝（未捕获同意）：回首页触发同意弹窗，别把用户带到 restructure 页再 403 一次。
          case 'consent':
            reportSubmit('consent_blocked')
            navigate('/')
            return
          case 'garbage':
            reportSubmit('garbage')
            setToastMsg(GARBAGE_TOAST_MSG)
            return
          // 放行跳转。payload 非 null = 整理成功，把结果（含一句话概括 summary）一并带走，
          // restructure 页免二次整理调用、保存时写进 corpus.summary；
          // payload 为 null = 整理失败但仍放行，由 restructure 页兜底自行整理 —— AI 这一次是失败的、
          // 用户却确实进了下一页，故 ai_call 记失败码、capture_submitted 记 proceed，两者不矛盾。
          case 'proceed':
            reportSubmit('proceed')
            navigate(gate.payload
              ? `/restructure?h=${putHandoffJson({ rawText: text, cleanedText: gate.payload.cleanedText, summary: gate.payload.summary ?? '' })}${qidParam}`
              : `/restructure?h=${putHandoff(text)}${qidParam}`)
            return
        }
      } catch {
        // 网络失败：放行，restructure 页兜底（同上：调用失败但用户被放行，结局仍是 proceed）
        reportAi('network', 0)
        reportSubmit('proceed')
        navigate(`/restructure?h=${putHandoff(text)}${qidParam}`)
      } finally {
        setSubmitting(false)
      }
    })()
  }, [text, qid, navigate])

  const dismissToast = useCallback((): void => setToastMsg(null), [])
  const dismissQuota = useCallback((): void => setQuotaReached(false), [])

  return { submitting, toastMsg, quotaReached, submit, dismissToast, dismissQuota }
}
