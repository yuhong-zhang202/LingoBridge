/**
 * @module   MatchingPage
 * @desc     题目匹配页外壳 —— 集中持有取数/筛选/选中/跳转逻辑：/api/matching 取数与 saveExtraction 单份、
 *           三档分组 useMemo、动态 Part 标签、默认选中第一题等全部留在外壳，按 lg 断点分发移动/桌面两套视图：
 *           <1024 渲染 MatchingMobile；≥1024 用 FlowShellDesktop（matching 步激活）包住 MatchingDesktop。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useNav } from '@/components/NavProgress'
import { saveExtraction } from '@/lib/db/corpus'
import { apiFetch } from '@/lib/api-client'
import { SCORE_HIGH, SCORE_MID } from '@/lib/constants'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import MatchingMobile from './MatchingMobile'
import MatchingDesktop from './MatchingDesktop'
import type { FunnelResult, PartTab, MatchingViewProps } from './types'

function MatchingContent() {
  const router = useRouter()
  const { navigate } = useNav()
  const params = useSearchParams()
  const corpusId = params.get('corpusId') ?? ''
  const [result, setResult] = useState<FunnelResult | null>(null)
  const [loading, setLoading] = useState(true)
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

  // 切换 Tab 时收起折叠
  useEffect(() => { setExpanded(false) }, [activeTab])

  useEffect(() => {
    if (!corpusId) { setLoading(false); setError('缺少语料 id'); return }
    let cancelled = false
    const ac = new AbortController()
    ;(async () => {
      setLoading(true); setError(null); setDailyLimitHit(false)
      try {
        const res = await apiFetch('/api/matching', {
          method: 'POST',
          json: { corpusId },
          signal: ac.signal,
        })
        // 服务端同意闸拒绝（403，未捕获同意）：深链直达本页时兜底，回首页触发同意弹窗，不裸报「匹配失败」。
        if (res.status === 403) { if (!cancelled) router.push('/'); return }
        // 402 = 匿名试用额度用尽 → 转化点，弹注册引导覆盖层
        if (res.status === 402) { if (!cancelled) setQuotaShown(true); return }
        // 429 = 注册用户当日上限 → 只告知「明天恢复」，不走 error 通道（其 CTA 是重试，点了还撞 429）
        if (res.status === 429) { if (!cancelled) setDailyLimitHit(true); return }
        if (!res.ok) throw new Error('匹配失败')
        const data = (await res.json()) as FunnelResult
        if (!cancelled) { setResult(data); setSelectedId(data.questions[0]?.id ?? null) }
        // 非阻断写库：把萃取观察点关联到真实语料（客户端调用，保证 RLS user session 一致）
        if (!cancelled && corpusId && data.primary) {
          saveExtraction(corpusId, data.primary.pointCode, data.secondary?.pointCode ?? null)
            .catch((err: unknown) => console.warn('[MatchingPage] saveExtraction 失败，跳过', err))
        }
      } catch (e) {
        if (ac.signal.aborted) return          // 中断不算错误，忽略
        if (!cancelled) setError(e instanceof Error ? e.message : '匹配失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true; ac.abort() }
  }, [corpusId, retryKey, router])

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
  useEffect(() => {
    if (!result) return
    const highCount = result.questions.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_HIGH).length
    const midCount = result.questions.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_MID && q.relevanceScore < SCORE_HIGH).length
    const unscoredCount = result.questions.filter((q) => q.relevanceScore == null).length
    const visibleCount = highCount + midCount
    void apiFetch('/api/events', {
      method: 'POST',
      json: {
        event: 'match.view_rendered',
        storyId: corpusId,
        props: {
          candidateCount: result.questions.length,
          highCount,
          midCount,
          visibleCount,
          unscoredCount,
          noMatch: result.noMatch,
          globalNoneVisible: !result.noMatch && visibleCount === 0,
        },
      },
    }).catch(() => {})
  }, [result, corpusId])

  // 未打分候选（重排 3 轮补缺全失败后的兜底残留）属极罕见边缘态：它们一律不展示，
  // 但绝不能静默——静默就等于这条路径永远不会被发现。每次取到新结果时报一次。
  useEffect(() => {
    if (!result) return
    const unscored = result.questions.filter((q) => q.relevanceScore == null)
    if (unscored.length === 0) return
    console.error('[MatchingPage] 存在未打分候选，按「无分数依据」一律不展示、不标档', {
      corpusId,
      unscoredCount: unscored.length,
      totalCandidates: result.questions.length,
      unscoredQuestionIds: unscored.map((q) => q.id),
    })
  }, [result, corpusId])

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

  const foldedCount  = midGroup.length
  const hasMore      = foldedCount > 0
  // noneVisible：当前 Tab 两档皆空（可能只是该 Part 无题，全部 Tab 仍有题）——轻量提示即可
  const noneVisible  = highGroup.length === 0 && midGroup.length === 0
  // globalNoneVisible：跨所有 Part 都没有可见题（totalVisible 已是跨 Tab 的 ≥SCORE_MID 计数）。
  // 与 noneVisible 区分：只有全局无可见题才升级为 NoMatchView 引导，避免 Tab 局部空误伤。
  const globalNoneVisible = !!result && !result.noMatch && totalVisible === 0

  // 002 修复：highGroup=0 且 midGroup>0 时，此前三个空态判断会全部落空——
  // 高匹配块不渲染（组为空）、中匹配块不渲染（expanded 初值 false）、
  // noneVisible=false（mid 非空）、globalNoneVisible=false（totalVisible>0）
  // → 用户看到大标题「匹配到 N 道当季真题」+ 零张卡 + 一个「查看更多 N 道 →」按钮。
  // 标题说有题，屏幕上没题。修法：没有高匹配时把折叠区默认展开，让那 N 道真的出现。
  const autoExpand = highGroup.length === 0 && midGroup.length > 0
  // 自动展开时不给折叠开关：没有高匹配时中匹配就是全部内容，"收起"只会把用户送回那个洞里
  const expandedEffective = expanded || autoExpand
  const showToggle = hasMore && !autoExpand

  const viewProps: MatchingViewProps & { globalNoneVisible: boolean } = {
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
    selectedId,
    expanded: expandedEffective,
    autoExpand,
    onSelectTab: (tab) => setActiveTab(tab),
    onToggleSelect: (id) => setSelectedId(prev => prev === id ? null : id),
    onSelect: (id) => setSelectedId(id),
    onToggleExpanded: () => setExpanded(v => !v),
    // from=matching：让 analysis「返回上一步」知道自己该回到本匹配页（故事流），而非静默走错。
    // navigate（非 router.push）：点「开始分析」瞬间即亮顶部进度条，AI 分析页拉取期间有反馈。
    onPractice: (id) => navigate(`/analysis?questionId=${id}&storyId=${corpusId}&from=matching`),
    onRetry: () => void retry(),
    onBack: () => router.push(`/restructure?corpusId=${corpusId}`),
    onExit: () => router.push('/'),
  }

  return (
    <>
      <div className="lg:hidden"><MatchingMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 沉浸外壳（匹配步激活）+ master-detail 舞台 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="matching" onExit={viewProps.onExit} onBack={viewProps.onBack} backLabel="返回整理">
          <MatchingDesktop {...viewProps} />
        </FlowShellDesktop>
      </div>
      {/* 402 匿名试用额度用尽：引导注册；关闭即回首页（本页无内容可留） */}
      {quotaShown && <QuotaReached variant="trial" asOverlay onClose={() => router.push('/')} />}
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
