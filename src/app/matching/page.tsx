/**
 * @module   MatchingPage
 * @desc     题目匹配页外壳 —— 集中持有取数/筛选/选中/跳转逻辑：/api/matching 取数与 saveExtraction 单份、
 *           三档分组 useMemo、动态 Part 标签、默认选中第一题等全部留在外壳，按 lg 断点分发移动/桌面两套视图：
 *           <1024 渲染 MatchingMobile；≥1024 用 FlowShellDesktop（matching 步激活）包住 MatchingDesktop。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useNav } from '@/components/NavProgress'
import { saveExtraction, getCorpusById } from '@/lib/db/corpus'
import { apiFetch } from '@/lib/api-client'
import { track } from '@/lib/client-events'
import { requestAnalysis, abortAll, inflightKey } from '@/lib/analysis-inflight'
import { SCORE_HIGH, SCORE_MID, LOW_MATCH_SHOW_MAX, targetBandToLevel, RANKING_ALGO_VERSION } from '@/lib/constants'
import { useAccount } from '@/hooks/useAccount'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import Toast from '@/components/Toast'
import AnkiRegisterGate from '@/components/anki/AnkiRegisterGate'
import SwapCorpusDialog from '@/components/anki/SwapCorpusDialog'
import { saveAnkiPair, swapAnkiCorpusClient, type CorpusBrief } from '@/lib/anki/cards-client'
import MatchingMobile from './MatchingMobile'
import MatchingDesktop from './MatchingDesktop'
import type { FunnelResult, FunnelQuestion, FunnelStreamMeta, PartTab, MatchingViewProps } from './types'

/** 逐条到达的富化题（SSE question 帧）：与 FunnelQuestion 同形，唯 ankiSaved 由前端在 done 帧前默认 false。 */
type StreamQuestion = Omit<FunnelQuestion, 'ankiSaved'>

interface MatchingSSEHandlers {
  onMeta: (m: FunnelStreamMeta) => void
  onQuestion: (q: StreamQuestion) => void
  onDone: (data: FunnelResult) => void
}

/**
 * 读 /api/matching 的 SSE 流：按 `\n\n` 切帧，解析 event/data 两行，分派到 handlers。
 * 契约：正常必以 done 帧收尾。收到 error 帧、或流结束仍无 done → 抛错，调用方据此降级重发 ?stream=0。
 * @param res  已确认 res.ok 的流式响应
 * @param h    meta/question/done 三类帧的处理回调
 * @sideEffect 持续读 response.body，直到流结束或抛错
 */
async function readMatchingSSE(res: Response, h: MatchingSSEHandlers): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('matching SSE: 无响应体')
  const decoder = new TextDecoder()
  let buf = ''
  let sawDone = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      let event = ''
      let data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data = line.slice(5).trim()
      }
      if (!event || !data) continue
      if (event === 'meta') h.onMeta(JSON.parse(data) as FunnelStreamMeta)
      else if (event === 'question') h.onQuestion(JSON.parse(data) as StreamQuestion)
      else if (event === 'done') { h.onDone(JSON.parse(data) as FunnelResult); sawDone = true }
      else if (event === 'error') throw new Error('matching SSE: 收到 error 帧')
    }
  }
  // 流正常结束却没有 done：视为流式失败，交调用方降级到 ?stream=0（保证用户拿到完整结果）
  if (!sawDone) throw new Error('matching SSE: 流结束但缺 done 帧')
}

function MatchingContent() {
  const router = useRouter()
  const { navigate } = useNav()
  const params = useSearchParams()
  const corpusId = params.get('corpusId') ?? ''
  // 目标分 → 词组水平档：预取暖缓存 + 点击即发都按此 level，否则用户目标分≠6 时预取的 6.0 缓存不命中、白暖一场。
  // 用 ref 让「结果渲染后延迟 1.5s」的预取 effect 读到最新 level，而不必把 level 列进 effect 依赖（避免 account 迟到时重跑预取）。
  const { account } = useAccount()
  const level = targetBandToLevel(account?.targetBand ?? null)
  const levelRef = useRef(level)
  levelRef.current = level
  const [result, setResult] = useState<FunnelResult | null>(null)
  const [loading, setLoading] = useState(true)
  // streamDone：SSE 收到 done 帧（结果定稿）。空态判定、view_rendered/dwell/预取埋点全部以它为锚点——
  // 流式增量中途（题目还在逐条到达）绝不触发空态、绝不当作「渲染完成」，避免误报与空态闪烁。
  const [streamDone, setStreamDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 402（匿名试用额度用尽）→ 弹 QuotaReached trial 引导注册；429（注册用户当日上限）→ 行内提示，绝不引导注册
  const [quotaShown, setQuotaShown] = useState(false)
  const [dailyLimitHit, setDailyLimitHit] = useState(false)
  const [activeTab, setActiveTab] = useState<PartTab>('全部')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  // A12 防重入：error 态两个重试入口共用一个 ref 守卫，连点只触发一次重新匹配
  const [retry] = useAsyncAction(() => setRetryKey(k => k + 1))
  // ── 存对子（题卡）态 ──
  // savedIds：已存题卡的题 id（服务端 ankiSaved 初值 + 本次新存）；savingId：进行中的题；
  // ankiGate：匿名点存 → 注册引导模态；swap：409 换语料弹窗（携当前已绑语料对比）；toast：失败/成功轻提示。
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)
  const [ankiGate, setAnkiGate] = useState(false)
  // 点击即发时记下被点题的键：匹配页卸载/结果变时用它作 abortAll 的 except，保住这条「点击即发」请求
  // 不被清理连带 abort（否则分析页采纳不到、白等），其余预取照清。
  const lastClickedKeyRef = useRef<string | null>(null)
  // dwell 计时（用户在匹配页停留时长，随 match.question_opened 上报）。
  // 【口径：活跃浏览时长，扣除切后台/页面隐藏时间】—— 理由：两个用途（① 产品信号「一眼选中 vs 犹豫」；
  //   ② 工程判断预取覆盖几道/启动延迟）都要的是「用户真在看着匹配结果做决定」的时间。开着标签页切走 5 分钟
  //   再回来点，那 5 分钟不是在犹豫、也没在浏览（且预取定时器在后台被浏览器节流、并未推进），算进去会让
  //   「犹豫」信号和预取提前量估计双双失真。故按 visibilitychange 只累计前台可见时段。
  //   accumulatedMs=已落袋的活跃时段；activeStart=当前可见时段的起点（performance.now，单调、不受墙钟改动影响）。
  const dwellRef = useRef<{ activeStart: number; accumulatedMs: number } | null>(null)
  const [swap, setSwap] = useState<{ questionId: string; current: CorpusBrief } | null>(null)
  const [swapping, setSwapping] = useState(false)
  // 本页会话语料（corpusId）的一句话概括：整理时已同源产出并写入 corpus.summary，此处按 id 拉出，
  // 供 409 换语料弹窗把「新语料」显示成真概括而非中性占位（弹窗才会用到，但预拉一次免开窗时闪动）。
  const [newCorpusSummary, setNewCorpusSummary] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // 切换 Tab 时收起折叠
  useEffect(() => { setExpanded(false) }, [activeTab])

  useEffect(() => {
    if (!corpusId) { setLoading(false); setError('缺少语料 id'); return }
    let cancelled = false
    const ac = new AbortController()

    // done 帧 / 缓冲降级的整份结果：结果定稿，写 result + 选中首题 + 已存态 + 关联萃取 + 置流式完成标志。
    // 与旧的一次性成功分支逐字等价（只是从 res.json() 挪成 done 帧数据 / ?stream=0 数据）。
    const applyFinal = (data: FunnelResult): void => {
      if (cancelled) return
      setResult(data)
      setSelectedId(data.questions[0]?.id ?? null)
      // 已存态初值来自服务端 ankiSaved（匿名一律 false）——书签直接呈现「已存/未存」，不必再单独查一次。
      setSavedIds(new Set(data.questions.filter((q) => q.ankiSaved).map((q) => q.id)))
      setStreamDone(true)
      setLoading(false)
      // 非阻断写库：把萃取观察点关联到真实语料（客户端调用，保证 RLS user session 一致）
      if (corpusId && data.primary) {
        saveExtraction(corpusId, data.primary.pointCode, data.secondary?.pointCode ?? null)
          .catch((err: unknown) => console.warn('[MatchingPage] saveExtraction 失败，跳过', err))
      }
    }

    // 三个转化/限流状态与现状一字不变（无论流式还是 ?stream=0 回来都在读体前先判 status）。
    // 命中即处理并返回 true（调用方据此终止，不再降级/不报错）。
    const handleTerminalStatus = (res: Response): boolean => {
      // 三个终态都必须置 loading=false：否则视图把「当日上限」横幅门控在 !loading 后，429 会永久转圈、提示不出（回归修复）。
      if (res.status === 403) { if (!cancelled) { setLoading(false); router.push('/') } return true }   // 同意闸：回首页触发同意弹窗
      if (res.status === 402) { if (!cancelled) { setLoading(false); setQuotaShown(true) } return true } // 匿名额度用尽：注册引导
      if (res.status === 429) { if (!cancelled) { setLoading(false); setDailyLimitHit(true) } return true } // 注册当日上限：明天恢复
      return false
    }

    ;(async () => {
      setLoading(true); setError(null); setDailyLimitHit(false); setStreamDone(false)
      setResult(null); setSelectedId(null)
      const questions: StreamQuestion[] = []   // 逐条到达累积（方案 A：到达即追加，折叠分档实时重算）
      let meta: FunnelStreamMeta | null = null
      try {
        // ── 默认流式 SSE：meta 先到搭骨架，question 逐条追加（数字悄悄往上跳），done 定稿 ──
        const res = await apiFetch('/api/matching', { method: 'POST', json: { corpusId }, signal: ac.signal })
        if (handleTerminalStatus(res)) return
        if (!res.ok) throw new Error('匹配失败')   // 开流前的非配额错误 → 交 catch 降级重发 ?stream=0
        await readMatchingSSE(res, {
          onMeta: (m) => { meta = m },
          onQuestion: (q) => {
            if (cancelled) return
            questions.push(q)
            // 流式中间态：用 meta 搭骨架 + 当前累积题；ankiSaved 暂 false（done 帧带真值再覆盖），noMatch 恒 false（空态只在 done 后判）
            setResult({
              primary: meta?.primary ?? null,
              secondary: meta?.secondary ?? null,
              questions: questions.map((sq) => ({ ...sq, ankiSaved: false })),
              count: questions.length,
              matchedViaSecondary: meta?.matchedViaSecondary ?? false,
              noMatch: false,
            })
            setLoading(false)
            setSelectedId((prev) => prev ?? q.id)
          },
          onDone: (data) => applyFinal(data),
        })
      } catch {
        if (ac.signal.aborted || cancelled) return   // 中断不算错误
        // ── 降级：读流错 / 无 done / 上游不支持流式 → 重发 ?stream=0 走阻塞式整批（用户无感，只是没逐条）──
        try {
          const res = await apiFetch('/api/matching?stream=0', { method: 'POST', json: { corpusId }, signal: ac.signal })
          if (handleTerminalStatus(res)) return
          if (!res.ok) throw new Error('匹配失败')
          applyFinal((await res.json()) as FunnelResult)
        } catch (e2) {
          if (ac.signal.aborted || cancelled) return
          if (!cancelled) { setError(e2 instanceof Error ? e2.message : '匹配失败'); setLoading(false) }
        }
      }
    })()
    return () => { cancelled = true; ac.abort() }
  }, [corpusId, retryKey, router])

  // 拉本页会话语料的概括，填 409 换语料弹窗的「新语料」。失败静默降级为 null（弹窗回退中性占位），
  // 绝不阻塞匹配主流程。语料实体已在整理步落库（含 summary），此处只读一次。
  useEffect(() => {
    if (!corpusId) return
    let cancelled = false
    getCorpusById(corpusId)
      .then((c) => { if (!cancelled) setNewCorpusSummary(c?.summary ?? null) })
      .catch((e: unknown) => console.warn('[MatchingPage] 拉语料概括失败，换语料弹窗走占位', e))
    return () => { cancelled = true }
  }, [corpusId])

  // 动态 Part 标签：只显示有结果的 Part
  const availableTabs = useMemo<PartTab[]>(() => {
    if (!result) return ['全部']
    const parts = new Set(result.questions.map((q) => q.part))
    const tabs: PartTab[] = ['全部']
    if (parts.has(1)) tabs.push('Part 1')
    if (parts.has(2)) tabs.push('Part 2')
    return tabs
  }, [result])

  // 埋点 match.view_rendered（第一周只出裸计数、不设阈值）：上报「用户在故事级真看到了什么」——
  // 跨 Tab（非当前 Tab 过滤）的高/中/可见/未打分计数 + 是否落到全局空态，供与服务端 match.result 对照
  // （服务端给了什么 vs 用户看到什么）。fire-and-forget：上报失败绝不影响渲染。
  // 锚点 = streamDone（结果定稿）：流式增量中途 result 每来一题就变一次，绝不在中途上报——
  // 否则一次匹配会打出十几条半成品 view_rendered。done 后 result 即最终态，只报一次。
  useEffect(() => {
    if (!result || !streamDone) return
    const highCount = result.questions.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_HIGH).length
    const midCount = result.questions.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_MID && q.relevanceScore < SCORE_HIGH).length
    const unscoredCount = result.questions.filter((q) => q.relevanceScore == null).length
    const visibleCount = highCount + midCount
    // 走 track()（lib/client-events 的【唯一】封装）而非裸调 apiFetch：事件名与 props 由 event-schema
    // 契约收窄，key 写错/漏字段在 tsc 就报错。裸调绕过这层护栏，正是 rankingDegraded 一直在发、
    // 而服务端白名单里没有它 → 被 sanitize 静默丢弃（生产本事件 138 行、带该字段 0 行）却长期没人发现的那条路。
    track('match.view_rendered', {
      candidateCount: result.questions.length,
      highCount,
      midCount,
      visibleCount,
      unscoredCount,
      noMatch: result.noMatch,
      globalNoneVisible: !result.noMatch && visibleCount === 0,
      // rankingDegraded：区分两类空态频率——机制①重排整体降级（无分可展示、走重试）vs B 类低相关展示。
      rankingDegraded: !!result.rankingDegraded,
    }, { storyId: corpusId })
  }, [result, streamDone, corpusId])

  // 预取前 3 道分析（结果渲染后延迟启动、串行、静默降级）：后台预生成 top-3 的个性化分析，写进 (题,语料)
  // 缓存，用户点进去走缓存命中。取【数组前 3 道】（result.questions 已按分降序=用户所见序），【不】筛 ≥85——
  // 25% 场景一道高匹配都没有，筛分会一道都取不到。五条形状约束逐条落实：
  //   ① 串行：await 上一道完成再发下一道（任一时刻在飞恒 1，per-user）；
  //   ② 延迟触发：渲染后延迟 1.5s，避开与 matching 请求峰值重叠；
  //   ③ 独立并发闸：requestAnalysis(prefetch=true) 走服务端预取闸（见 route），全服务器自限、排真实请求之后；
  //   ④ 可中断：点任意题(onPractice)/离开(本 effect cleanup) → abortAll 立刻中止未完成预取（仅停客户端等待，
  //      服务端跑完写缓存、不减计数/成本，见 analysis-inflight 模块头）；
  //   ⑤ 静默降级：任一道 429/503/超时/任何错 → 放弃剩余（不重试、不提示、不打断），用户走点击即发兜底。
  useEffect(() => {
    // 以 done 为锚点：流式中途 result.questions 尚在增长且非最终序，此时取 top-3 会预取到错的题；done 后才是最终序。
    if (!result || !streamDone || result.noMatch || result.questions.length === 0) return
    const top3 = result.questions.slice(0, 3).map((q) => q.id)
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        for (const qid of top3) {
          if (cancelled) return
          try {
            const res = await requestAnalysis(qid, corpusId, true, levelRef.current).promise
            if (!res.ok) break               // 429/503/任何非 2xx → 放弃剩余预取（静默）
          } catch {
            break                            // 网络错/被 abort → 放弃剩余
          }
        }
      })()
    }, 1500)
    // cleanup：结果变(重新匹配)/离开匹配页 → 停循环 + 清空在飞（except 刚点击的题，保其「点击即发」不被连带 abort）
    return () => { cancelled = true; clearTimeout(timer); abortAll(lastClickedKeyRef.current ?? undefined) }
  }, [result, streamDone, corpusId])

  // dwell 计时启动：起点 = 匹配结果【实际渲染到屏幕】的时刻（rAF 在下一次绘制前触发，排除等 AI 的十几秒——
  // 本 effect 仅在 result 非空时跑，等 AI 的 loading 期不计；若渲染时正切后台，rAF 被浏览器推迟到回前台才触发，
  // 天然从「用户真正看到」起算）。结果变(重新匹配)则重置计时。活跃时长口径见 dwellRef 注释。
  useEffect(() => {
    // 起点锚定 done（结果定稿真正渲染完），不锚流式中途：中途 result 每来一题就变、会把 dwell 反复清零。
    if (!result || !streamDone) return
    const raf = requestAnimationFrame(() => { dwellRef.current = { activeStart: performance.now(), accumulatedMs: 0 } })
    const onVis = (): void => {
      const d = dwellRef.current
      if (!d) return
      if (document.hidden) d.accumulatedMs += performance.now() - d.activeStart   // 切后台：当前可见时段落袋
      else d.activeStart = performance.now()                                       // 回前台：重开计时
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis) }
  }, [result, streamDone])

  // 未打分候选（重排 3 轮补缺全失败后的兜底残留）属极罕见边缘态：它们一律不展示，
  // 但绝不能静默——静默就等于这条路径永远不会被发现。每次取到新结果时报一次。
  useEffect(() => {
    // 仅对定稿结果判定：流式中途尚未打分的题不算「未打分残留」（分数马上会来）。
    if (!result || !streamDone) return
    const unscored = result.questions.filter((q) => q.relevanceScore == null)
    if (unscored.length === 0) return
    console.error('[MatchingPage] 存在未打分候选，按「无分数依据」一律不展示、不标档', {
      corpusId,
      unscoredCount: unscored.length,
      totalCandidates: result.questions.length,
      unscoredQuestionIds: unscored.map((q) => q.id),
    })
  }, [result, streamDone, corpusId])

  // 标题计数：≥ SCORE_MID 的总量，跨所有 Part（不受 Tab 过滤影响）。
  // 未打分不计入：标题「匹配到 N 道」必须与真正展示出的卡片数一致，否则又是一次「说有 N 道却没有」。
  const totalVisible = useMemo(() => {
    if (!result) return 0
    return result.questions.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_MID).length
  }, [result])

  // 当前 Tab 过滤后的题目
  const filtered = useMemo(() => {
    if (!result) return []
    if (activeTab === '全部') return result.questions
    const n = activeTab === 'Part 1' ? 1 : 2
    return result.questions.filter((q) => q.part === n)
  }, [result, activeTab])

  // 三档分组。未打分（relevanceScore == null/undefined）一律不进任何档、不展示：
  // 产品不变式 2「用户看到的每道题必须有分数依据；无分数 → 不展示、不落库、不标任何档」。
  // 曾经这里是 `?? 100`，把我们一无所知的题当「高匹配」顶在首屏——正是不变式 2 要根除的
  // 「我们不知道 X 却声称 X」。与 matching.ts 排序用的 `?? -1`（未打分沉底）方向一致：都当它不存在。
  const highGroup = useMemo(
    () => filtered.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_HIGH),
    [filtered]
  )
  const midGroup = useMemo(
    () => filtered.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_MID && q.relevanceScore < SCORE_HIGH),
    [filtered]
  )

  // B 类低相关兜底展示切片：候选有分但全部 < SCORE_MID 时，取相关性最高的前 LOW_MATCH_SHOW_MAX 道如实展示。
  // 只从既有 relevanceScore 派生（未打分一律排除、绝不回填占位分）；result.questions 已按分降序 →
  // slice 后 lowShown[0] = 最高分那道（B 类置顶）。不经 filtered：B 类不出 Part 筛选、直接用全量低分题。
  const lowShown = useMemo(
    () => (result?.questions ?? [])
      .filter((q) => q.relevanceScore != null && q.relevanceScore < SCORE_MID)
      .slice(0, LOW_MATCH_SHOW_MAX),
    [result]
  )

  const foldedCount  = midGroup.length
  const hasMore      = foldedCount > 0
  // noneVisible：当前 Tab 两档皆空（可能只是该 Part 无题，全部 Tab 仍有题）——轻量提示即可。
  // 流式中途（!streamDone）恒 false：题还在逐条到达，此刻两档为空只是「还没到」，不是「没有」，绝不提示空态。
  const noneVisible  = streamDone && highGroup.length === 0 && midGroup.length === 0
  // globalNoneVisible：跨所有 Part 都没有可见题（totalVisible 已是跨 Tab 的 ≥SCORE_MID 计数）。
  // 与 noneVisible 区分：只有全局无可见题才升级为 NoMatchView 引导，避免 Tab 局部空误伤。
  // 同样门控 streamDone：只在结果定稿后才判「全局无可见题」，流式增量中途绝不闪 NoMatchView。
  const globalNoneVisible = !!result && streamDone && !result.noMatch && totalVisible === 0
  // rankingDegraded：机制①重排整体降级（候选存在、重排一分没产出，全部题无 relevanceScore）。
  // 与 globalNoneVisible 区分并【优先】判定——降级态无分可展示、只能重试；globalNoneVisible 里有低分的那支
  // 才走 B 类展示。仅 done 后判：流式骨架不带 rankingDegraded（undefined→false），不会中途闪降级态。
  const rankingDegraded = !!result && streamDone && !!result.rankingDegraded

  // 002 修复：highGroup=0 且 midGroup>0 时，此前三个空态判断会全部落空——
  // 高匹配块不渲染（组为空）、中匹配块不渲染（expanded 初值 false）、
  // noneVisible=false（mid 非空）、globalNoneVisible=false（totalVisible>0）
  // → 用户看到大标题「匹配到 N 道当季真题」+ 零张卡 + 一个「查看更多 N 道 →」按钮。
  // 标题说有题，屏幕上没题。修法：没有高匹配时把折叠区默认展开，让那 N 道真的出现。
  const autoExpand = highGroup.length === 0 && midGroup.length > 0
  // 自动展开时不给折叠开关：没有高匹配时中匹配就是全部内容，"收起"只会把用户送回那个洞里
  const expandedEffective = expanded || autoExpand
  const showToggle = hasMore && !autoExpand

  // 存题卡：已存短路；否则 POST → 200 标已存 / 401 弹注册引导 / 409 弹换语料弹窗 / 429·失败 toast。
  // corpusId 来自本页 URL（当前匹配会话的语料）。savingId 守卫：同题进行中不重复发。
  const handleSavePair = async (questionId: string): Promise<void> => {
    if (!corpusId) return
    if (savedIds.has(questionId) || savingId === questionId) return   // 已存/进行中：短路
    setSavingId(questionId)
    try {
      const r = await saveAnkiPair(questionId, corpusId)
      if (r.ok) { setSavedIds((s) => new Set(s).add(questionId)); return }
      if (r.kind === 'anon') { setAnkiGate(true); return }
      if (r.kind === 'bound') { setSwap({ questionId, current: r.currentCorpus }); return }
      if (r.kind === 'limit') { setToast('今天存的题卡有点多，明天再来'); return }
      setToast('没存上，再试一次')
    } finally {
      setSavingId(null)
    }
  }

  // 换语料：PUT 成功 → 标该题已存 + 成功 toast；失败 → toast 通用文案（弹窗保持关闭）。
  const handleConfirmSwap = async (): Promise<void> => {
    if (!swap || !corpusId) return
    setSwapping(true)
    const ok = await swapAnkiCorpusClient(swap.questionId, corpusId)
    setSwapping(false)
    if (ok) {
      setSavedIds((s) => new Set(s).add(swap.questionId))
      setSwap(null)
      setToast('已换成新语料，正在重新生成')
    } else {
      setSwap(null)
      setToast('没换成，再试一次')
    }
  }

  const viewProps: MatchingViewProps & { globalNoneVisible: boolean; rankingDegraded: boolean; lowShown: FunnelQuestion[] } = {
    result,
    loading,
    error,
    dailyLimitHit,
    totalVisible,
    availableTabs,
    activeTab,
    filtered,
    highGroup,
    midGroup,
    foldedCount,
    hasMore: showToggle,
    noneVisible,
    globalNoneVisible,
    rankingDegraded,
    lowShown,
    selectedId,
    expanded: expandedEffective,
    autoExpand,
    onSelectTab: (tab) => setActiveTab(tab),
    onToggleSelect: (id) => setSelectedId(prev => prev === id ? null : id),
    onSelect: (id) => setSelectedId(id),
    onToggleExpanded: () => setExpanded(v => !v),
    // from=matching：让 analysis「返回上一步」知道自己该回到本匹配页（故事流），而非静默走错。
    // navigate（非 router.push）：点「开始分析」瞬间即亮顶部进度条，AI 分析页拉取期间有反馈。
    onPractice: (id) => {
      // 点击即发：点的当帧就发起该题的【流式】analysis 请求（或复用正在预取的缓冲请求），与路由跳转并行——
      // 省掉「跳转→挂载→才发」的 2-3s 空转，分析页挂载后 requestAnalysis 按键去重复用同一在飞请求并 subscribe
      // 回放已到的段，不重发（见 analysis-inflight 统一流式模型）。同时 abortAll 中止其余预取（except 本题：
      // 若本题正在预取则复用同一在飞请求，不重发不双计）。记 lastClickedKey 供卸载 cleanup 保住它。
      const key = inflightKey(id, corpusId, level)
      lastClickedKeyRef.current = key
      abortAll(key)
      requestAnalysis(id, corpusId, false, level)
      // 选题排位埋点 match.question_opened（fire-and-forget，先发再跳）：rank = 该题在 result.questions
      //（已按分数降序 = 用户所见顺序）的 index+1；candidateCount = 列表总数。
      // 顺序：先 track 再 navigate —— 请求一旦发出，SPA 客户端跳转不卸载页面/不 kill 在途请求，
      // 故不会因跳转丢上报（也正因不卸载，此处【不需要】opts.keepalive）。失败静默、绝不阻塞跳转
      //（同上面 view_rendered 的上报范式）。
      const rank = (result?.questions.findIndex((q) => q.id === id) ?? -1) + 1
      // dwell 终点 = 点击时刻。活跃时长 = 已落袋 + 当前可见时段（点击必在前台，document.hidden 恒 false，
      // 防御性保留判断）。Math.round 取整过服务端 sanitize 的整数校验。
      const d = dwellRef.current
      const dwellMs = d ? Math.round(d.accumulatedMs + (document.hidden ? 0 : performance.now() - d.activeStart)) : undefined
      if (result && rank >= 1) {
        // 同 view_rendered：走 track() 而非裸调 apiFetch，字段受 event-schema 的 QuestionOpenedProps 约束。
        // 乙.1：补 questionId（= 点开的题 UUID）+ algoVersion（当前排序算法版本常量），去掉「靠 rank
        // join 快照 result.questions[rank-1]、遇算法升级错位」的脆耦合。服务端 sanitize 按 UUID/短枚举放行。
        // flowId 无需在此显式带：track 常规路径最终仍走 apiFetch，X-Flow-Id 头自动注入，route 侧读该头写入（乙.3）。
        track('match.question_opened', {
          rank,
          candidateCount: result.questions.length,
          questionId: id,
          algoVersion: RANKING_ALGO_VERSION,
          ...(dwellMs != null ? { dwellMs } : {}),
        }, { storyId: corpusId })
      }
      // rank 随 query 透传给 analysis→practice，最终写入 practice_sessions（乙.2）；仅故事流有 rank，rank<1 不拼。
      navigate(`/analysis?questionId=${id}&storyId=${corpusId}&from=matching${rank >= 1 ? `&rank=${rank}` : ''}`)
    },
    savedIds,
    savingId,
    onSavePair: (id) => void handleSavePair(id),
    onRetry: () => void retry(),
    // 返回整理页/退出跳首页均走 navigate → 点击当帧亮顶部进度条（消冷缓存空窗）
    onBack: () => navigate(`/restructure?corpusId=${corpusId}`),
    onExit: () => navigate('/'),
  }

  return (
    <>
      <div className="lg:hidden"><MatchingMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 沉浸外壳（匹配步激活）+ master-detail 舞台 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="matching" onExit={viewProps.onExit} onBack={viewProps.onBack} backLabel="返回整理" showFeedback>
          <MatchingDesktop {...viewProps} />
        </FlowShellDesktop>
      </div>
      {/* 402 匿名试用额度用尽：引导注册；关闭即回首页（本页无内容可留） */}
      {quotaShown && <QuotaReached variant="trial" asOverlay onClose={() => router.push('/')} />}
      {/* 匿名点存题卡（401）：注册引导小模态；关闭回本页（匹配结果不丢） */}
      {ankiGate && <AnkiRegisterGate onClose={() => setAnkiGate(false)} />}
      {/* 该题已绑别的语料（409）：换语料对比弹窗。新语料 = 本页会话语料，概括按 corpusId 预拉自 corpus.summary */}
      {swap && (
        <SwapCorpusDialog
          currentCorpus={swap.current}
          // 新语料概括来自 corpus.summary（整理步产出）；拉取失败/空则 null，弹窗回退中性占位
          newCorpus={{ id: corpusId, summary: newCorpusSummary }}
          swapping={swapping}
          onSwap={() => void handleConfirmSwap()}
          onKeepCurrent={() => { if (!swapping) setSwap(null) }}
        />
      )}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  )
}

export default function MatchingPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-bg-page" />}>
      <MatchingContent />
    </Suspense>
  )
}
