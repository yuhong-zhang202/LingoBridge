/**
 * @module   useStorySubmit
 * @desc     故事「文字提交」共享 hook —— 从点「提交」到进入下一步的整条流程：
 *           isGarbageInput / isTooShortForCorpus 预检（不调 API）→ /api/restructure 查 usable →
 *           **直接建语料（整理结果随同一次请求原子落库）→ 故事流去 /matching、雅思流去 /analysis**。
 *           首页与 /write 复用同一份，唯一差异 qid 由入参决定（首页传 ieltsMode&&question?question.id:null，
 *           /write 传 ?qid）。
 *
 *   🔴【2026-08-27：文字路径不再经过 /restructure 整理确认页】依据是 51 条真实停留数据
 *   （flow.capture_submitted(proceed) → flow.corpus_bound 同 flow_id 配对，剔 QA 与内部账号，
 *   2026-07-28~08-26）：文字路径中位 13.4 秒、最长 55.7 秒、**超过 60 秒的 0 条**；
 *   语音路径中位 25.1 秒、**所有 6 条超过 60 秒的长停留全部在语音侧**。
 *   语音要校对 ASR 转写错字，文字是用户自己敲的、只是润色 —— 那一页对文字用户不值这一次点击。
 *   语音路径（useVoiceStorySubmit）**行为完全不变**，仍进整理页。雅思流同理【按输入方式分、不按流分】。
 *
 *   【整理页对文字路径从此只剩一个用途：失败兜底】restructure-gate 在非 402/403 的失败上是
 *   「放行但 payload=null」，此时客户端手里一个字的 cleanedText 都没有 —— 那条路一律回落
 *   `/restructure`（写死在代码里、不受输入方式规则影响），由整理页兜底重跑并给「重试」按钮。
 *   建语料本身失败（网络/5xx）同样回落那里，用户的故事不丢、可就地重试。
 *
 *   🔴【cleaned_text 必须和建语料同一次请求原子写】全仓写 cleaned_text 的地方原本只有整理页，
 *   跳过它又不补写，六个下游会同时哑掉（/api/matching 400、/api/analysis 静默降级成「通用分析」、
 *   教练 fallback、Anki 卡背、练习题目页空白卡）。**绝不能拆成「建语料 → 跳转 → 后台再补写」**：
 *   慢网下匹配页会先挂载并发出 /api/matching，撞 400，且这个 bug 本地永远测不出来。见 createCorpusServer 顶注。
 *
 *   注：语音路径的对称实现是 `hooks/useVoiceStorySubmit`。两者【对 /api/restructure 的分支判定
 *   已收敛到 `lib/restructure-gate` 这一份真源】，不再各写一份（分叉过一次、付过学费，见该文件顶注）；
 *   雅思流落库后的两件副作用（配对 + 自动存题卡）同样收敛在 `lib/ielts-corpus-binding` 一份。
 *
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { useState, useCallback, useRef } from 'react'
import { useNav } from '@/components/NavProgress'
import { isGarbageInput, isTooShortForCorpus, GARBAGE_TOAST_MSG, TOO_SHORT_TOAST_MSG } from '@/lib/utils'
import { putHandoff, putHandoffJson } from '@/lib/handoff'
import { newFlowId } from '@/lib/flow-id'
import { apiFetch, readQuotaReason } from '@/lib/api-client'
import { evaluateRestructureResponse, type RestructurePayload } from '@/lib/restructure-gate'
import { bindIeltsCorpus } from '@/lib/ielts-corpus-binding'
import { setFlowShape, clearFlowShape } from '@/lib/flow-shape'
import { track } from '@/lib/client-events'
// 提交结局 / AI 调用结局的取值域【一律来自 event-schema 这一份真源】，本 hook 不再手抄：
// 服务端 sanitize 对不认识的值是【静默丢弃】，打错一个字母就成了「埋了但库里查不到」，本地测不出来。
import type { CaptureOutcome, AiResult } from '@/lib/event-schema'

/** 额度覆盖层的变体（= QuotaReached 的 variant）：trial 匿名试用用尽 / story 注册用户故事月额度用尽 */
export type StoryQuotaVariant = 'trial' | 'story'

/**
 * 文字提交流程的外部依赖 —— 全部由 hook 注入，流程本体因此不依赖 React，可脱离渲染逐场景对拍
 * （与语音路径的 VoiceStorySubmitDeps 同款做法，理由见 useVoiceStorySubmit 顶注）。
 */
export interface StorySubmitDeps {
  /** 待提交的故事文本 */
  text: string
  /** 雅思模式携带的题目 id（无则 null） */
  qid: string | null
  /** 跳转（useNav 的 navigate） */
  navigate: (href: string) => void
  setSubmitting: (v: boolean) => void
  setToastMsg: (msg: string | null) => void
  /** 置额度覆盖层变体（null = 关闭） */
  setQuotaVariant: (v: StoryQuotaVariant | null) => void
  /** 本次提交定局时通知调用方（与上报 capture_submitted 同一时刻、同一个值），纯通知、不参与分支 */
  onOutcome?: (outcome: CaptureOutcome) => void
}

/**
 * 从 /api/corpus 的成功响应里取语料 id。
 * 单列成函数是为了【绝不抛】：这一步若抛进外层 catch，会在「语料其实已经建好」之后再跳一次
 * 兜底页，用户于是被引去重建第二条语料、白吃一次额度。
 * @param  res  /api/corpus 的 ok 响应
 * @returns     语料 id；响应体不合预期时 null（调用方据此走兜底页）
 */
async function readCorpusId(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { corpus?: { id?: unknown } }
    const id = body?.corpus?.id
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

/**
 * 文字提交流程本体（不依赖 React，供 hook 调用、也供回归测试直接驱动）。
 *
 * 🔴【三条坏了不会报错、只会让数据悄悄错的不变式，改这段前先读完】
 *   1. **每条执行路径恰好一条 capture_submitted**（reportSubmit 自去重；重复报会让「提交结局分布」重复计数）。
 *   2. **每次 /api/restructure 调用恰好一条 ai_call**，成功分支之后再抛错落进 catch 不许记第二遍。
 *   3. **newFlowId() 必须在发请求之前**：整理 → 建语料靠 X-Flow-Id 串成一条 flow，晚了就串到上一次流程上。
 *      （预检早退不发任何请求，故仍与改动前一样排在两层预检之后。）
 *
 * @param  deps  外部依赖，见 StorySubmitDeps
 * @returns      无（结局通过注入的 setter / navigate 反映到 UI）
 * @sideEffect   发 /api/restructure 与 /api/corpus、写 handoff / 链路形态标识、跳转、发埋点；
 *               雅思流还会做两件静默副作用（配对 + 自动存题卡，见 lib/ielts-corpus-binding）
 */
export async function runStorySubmit(deps: StorySubmitDeps): Promise<void> {
  const { text, qid, navigate, setSubmitting, setToastMsg, setQuotaVariant, onOutcome } = deps
  // ——— 本次提交的埋点脚手架（全部 fire-and-forget，不参与任何分支判断、不改任何时序）———
  // charCount 只记【长度】，绝不带正文（隐私铁律）
  const charCount = text.trim().length
  let submitReported = false
  /** 本次提交的结局：每条执行路径【恰好】报一条（不变式 1） */
  const reportSubmit = (outcome: CaptureOutcome): void => {
    if (submitReported) return
    submitReported = true
    track('flow.capture_submitted', { mode: 'text', outcome, charCount })
    onOutcome?.(outcome)
  }
  /** 整理调用的起始时刻；null = 请求还没发出（预检就退了）→ 不带 latencyMs */
  let t0: number | null = null
  const since = (): number | undefined => (t0 === null ? undefined : performance.now() - t0)
  let aiReported = false
  /** 整理这一次调用的结局：与 reportSubmit 同款「只报一条」（不变式 2） */
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

  /**
   * 文字路径的【唯一兜底出口】：回整理确认页。两种触发（整理失败放行 / 建语料失败），
   * 用户的故事一字不丢，在那一页可重跑整理、再点一次「开始分析」重试落库。
   * · `&mode=text` 不能省：整理页据此把新建语料的 source 记成 text —— 少了它，从 /write 敲的
   *   文字故事会在素材库里挂着麦克风图标（改动前所有文字故事都是这样，见 restructure/page.tsx）。
   * · 形态标识【清掉而不是写 text】：这条路上的用户确实经过了整理页，写 text 会让后续页面
   *   少显示一个他真走过的步骤。清掉 → 降级回现状 5 步，对他成立。
   */
  const fallbackToRestructure = (payload: RestructurePayload | null): void => {
    clearFlowShape()
    reportSubmit('proceed')
    navigate(payload
      ? `/restructure?h=${putHandoffJson({ rawText: text, cleanedText: payload.cleanedText, summary: payload.summary ?? '' })}&mode=text${qidParam}`
      : `/restructure?h=${putHandoff(text)}&mode=text${qidParam}`)
  }

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
      // 匿名整理额度用尽：不跳转，弹试用结束提示（/api/restructure 的 402 是匿名 only、不带 reason → trial）
      case 'quota':
        reportSubmit('quota_blocked')
        setQuotaVariant('trial')
        return
      // 服务端同意闸拒绝（未捕获同意）：回首页触发同意弹窗，别把用户带到下一页再 403 一次。
      case 'consent':
        reportSubmit('consent_blocked')
        navigate('/')
        return
      case 'garbage':
        reportSubmit('garbage')
        setToastMsg(GARBAGE_TOAST_MSG)
        return
      case 'proceed': {
        // 整理失败但放行（payload 为 null）：手里没有 cleanedText，**一律回落整理页**（阻塞 2）。
        // 「失败但放行」不是失败：ai_call 记失败码、capture_submitted 记 proceed，两者不矛盾。
        if (!gate.payload) { fallbackToRestructure(null); return }
        // 建语料 + 整理结果原子落库（见顶注 🔴）。source 显式传 'text'，不再由整理页写死 'voice'。
        const created = await apiFetch('/api/corpus', {
          method: 'POST',
          json: {
            source: 'text',
            rawText: text,
            cleanedText: gate.payload.cleanedText,
            summary: gate.payload.summary ?? '',
          },
        })
        // 建语料 402：reason 决定变体 —— 匿名总条数闸 trial（注册引导）/ 注册月额度闸 story（月额度用完）。
        // 两个入口（首页文本面板 / /write）都在点提交前过了 useStoryQuotaGuard，走到这里只可能是竞态，
        // 但变体不能因此凑合：对注册用户显示「试用已完成，请注册后继续」是句谎话。
        if (created.status === 402) {
          reportSubmit('quota_blocked')
          const reason = await readQuotaReason(created)
          setQuotaVariant(reason === 'story' ? 'story' : 'trial')
          return
        }
        // 服务端同意闸拒绝（403，未捕获同意）：回首页触发同意弹窗
        if (created.status === 403) {
          reportSubmit('consent_blocked')
          navigate('/')
          return
        }
        if (!created.ok) { fallbackToRestructure(gate.payload); return }
        const storyId = await readCorpusId(created)
        if (!storyId) { fallbackToRestructure(gate.payload); return }
        // 步骤条形态标识：只喂步骤条，不参与任何业务分支（见 lib/flow-shape 顶注）
        setFlowShape({ mode: 'text', flow: qid ? 'ielts' : 'story' })
        reportSubmit('proceed')
        if (qid) {
          // 雅思流落库即自动绑定（配对 + 存题卡）—— 台账 179 的修复本体，两条路径共用同一份，
          // 任何结局都不出声、不阻断跳转（冲突推迟到分析页点「开始练习」时再问）。见 lib/ielts-corpus-binding。
          await bindIeltsCorpus(qid, storyId)
          // from=restructure 保持原样：分析页据此把「返回」指回语料编辑页（那是全站唯一能改「我讲的那段」的页面）
          navigate(`/analysis?questionId=${qid}&storyId=${storyId}&from=restructure`)
        } else {
          navigate(`/matching?corpusId=${storyId}`)
        }
        return
      }
    }
  } catch {
    // 网络失败：放行，回整理页兜底（同上：调用失败但用户被放行，结局仍是 proceed）。
    // reportAi 自去重 —— 整理已成功、后续步骤才抛错时不会被再记一次凭空的网络故障。
    reportAi('network', 0)
    fallbackToRestructure(null)
  } finally {
    setSubmitting(false)
  }
}

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
  /**
   * 额度覆盖层变体：'trial' 匿名试用用尽（引导注册）/ 'story' 注册用户故事月额度用尽 / null 不弹。
   * 两个来源：/api/restructure 402（匿名 only → trial）与 /api/corpus 402（reason 决定）。
   */
  quotaVariant: StoryQuotaVariant | null
  /** 触发提交（幂等语义与原 handleTextSubmit 一致） */
  submit: () => void
  dismissToast: () => void
  dismissQuota: () => void
}

/**
 * 故事文字提交 hook。
 * @param  args  { text, qid, onOutcome }
 * @returns      { submitting, toastMsg, quotaVariant, submit, dismissToast, dismissQuota }
 */
export function useStorySubmit({ text, qid, onOutcome }: UseStorySubmitArgs): UseStorySubmitReturn {
  // 用 useNav 而非 useRouter：跳下一页（会加载/AI 页）时点击当帧即亮顶部进度条，消除跳转白屏窗口
  const { navigate } = useNav()
  // 入参存 ref、不进 submit 的依赖：调用方多半传内联箭头函数，进依赖会让 submit 每次渲染都换新引用
  const argsRef = useRef({ text, qid, onOutcome })
  argsRef.current = { text, qid, onOutcome }
  const [submitting, setSubmitting] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [quotaVariant, setQuotaVariant] = useState<StoryQuotaVariant | null>(null)

  const submit = useCallback((): void => {
    const a = argsRef.current
    void runStorySubmit({
      text: a.text,
      qid: a.qid,
      onOutcome: a.onOutcome,
      navigate,
      setSubmitting,
      setToastMsg,
      setQuotaVariant,
    })
  }, [navigate])

  const dismissToast = useCallback((): void => setToastMsg(null), [])
  const dismissQuota = useCallback((): void => setQuotaVariant(null), [])

  return { submitting, toastMsg, quotaVariant, submit, dismissToast, dismissQuota }
}
