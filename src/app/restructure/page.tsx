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
import { MOCK_RAW_STORY } from '@/data/restructure'
import { takeHandoff } from '@/lib/handoff'
import { createCorpus, updateCorpusCleaned } from '@/lib/db/corpus'
import { upsertMatch } from '@/lib/db/matches'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import RestructureMobile from './RestructureMobile'
import RestructureDesktop from './RestructureDesktop'
import type { RestructureViewProps } from './types'

function RestructureContent() {
  const router   = useRouter()
  const params   = useSearchParams()
  const qid      = params.get('qid')
  // 故事正文从 sessionStorage 一次性取（取完即删），URL 仅含短 id。
  // 旧链接兜底：回退读 rawText；都为空则用 MOCK_RAW_STORY。
  const [rawStory] = useState<string>(() => {
    const h = params.get('h')
    if (h) {
      const v = takeHandoff(h)
      if (v !== null) return v
    }
    return params.get('rawText') ?? MOCK_RAW_STORY
  })
  const [isLoading, setIsLoading] = useState(true)
  const [aiText,    setAiText]    = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [usable,    setUsable]    = useState<boolean | null>(null)
  const [isSaving,  setIsSaving]  = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const runRestructure = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setIsEditing(false)
    setError(null)
    setUsable(null)
    try {
      const res = await fetch('/api/restructure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: rawStory }),
        signal,
      })
      if (!res.ok) throw new Error('整理失败')
      const data = (await res.json()) as { cleanedText: string; usable: boolean }
      if (signal?.aborted) return
      setAiText(data.cleanedText)
      setUsable(data.usable ?? true)
    } catch (e) {
      if (signal?.aborted) return          // 中断不算错误，忽略
      setError(e instanceof Error ? e.message : '整理失败，请重试')
    } finally {
      if (!signal?.aborted) setIsLoading(false)
    }
  }, [rawStory])

  useEffect(() => {
    const ac = new AbortController()
    void runRestructure(ac.signal)
    return () => ac.abort()
  }, [runRestructure])
  // A13 防重入：「重新整理」「重试」两个按钮共用一个 ref 守卫，连点只发一次 AI 整理
  const [reRestructure] = useAsyncAction(runRestructure)

  const handleMatchClick = useCallback(async (): Promise<void> => {
    setIsSaving(true)
    setSaveError(null)
    try {
      const corpus = await createCorpus({ source: 'voice', rawText: rawStory })
      await updateCorpusCleaned(corpus.id, aiText)
      if (qid) {
        // 记录「已选」配对，让答过的语料出现在该题「练习题目」页；写库失败不阻断跳转
        await upsertMatch(corpus.id, qid, 'chosen').catch((e) => console.error('[restructure] upsertMatch failed', e))
        router.push(`/analysis?questionId=${qid}&storyId=${corpus.id}`)   // 雅思流：跳过匹配，直达分析
      } else {
        router.push(`/matching?corpusId=${corpus.id}`)                    // 故事流：照旧去匹配
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '语料保存失败，请重试')
      setIsSaving(false)
    }
  }, [rawStory, aiText, qid, router])

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
  }

  return (
    <>
      <div className="lg:hidden"><RestructureMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 沉浸外壳（整理步激活）+ 两栏舞台 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="restructure" onExit={() => router.push('/')}>
          <RestructureDesktop {...viewProps} />
        </FlowShellDesktop>
      </div>
    </>
  )
}

export default function RestructurePage() {
  return <Suspense><RestructureContent /></Suspense>
}
