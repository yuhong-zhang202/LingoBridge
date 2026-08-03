/**
 * @module   usePolish
 * @desc     练习页「换个说法」(polish) 这一块的完整状态机 —— 弹窗三态（showPolish / polishLoading /
 *           polishResult）、本场优化历史（polishHistory，结束时写进 sessionPolishes）、调用
 *           /api/practice/polish 的全部结局分流、失败态「再试一次」的原样重发。原本整块内联在
 *           practice/page.tsx（那页还同时装着转写重试状态机 / 发音收藏 / 会话记录三块无关的东西）。
 *
 *   【为什么必须整块搬、且一个字都不许改】这块的分流表是三轮生产实测调出来的，语义都在细节里：
 *   - 400 / 401 属【确定性失败】（同一份输入重发必然再撞同一个错），故 **return 而非 throw**：
 *     throw 会落进统一 catch、被一律标成 `retryable: true`，用户点「再试一次」只会永远转圈。
 *     400 还必须透出服务端 body.error 的真实原因（如「句子过长」），显示「网络不太稳」会误导用户反复重试；
 *     401 反过来只给中性文案，绝不回显服务端原文（可能含鉴权细节）。
 *   - 429（当日额度已满）同样不给 retryable —— 给「再试一次」等于骗用户。
 *   - 5xx / 真·网络 reject 才是瞬时故障，保留 retryable。
 *   - lastPolishArgsRef 存的是 applyPronunciationFixes **处理后**的串：重试要逐字重发同一次请求。
 *   - 每次调用【恰好一条 ai_call】：reportAi 在本次调用内自去重（否则非 2xx 会被 catch 再记一遍）。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
'use client'
import { useCallback, useRef, useState, type RefObject } from 'react'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { apiFetch } from '@/lib/api-client'
import { track } from '@/lib/client-events'
// 优化（polish）调用结局的取值域【来自 event-schema 这一份真源】，本文件不再手抄：
// 服务端 sanitize 对不认识的值是【静默丢弃】，打错一个字母就成了「埋了但库里查不到」，本地测不出来。
import type { AiResult } from '@/lib/event-schema'
import type { PracticeScaffold, PolishResult, SessionPolish } from '@/lib/types'

interface UsePolishArgs {
  /** 目标分档，随请求体发给服务端（练习页的 ?level=，缺省 '6.0'） */
  level: string
  /** 当前脚手架：只用于给 polishHistory 补 part / questionEn 两个归档字段 */
  scaffold: PracticeScaffold | null
  /** 优化弹窗根容器（tabIndex=-1）：重试时按钮会随 loading 分支被卸载，先把焦点收回来，读屏用户不掉线 */
  popupRef: RefObject<HTMLDivElement | null>
  /** 402＝匿名试用次数用尽：hook 只负责关弹窗，弹哪种额度覆盖层由调用方决定（练习页 → trial） */
  onTrialQuota: () => void
  /** 403＝服务端同意闸拒绝：由调用方决定去向（练习页 → 回首页触发同意弹窗） */
  onConsentDenied: () => void
}

interface UsePolishReturn {
  /** 优化弹窗是否展开 */
  showPolish: boolean
  /** 本次优化调用进行中（弹窗内显示「优化中…」） */
  polishLoading: boolean
  /** 最近一次优化结果；失败态也走这里（failed / retryable 标记） */
  polishResult: PolishResult | null
  /** 本场练习产出的优化条目，结束时写进 sessionPolishes 供反馈页读 */
  polishHistory: SessionPolish[]
  /** 发起一次优化（已包 useAsyncAction 防重入，两个入口共用同一 ref 守卫） */
  runPolish: (sentence: string, aiQuestion?: string) => Promise<void>
  /** 失败态「再试一次」：用上次同一组参数原地重发 */
  retryPolish: () => void
  /** 重新展开上一次的优化结果（无结果时不开） */
  reopenPolish: () => void
  /** 关闭优化弹窗（点弹窗外 / 点关闭都走它） */
  closePolish: () => void
}

/**
 * 练习页优化（换个说法）状态机。
 * @param  args  { level, scaffold, popupRef, onTrialQuota, onConsentDenied }
 * @returns      弹窗三态 + polishHistory + runPolish / retryPolish / reopenPolish / closePolish
 * @sideEffect   调用 /api/practice/polish；每次调用报恰好一条 flow.ai_call(stage='polish')；
 *               402 时调 onTrialQuota、403 时调 onConsentDenied（本 hook 自身不做跳转）
 */
export function usePolish({ level, scaffold, popupRef, onTrialQuota, onConsentDenied }: UsePolishArgs): UsePolishReturn {
  const [showPolish, setShowPolish]       = useState(false)
  const [polishLoading, setPolishLoading] = useState(false)
  const [polishResult, setPolishResult]   = useState<PolishResult | null>(null)
  const [polishHistory, setPolishHistory] = useState<SessionPolish[]>([])
  // 上次优化请求的入参，供失败态「再试一次」原样重发（详见 handlePolish 首行注释）
  const lastPolishArgsRef = useRef<[string, string | undefined] | null>(null)

  const handlePolish = useCallback(async (sentence: string, aiQuestion?: string) => {
    // 失败态「再试一次」要逐字重发同一次请求：sentence 已是 applyPronunciationFixes 处理过的串，
    // 存这个（而非原始气泡文本）才能复现同一次调用。用 ref 不用 state —— 只在重试时读一次，进 state 会触发无谓重渲。
    lastPolishArgsRef.current = [sentence, aiQuestion]
    setShowPolish(true)
    setPolishResult(null)
    setPolishLoading(true)
    // ——— 本次优化调用的埋点（fire-and-forget，不参与任何分支判断、不改任何时序）———
    // 失败态「再试一次」会再走一遍本函数、自然再报一条 —— 用户视角确实是两次尝试，不去重。
    const t0 = performance.now()
    let aiReported = false
    /** 这一次调用只报一条：!res.ok 抛出的错会被下面的 catch 再兜一次，不挡就把同一次调用记两遍 */
    const reportAi = (result: AiResult, httpStatus: number): void => {
      if (aiReported) return
      aiReported = true
      track('flow.ai_call', { stage: 'polish', result, httpStatus, latencyMs: performance.now() - t0 })
    }
    try {
      const res = await apiFetch('/api/practice/polish', {
        method: 'POST',
        json: { sentence, aiQuestion, level },
      })
      // 服务端同意闸拒绝（403）：回首页触发同意弹窗，不停在优化失败态。
      if (res.status === 403) { reportAi('consent_403', 403); onConsentDenied(); return }
      // 额度类拦截，区分对待、不再一律「优化失败」误导用户：
      //   402＝匿名试用次数用尽（polish 402 仅对匿名返回）→ 关弹窗、弹既有额度覆盖层引导注册；
      //   429＝注册用户当日达上限 → 在优化气泡内诚实说明真实原因，可明天再来。
      if (res.status === 402) { reportAi('quota_402', 402); setShowPolish(false); onTrialQuota(); return }
      if (res.status === 429) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        reportAi('rate_429', 429)
        // 不设 retryable：当日额度已用尽，重试必然再撞 429，给「再试一次」等于骗用户。
        setPolishResult({ needsWork: false, optimized: '', note: body?.error ?? '今日优化次数已达上限，请明天再试', failed: true })
        return
      }
      // ——— 确定性失败（400/401）与瞬时失败（5xx/网络）分家 ———
      // 这两类【不能 throw 进 catch】：catch 一律给 retryable:true，而同一份输入重发必然再撞同一个 400，
      // 用户点「再试一次」只会永远转圈（生产实测：练习页传给 polish 的是整条气泡、无截断，
      // 转写文本 p90=620 字符、14.7% 超 500 → 长回答点「换个说法」必吃 400）。与 429 同档处理。
      if (res.status === 400) {
        // 400 要透出服务端的真实原因（如「句子过长，请精简后再试」），显示「网络不太稳」是误导：
        // 用户会以为是信号问题、反复重试，而真正该做的是把这句说短一点。
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        reportAi('bad_input_400', 400)
        setPolishResult({ needsWork: false, optimized: '', note: body?.error ?? '这句暂时没法优化，换句短一点的试试', failed: true })
        return
      }
      if (res.status === 401) {
        // 401 = 会话失效（重试同样会 401）。只给中性文案，绝不回显服务端原始错误（可能含鉴权细节）。
        reportAi('auth_401', 401)
        setPolishResult({ needsWork: false, optimized: '', note: '登录状态已失效，请重新登录后再试', failed: true })
        return
      }
      if (!res.ok) {
        // 5xx / 其余未知状态：属瞬时故障，保留「再试一次」（与 catch 的网络分支同档）
        reportAi(res.status >= 500 ? 'server_5xx' : 'other', res.status)
        setPolishResult({ needsWork: false, optimized: '', note: '网络不太稳，请再试一次', failed: true, retryable: true })
        return
      }
      const data = (await res.json()) as PolishResult
      reportAi('ok', 200)
      setPolishResult(data)
      if (data.needsWork && data.optimized) {
        setPolishHistory(h => [...h, {
          original: sentence,
          optimized: data.optimized,
          note: data.note,
          part: scaffold?.part ?? 1,
          questionEn: scaffold?.displayEn ?? '',
        }])
      }
    } catch {
      // 到此只剩【真·网络 reject】：非 2xx 一律在上面按状态码分流后 return，不再 throw 进这里
      // （否则确定性的 400/401 会被误标成 network、并拿到不该给的「再试一次」）。
      // 诊断官+latency 取证：生产超时 0 次，故不加重试、不动 maxAttempts，只把兜底文案改诚实、不吓人。
      reportAi('network', 0)
      setPolishResult({ needsWork: false, optimized: '', note: '网络不太稳，请再试一次', failed: true, retryable: true })
    } finally {
      setPolishLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 优化按当前 level 取值即可；level 变更由独立分支处理，列入依赖会无谓重建回调
  }, [scaffold, onConsentDenied, onTrialQuota])
  // A6 防重入：优化共用一个弹窗，单 ref 守卫 —— 进行中再点优化不会重复发 AI 调用 / 重复写历史
  const [runPolish] = useAsyncAction(handlePolish)

  /** 优化失败态「再试一次」：用上次同一组参数原地重发（弹窗不关，自动切回「优化中…」）。 */
  const retryPolish = useCallback(() => {
    const args = lastPolishArgsRef.current
    if (!args) return
    // 按钮会随 loading 分支被卸载、焦点掉回 body；先把焦点收到弹窗根容器（tabIndex=-1），读屏用户不掉线
    popupRef.current?.focus()
    // 必须走 runPolish（useAsyncAction 包装）而非裸 handlePolish —— 防重入靠它的单 ref 守卫
    void runPolish(...args)
  }, [runPolish, popupRef])

  const reopenPolish = useCallback(() => { if (polishResult) setShowPolish(true) }, [polishResult])
  const closePolish = useCallback(() => setShowPolish(false), [])

  return { showPolish, polishLoading, polishResult, polishHistory, runPolish, retryPolish, reopenPolish, closePolish }
}
