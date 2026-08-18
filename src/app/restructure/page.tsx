/**
 * @module   RestructurePage
 * @desc     AI 整理确认页外壳 —— 集中持有语料整理逻辑（AI 整理/编辑/重整/保存跳转），
 *           按 lg 断点分发移动/桌面两套视图。逻辑单实例，两视图仅接收状态与回调做展示。
 * @author   LingoBridge
 * @created  2026-05-28
 */
'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { takeHandoff, takeHandoffJson } from '@/lib/handoff'
import { updateCorpusCleaned, getCorpusById } from '@/lib/db/corpus'
import { upsertMatch } from '@/lib/db/matches'
import { apiFetch, readQuotaReason } from '@/lib/api-client'
import { track } from '@/lib/client-events'
// 整理调用结局的取值域【来自 event-schema 这一份真源】，本页不手抄：
// 服务端 sanitize 对不认识的值是【静默丢弃】，打错一个字母就成了「埋了但库里查不到」，本地测不出来。
import type { AiResult } from '@/lib/event-schema'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useNav } from '@/components/NavProgress'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import Toast from '@/components/Toast'
import AnkiRegisterGate from '@/components/anki/AnkiRegisterGate'
import SwapCorpusDialog from '@/components/anki/SwapCorpusDialog'
import { saveAnkiPair, swapAnkiCorpusClient, autoPairOutcome, type CorpusBrief } from '@/lib/anki/cards-client'
import RestructureMobile from './RestructureMobile'
import RestructureDesktop from './RestructureDesktop'
import ConfirmDialog from '@/components/ConfirmDialog'
import GradientButton from '@/components/GradientButton'
import type { RestructureViewProps } from './types'

/** 结构化 handoff 形状：预检整理结果 { rawText, cleanedText, summary? }。summary 为可选（旧 handoff 无此键）。 */
interface StructuredHandoff { rawText: string; cleanedText: string; summary?: string }
function isStructuredHandoff(v: unknown): v is StructuredHandoff {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.rawText === 'string'
    && typeof o.cleanedText === 'string'
    && (o.summary === undefined || typeof o.summary === 'string')
}

function RestructureContent() {
  const router   = useRouter()
  const { navigate } = useNav()
  const params   = useSearchParams()
  const qid      = params.get('qid')
  // corpusId 存在 = 返回态（从 matching / analysis「返回上一步」进来）：忽略 handoff，改从 DB 水合真实语料。
  // 无 corpusId = 首程：故事正文（及可选预检整理结果）从 sessionStorage 一次性取（取完即删），URL 仅含短 id。
  const corpusId = params.get('corpusId')
  // 首程 handoff（仅无 corpusId 时读取；返回态置 null 不消费 sessionStorage）：
  // 新版结构化 handoff 携 { rawText, cleanedText }：直接进已整理态、跳过首次整理调用；
  // 旧版纯字符串 handoff（网络/非 402 错误兜底）仍原样读出，走自行整理。再无则退 URL 的 rawText。
  // 三者皆无（典型场景：handoff 取一次即删，用户在 /restructure?h=xxx 上刷新）→ null：
  // 语料确实没了，交由 loadError 明确报错，不得拿示例故事冒充「你的语料」。
  const [handoff] = useState<{ rawStory: string; cleanedText: string | null; summary: string | null } | null>(() => {
    if (corpusId) return null   // 返回态：不读 handoff，等下方 effect 从 DB 水合
    const h = params.get('h')
    if (h) {
      const j = takeHandoffJson(h, isStructuredHandoff)
      if (j) return { rawStory: j.rawText, cleanedText: j.cleanedText, summary: j.summary ?? null }
      const s = takeHandoff(h)   // 未通过校验时未消费，此处原样读出旧版纯文本
      if (s !== null) return { rawStory: s, cleanedText: null, summary: null }
    }
    const rawText = params.get('rawText')
    if (rawText !== null) return { rawStory: rawText, cleanedText: null, summary: null }
    return null
  })
  // rawStory 现为 state：返回态由 getCorpusById 异步水合；首程同步取自 handoff。
  const [rawStory,   setRawStory]   = useState(handoff?.rawStory ?? '')
  // 返回态先进加载态（等 DB 水合）；首程沿用 handoff 是否已带整理结果。
  const [isLoading,  setIsLoading]  = useState(corpusId ? true : handoff?.cleanedText == null)
  const [aiText,     setAiText]     = useState(handoff?.cleanedText ?? '')
  // AI 产出的原始整理文本基准；aiText 与它不一致 = 用户编辑过（未保存）
  const [aiBaseline, setAiBaseline] = useState(handoff?.cleanedText ?? '')
  // 一句话概括（整理时同源产出）：随整理结果一并从 handoff/API 带入，保存时写进 corpus.summary。
  // 用户不可编辑概括、编辑正文也不重算它（用户改的是正文措辞，核心「讲的啥」不变）。null = 本轮未产出概括（旧兜底路径），保存时不写 summary 列。
  const [summary,    setSummary]    = useState<string | null>(handoff?.summary ?? null)
  const [isEditing, setIsEditing] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [usable,    setUsable]    = useState<boolean | null>(handoff?.cleanedText != null ? true : null)
  // 语料取不回时的明确错误态 + 回首页出口，禁止用示例故事把「语料没了」伪装成陌生语料。两种来源：
  // 返回态 corpusId 水合失败 / 语料为 null（下方 effect 置位）；首程 handoff 与 rawText 皆无（此处初始化）。
  const [loadError, setLoadError] = useState(!corpusId && handoff === null)
  // 首次 AI 整理待办：首程有语料但无整理结果即待办；返回态由水合按 cleanedText 是否为空决定。
  // 首程语料缺失（handoff 为 null）置 false：此时 rawStory 为空串，不能拿空文本去调整理接口。
  const [pendingRestructure, setPendingRestructure] = useState(!corpusId && handoff !== null && handoff.cleanedText == null)
  const [isSaving,  setIsSaving]  = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // 服务端额度超限（/api/corpus 或 /api/restructure 返回 402）→ 弹 QuotaReached 覆盖层。
  // 变体由服务端 402 的 reason 决定（trial=匿名试用 / story=注册月额度），不再靠异步 isAnon 竞态推导——
  // 竞态会让匿名用户误显示注册的「本月额度已用完」谎报。/api/restructure 402 是匿名 only、不带 reason，
  // readQuotaReason 返回 null，此处默认 'trial'，语义正确。
  const [storyQuota, setStoryQuota] = useState<'trial' | 'story' | null>(null)
  // ── 存对子（雅思模式，qid 非空时可用）——
  // ensuredStoryId：ensureCorpusSaved 首次落库拿到的 storyId 缓存，令「存对子」与「开始分析」复用同一条
  // 语料、不重复建库/多耗额度（点存即落库该语料，占 1 条语料额度是拍板 A 已接受的语义）。
  const [ensuredStoryId, setEnsuredStoryId] = useState<string | null>(null)
  const [ankiSaveState, setAnkiSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [ankiGate, setAnkiGate] = useState(false)
  const [ankiToast, setAnkiToast] = useState<string | null>(null)
  const [ankiSwap, setAnkiSwap] = useState<{ current: CorpusBrief; newStoryId: string } | null>(null)
  const [ankiSwapping, setAnkiSwapping] = useState(false)

  const runRestructure = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setIsEditing(false)
    setError(null)
    setUsable(null)
    // ——— 本次整理调用的埋点（fire-and-forget，不参与任何分支判断、不改任何时序）———
    // 【补的是横向可比性】同一个 /api/restructure 有三条客户端调用路径（录音页预检、写作页 useStorySubmit、
    // 本页），另两条早已埋点，本页原先无痕 —— 失败率横向比时本页恒为 0，看着像「整理页最可靠」，实为没记。
    // 「重新整理 / 重试」按钮会再走一遍本函数、自然再报一条：那确实是用户视角的又一次尝试，故不跨次去重。
    let t0: number | null = null
    let reported = false
    /**
     * 整理这一次调用的结局：只报一条，且【只在请求真发出过（t0 已置位）之后】才报。
     * 两个条件缺一不可：不挡重复，!res.ok 抛出的错会被下面的 catch 再记一遍同一次调用；
     * 不挡 t0，请求发出前就抛的错（如构造阶段异常）会被记成 network，等于凭空造一次没发生的调用。
     * mode 不带：本页语料既可能来自语音（录音页 handoff）也可能来自文字（写作页 handoff）或返回态水合，
     * 到了这里来源信息已丢失，硬填一个会污染 restructure 阶段按 mode 的分组。
     */
    const reportAi = (result: AiResult, httpStatus: number): void => {
      if (reported || t0 === null) return
      reported = true
      track('flow.ai_call', { stage: 'restructure', result, httpStatus, latencyMs: performance.now() - t0 })
    }
    try {
      t0 = performance.now()
      const res = await apiFetch('/api/restructure', {
        method: 'POST',
        json: { rawText: rawStory },
        signal,
      })
      // 匿名整理次数超上限（402）：弹试用结束提示，不当作「整理失败」。
      // /api/restructure 402 匿名 only、不带 reason → readQuotaReason 返回 null → 走 trial（引导注册）。
      // 【服务端不记账】402/403/429/400 都在 logApiUsage 之前裸 return，成本看板看不见 —— 只有这条埋点能看见。
      if (res.status === 402) {
        reportAi('quota_402', 402)
        const reason = await readQuotaReason(res)
        if (!signal?.aborted) setStoryQuota(reason === 'story' ? 'story' : 'trial')
        return
      }
      // 服务端同意闸拒绝（403，未捕获同意）：深链直达本页时兜底，回首页触发同意弹窗，不卡在「整理失败」。
      if (res.status === 403) { reportAi('consent_403', 403); if (!signal?.aborted) router.push('/'); return }
      // 在 throw 之前报：进了 catch 就只剩「网络失败」一种说法，400/429/500 会被记成凭空的网络故障
      if (!res.ok) {
        reportAi(
          res.status === 429
            ? 'rate_429'
            : res.status === 400
              ? 'bad_input_400'
              : res.status === 401
                ? 'auth_401'
                : res.status >= 500 ? 'server_5xx' : 'other',
          res.status,
        )
        throw new Error('整理失败')
      }
      const data = (await res.json()) as { cleanedText: string; usable: boolean; summary?: string }
      reportAi('ok', 200)   // 调用本身成功了；下一行的「已中断」只影响是否落 state，不改这次调用的结局
      if (signal?.aborted) return
      setAiText(data.cleanedText)
      setAiBaseline(data.cleanedText)
      setUsable(data.usable ?? true)
      setSummary(typeof data.summary === 'string' ? data.summary : null)
    } catch (e) {
      // 中断不算错误，忽略；ai_call 记 aborted（不计失败）。已报结局的（如 ok 后才中断）被自去重挡住。
      if (signal?.aborted) { reportAi('aborted', 0); return }
      // 到此只剩真·网络 reject（与响应体解析失败）：非 2xx 已在上面按状态码分流报过、被自去重挡住
      reportAi('network', 0)
      setError(e instanceof Error ? e.message : '整理失败，请重试')
    } finally {
      if (!signal?.aborted) setIsLoading(false)
    }
  }, [rawStory, router])

  // 返回态：从 DB 水合真实语料。cleanedText 非空 → 直接进「已整理态」、跳过首次 AI 整理；
  // 为 null/空（极少见的未整理草稿）→ 触发一次 AI 整理；取回失败/为 null → loadError（回首页出口）。
  useEffect(() => {
    if (!corpusId) return
    let cancelled = false
    ;(async () => {
      try {
        const corpus = await getCorpusById(corpusId)
        if (cancelled) return
        if (!corpus) { setLoadError(true); return }
        setRawStory(corpus.rawText)
        const cleaned = corpus.cleanedText
        if (cleaned && cleaned.trim()) {
          setAiText(cleaned)
          setAiBaseline(cleaned)
          setUsable(true)
          setIsLoading(false)
        } else {
          setPendingRestructure(true)   // rawStory 已就绪，交由下方 effect 跑首次整理
        }
      } catch {
        if (!cancelled) setLoadError(true)
      }
    })()
    return () => { cancelled = true }
  }, [corpusId])

  useEffect(() => {
    if (!pendingRestructure) return   // 无待办（返回态已带整理结果）跳过首次 API 调用
    const ac = new AbortController()
    void runRestructure(ac.signal)
    return () => ac.abort()
  }, [runRestructure, pendingRestructure])
  // A13 防重入：「重新整理」「重试」两个按钮共用一个 ref 守卫，连点只发一次 AI 整理
  const [reRestructure] = useAsyncAction(runRestructure)

  // 落库当前语料并返回 storyId（「开始分析/匹配」与「存对子」共用）：
  //   corpus 幂等——返回态（corpusId 从 URL 水合）或本会话已 ensure 过 → 复用同一条、不重复建库；
  //   首程无 → 服务端创建（配额 + 落库防绕过）并缓存 id。再更新整理结果（写 cleaned/summary）。
  //   配额 402 / 同意 403 由本函数内处理副作用并返回 null，调用方据 null 静默收尾（不再往下走）。
  const ensureCorpusSaved = useCallback(async (): Promise<string | null> => {
    let storyId = corpusId ?? ensuredStoryId
    if (!storyId) {
      const res = await apiFetch('/api/corpus', {
        method: 'POST',
        json: { source: 'voice', rawText: rawStory },
      })
      // 建语料 402：reason 决定变体——匿名总条数闸 trial（注册引导）/ 注册月额度闸 story（月额度用完）。
      if (res.status === 402) {
        const reason = await readQuotaReason(res)
        setStoryQuota(reason === 'story' ? 'story' : 'trial')
        return null
      }
      // 服务端同意闸拒绝（403，未捕获同意）：回首页触发同意弹窗，不停在「语料保存失败」错误态。
      if (res.status === 403) { router.push('/'); return null }
      if (!res.ok) throw new Error('语料保存失败，请重试')
      const { corpus } = (await res.json()) as { corpus: { id: string } }
      storyId = corpus.id
      setEnsuredStoryId(storyId)
    }
    // summary 非空才随本次保存写入；null（旧兜底路径/返回态未重算）→ 不传，不覆盖 DB 已有概括。
    await updateCorpusCleaned(storyId, aiText, summary ?? undefined)
    return storyId
  }, [corpusId, ensuredStoryId, rawStory, aiText, summary, router])

  const handleMatchClick = useCallback(async (): Promise<void> => {
    setIsSaving(true)
    setSaveError(null)
    try {
      const storyId = await ensureCorpusSaved()
      if (!storyId) { setIsSaving(false); return }   // 402/403 已在 ensureCorpusSaved 内处理副作用
      // navigate（非 router.push）：保存完成到目标页（分析/匹配均为 AI 环节、非瞬时）跳转期间亮顶部条，
      // 与按钮「保存中…」spinner 接力，全程有反馈。
      if (qid) {
        // 记录「已选」配对，让答过的语料出现在该题「练习题目」页；写库失败不阻断跳转（upsertMatch 本幂等）
        await upsertMatch(storyId, qid, 'chosen').catch((e) => console.error('[restructure] upsertMatch failed', e))
        // 【2026-08-18 产品方拍板】雅思流落库即自动存对子，不再要求用户先点书签。
        // 理由：这段语料【就是为回答这道题说的】，它天然就是一个对子；此前要用户手动点，
        // 结果 47/49 条雅思流语料在素材库里被显示成「还没绑题目」+ 一个「去匹配题目」按钮
        // （素材库的 bound 判据数的是 Anki 卡、不是 corpus_question_matches），
        // 于是用户会对一条本来就有题的语料再跑一整条 AI 匹配 —— 实测 3 条这么干了，
        // 其中 2 条还混进了「匹配失败」的分析样本里当供给缺口的证据。
        //
        // ⚠️ 【任何结局都不在这一页出声、不阻断跳转】——包括「这道题你之前用别的语料存过卡」这种冲突。
        //   用户点的是「开始分析」，脑子里想的是「我要分析这段话」；他没在想 Anki 卡。
        //   在这里弹一个换语料对比框，正是本改动想消灭的那种"拿我们的便利去打断他的正事"。
        //   ⇒ 冲突【推迟到分析页点「开始练习」时再问】（产品方 2026-08-18 定）：
        //     那一步才和「这张卡的背面是哪段语料」真正相关，问得着调。见 analysis/page.tsx 的 onStartPractice。
        //   ⇒ 那边会重发一次 saveAnkiPair 拿到同样的 409；本页这次失败不留任何状态，无需跨页传递。
        const pair = await saveAnkiPair(qid, storyId).catch(() => null)
        if (autoPairOutcome(pair) === 'saved') setAnkiSaveState('saved')
        navigate(`/analysis?questionId=${qid}&storyId=${storyId}&from=restructure`)   // 雅思流：跳过匹配，直达分析
      } else {
        navigate(`/matching?corpusId=${storyId}`)                    // 故事流：照旧去匹配
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '语料保存失败，请重试')
      setIsSaving(false)
    }
  }, [ensureCorpusSaved, qid, navigate])

  // 存对子（雅思模式）：点书签 → 先静默 ensureCorpusSaved 落库拿 storyId → POST /anki/cards。
  // 200 已存 / 401 弹注册引导 / 409 弹换语料弹窗（新语料 = 刚 ensure 的这条）/ 429·失败 toast。
  const handleSaveAnki = useCallback(async (): Promise<void> => {
    if (!qid || ankiSaveState !== 'idle') return
    setAnkiSaveState('saving')
    try {
      const storyId = await ensureCorpusSaved()
      if (!storyId) { setAnkiSaveState('idle'); return }   // 落库撞 402/403：额度层/同意层已接管
      const r = await saveAnkiPair(qid, storyId)
      if (r.ok) { setAnkiSaveState('saved'); return }
      if (r.kind === 'anon') { setAnkiSaveState('idle'); setAnkiGate(true); return }
      if (r.kind === 'bound') { setAnkiSaveState('idle'); setAnkiSwap({ current: r.currentCorpus, newStoryId: storyId }); return }
      if (r.kind === 'limit') { setAnkiSaveState('idle'); setAnkiToast('今天存的题卡有点多，明天再来'); return }
      setAnkiSaveState('idle'); setAnkiToast('没存上，再试一次')
    } catch {
      setAnkiSaveState('idle'); setAnkiToast('没存上，再试一次')
    }
  }, [qid, ankiSaveState, ensureCorpusSaved])

  // 换语料确认：PUT 成功 → 标已存 + 成功 toast；失败 → 通用 toast。
  const handleConfirmSwapAnki = useCallback(async (): Promise<void> => {
    if (!qid || !ankiSwap) return
    setAnkiSwapping(true)
    const ok = await swapAnkiCorpusClient(qid, ankiSwap.newStoryId)
    setAnkiSwapping(false)
    setAnkiSwap(null)
    if (ok) { setAnkiSaveState('saved'); setAnkiToast('已换成新语料，正在重新生成') }
    else setAnkiToast('没换成，再试一次')
  }, [qid, ankiSwap])

  // 未保存 = 用户编辑过整理后文本；「重新整理」会覆盖这些改动，故仅该动作按 hasUnsaved 决定是否先确认。
  const hasUnsaved = aiText !== aiBaseline
  const [confirm, setConfirm] = useState<null | 'exit' | 'rerestructure'>(null)
  const doExit = () => navigate('/') // 退出跳首页走 navigate → 点击当帧亮顶部进度条（消冷缓存空窗）
  // 退出（移动端返回键 / 桌面 ✕ / Esc）一律先弹确认：此页的语料尚未落库，直接离开等于丢弃本次输入，
  // 无论是否编辑过整理结果都要问一句。确认才回首页，取消留在本页（数据全在 state，不受影响）。
  const requestExit = () => setConfirm('exit')
  const requestReRestructure = () => { if (hasUnsaved) setConfirm('rerestructure'); else void reRestructure() }

  // 语料取不回（返回态水合失败 / 首程 handoff 已被消费且 URL 无 rawText）：不拿示例故事兜底，
  // 明确告知取不回 + 回首页出口，两种来源共用同一错误态与文案。
  if (loadError) {
    return (
      <div className="min-h-dvh bg-bg-page flex flex-col items-center justify-center gap-5 px-8 text-center">
        <p className="text-[0.9375rem] text-v2-text-secondary leading-relaxed">没找到这条语料，可能已被删除或链接失效了。</p>
        <GradientButton
          onClick={() => navigate('/')}
          className="px-6 py-2.5 rounded-full text-[0.875rem] font-medium"
        >
          回到首页
        </GradientButton>
      </div>
    )
  }

  const viewProps: RestructureViewProps = {
    rawStory,
    aiText,
    isEditing,
    isLoading,
    error,
    usable,
    isSaving,
    saveError,
    qid,
    onAiChange: setAiText,
    onToggleEdit: () => setIsEditing(v => !v),
    onReRestructure: () => void reRestructure(),
    onMatch: () => void handleMatchClick(),
    onExit: requestExit,
    canSaveAnki: qid !== null,
    ankiSaveState,
    onSaveAnki: () => void handleSaveAnki(),
  }

  return (
    <>
      <div className="lg:hidden"><RestructureMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 沉浸外壳（整理步激活）+ 两栏舞台。
          ✕ / Esc③ / 重新整理 都走 request*：退出必确认，重新整理仅在编辑过未保存时确认。 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="restructure" onExit={requestExit}>
          <RestructureDesktop {...viewProps} onReRestructure={requestReRestructure} />
        </FlowShellDesktop>
      </div>
      {/* 确认弹窗放在断点分发之外：移动端返回键与桌面 ✕ / Esc 共用同一个（关闭态不渲染任何 DOM，
          移动端未触发时与改动前完全一致）。 */}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'rerestructure' ? '还没保存哦' : '取消这次语料输入？'}
        description={confirm === 'rerestructure'
          ? '重新整理会用新的整理结果覆盖你刚改过的内容，确定吗？'
          : '返回首页后，这次说的内容和整理结果都不会保存，需要重新录入。确定取消吗？'}
        confirmText={confirm === 'rerestructure' ? '重新整理' : '返回首页'}
        cancelText={confirm === 'rerestructure' ? '留下继续' : '继续整理'}
        onConfirm={() => { const c = confirm; setConfirm(null); if (c === 'exit') doExit(); else void reRestructure() }}
        onCancel={() => setConfirm(null)}
      />
      {/* 额度超限覆盖层：变体由服务端 402 reason 决定（trial 引导注册 / story 月额度）；关闭即回首页 */}
      {storyQuota && <QuotaReached variant={storyQuota} surface="restructure" asOverlay onClose={() => router.push('/')} />}
      {/* 匿名点存题卡（401）：注册引导小模态；关闭回本页（语料与整理结果不丢） */}
      {ankiGate && <AnkiRegisterGate onClose={() => setAnkiGate(false)} />}
      {/* 该题已绑别的语料（409）：换语料对比弹窗。新语料 = 刚 ensure 的这条，客户端有其一句话概括 */}
      {ankiSwap && (
        <SwapCorpusDialog
          currentCorpus={ankiSwap.current}
          newCorpus={{ id: ankiSwap.newStoryId, summary }}
          swapping={ankiSwapping}
          onSwap={() => void handleConfirmSwapAnki()}
          onKeepCurrent={() => { if (!ankiSwapping) setAnkiSwap(null) }}
        />
      )}
      <Toast message={ankiToast} onDismiss={() => setAnkiToast(null)} />
    </>
  )
}

export default function RestructurePage() {
  return <Suspense><RestructureContent /></Suspense>
}
