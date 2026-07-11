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
import { saveExtraction } from '@/lib/db/corpus'
import { getSupabase } from '@/lib/supabase'
import { SCORE_HIGH, SCORE_MID, SCORE_LOW } from '@/lib/constants'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import MatchingMobile from './MatchingMobile'
import MatchingDesktop from './MatchingDesktop'
import type { FunnelResult, PartTab, MatchingViewProps } from './types'

/** 取当前 session 的 Bearer 头，供受保护 API 鉴权使用（无 session 时返回空对象） */
async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await getSupabase().auth.getSession()
  const token = session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function MatchingContent() {
  const router = useRouter()
  const params = useSearchParams()
  const corpusId = params.get('corpusId') ?? ''
  const [result, setResult] = useState<FunnelResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
      setLoading(true); setError(null)
      try {
        const res = await fetch('/api/matching', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ corpusId }),
          signal: ac.signal,
        })
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
  }, [corpusId, retryKey])

  // 动态 Part 标签：只显示有结果的 Part
  const availableTabs = useMemo<PartTab[]>(() => {
    if (!result) return ['全部']
    const parts = new Set(result.questions.map((q) => q.part))
    const tabs: PartTab[] = ['全部']
    if (parts.has(1)) tabs.push('Part 1')
    if (parts.has(2)) tabs.push('Part 2')
    return tabs
  }, [result])

  // 标题计数：≥ SCORE_LOW 的总量，跨所有 Part（不受 Tab 过滤影响）
  const totalVisible = useMemo(() => {
    if (!result) return 0
    return result.questions.filter((q) => (q.relevanceScore ?? 100) >= SCORE_LOW).length
  }, [result])

  // 当前 Tab 过滤后的题目
  const filtered = useMemo(() => {
    if (!result) return []
    if (activeTab === '全部') return result.questions
    const n = activeTab === 'Part 1' ? 1 : 2
    return result.questions.filter((q) => q.part === n)
  }, [result, activeTab])

  // 三档分组；无 score（排名服务降级）时默认归入高匹配，保持全量展示
  const highGroup = useMemo(
    () => filtered.filter((q) => (q.relevanceScore ?? 100) >= SCORE_HIGH),
    [filtered]
  )
  const midGroup = useMemo(
    () => filtered.filter((q) => {
      const s = q.relevanceScore ?? 100
      return s >= SCORE_MID && s < SCORE_HIGH
    }),
    [filtered]
  )
  const lowGroup = useMemo(
    () => filtered.filter((q) => {
      const s = q.relevanceScore ?? 100
      return s >= SCORE_LOW && s < SCORE_MID
    }),
    [filtered]
  )

  const foldedCount  = midGroup.length + lowGroup.length
  const hasMore      = foldedCount > 0
  const noneVisible  = highGroup.length === 0 && midGroup.length === 0 && lowGroup.length === 0

  const viewProps: MatchingViewProps = {
    result,
    loading,
    error,
    totalVisible,
    availableTabs,
    activeTab,
    filtered,
    highGroup,
    midGroup,
    lowGroup,
    foldedCount,
    hasMore,
    noneVisible,
    selectedId,
    expanded,
    onSelectTab: (tab) => setActiveTab(tab),
    onToggleSelect: (id) => setSelectedId(prev => prev === id ? null : id),
    onSelect: (id) => setSelectedId(id),
    onToggleExpanded: () => setExpanded(v => !v),
    onPractice: (id) => router.push(`/analysis?questionId=${id}&storyId=${corpusId}`),
    onRetry: () => void retry(),
    onExit: () => router.push('/'),
  }

  return (
    <>
      <div className="lg:hidden"><MatchingMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 沉浸外壳（匹配步激活）+ master-detail 舞台 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="matching" onExit={viewProps.onExit}>
          <MatchingDesktop {...viewProps} />
        </FlowShellDesktop>
      </div>
    </>
  )
}

export default function MatchingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-page" />}>
      <MatchingContent />
    </Suspense>
  )
}
