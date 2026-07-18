/**
 * @module   AnalysisPage
 * @desc     题目分析页外壳 —— 集中持有取数/换词/收藏/跳转逻辑（savedSet 的 localStorage 读写为单一真源），
 *           按 lg 断点分发移动/桌面两套视图：<1024 渲染 AnalysisMobile；≥1024 用 FlowShellDesktop
 *           （analysis 步激活）包住 AnalysisDesktop。逻辑单实例，两视图仅接收状态与回调做展示。
 * @author   LingoBridge
 * @created  2026-05-28
 */
'use client'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { mutate } from 'swr'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import AnalysisMobile from './AnalysisMobile'
import AnalysisDesktop from './AnalysisDesktop'
import type { AnalysisViewProps } from './types'
import type { AnalysisResponse, AnalysisPhraseGroup, AnalysisPhrase, SavedWord } from '@/lib/types'
import { addSavedWord, removeSavedWord, listSavedWords } from '@/lib/db/saved-words'
import { useSavedWords, SAVED_WORDS_KEY } from '@/hooks/library-data'
import { apiFetch } from '@/lib/api-client'

function AnalysisContent() {
  const router     = useRouter()
  const params     = useSearchParams()
  const questionId = params.get('questionId') ?? ''
  const storyId    = params.get('storyId') ?? ''
  const review     = params.get('review') === '1'
  // 流向判别：from=matching（故事流）→ 回匹配页；from=restructure（雅思流）→ 回整理页（带 qid）；
  // 深链缺 from → 安全默认回首页，绝不静默走错分支。
  const from       = params.get('from')
  const backTarget = from === 'matching'
    ? { href: `/matching?corpusId=${storyId}`, label: '返回题目' }
    : from === 'restructure'
      ? { href: `/restructure?corpusId=${storyId}&qid=${questionId}`, label: '返回整理' }
      : { href: '/', label: '返回首页' }
  const [data, setData]       = useState<AnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [openPhrase, setOpenPhrase] = useState<string | null>(null)
  const [level, setLevel] = useState('6.0')
  const [levelMenuOpen, setLevelMenuOpen] = useState(false)
  const [phrasesLoading, setPhrasesLoading] = useState(false)
  // 已收藏词组高亮：以云端 useSavedWords 为唯一真源，直接派生集合（不镜像成本地 state，
  // 否则「用 effect 同步 state」会因 savedWords 每 render 新引用而无限重渲染 / Maximum update depth）。
  const { words: savedWords } = useSavedWords()
  const savedSet = useMemo(() => new Set(savedWords.map(w => w.text)), [savedWords])
  const [retryKey, setRetryKey] = useState(0)
  // A15 防重入：error 态两个重试入口共用一个 ref 守卫，连点只触发一次重新分析
  const [retry] = useAsyncAction(() => setRetryKey(k => k + 1))

  useEffect(() => {
    if (!questionId) { setLoading(false); setError('缺少题目'); return }
    let cancelled = false
    const ac = new AbortController()
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const res = await apiFetch(`/api/analysis?questionId=${encodeURIComponent(questionId)}&storyId=${encodeURIComponent(storyId)}`, { signal: ac.signal })
        // 服务端同意闸拒绝（403，未捕获同意）：深链直达本页时兜底，回首页触发同意弹窗，不裸报「生成分析失败」。
        // 分析是零红线环节（点进题目看到的全部内容），务必兜好而非停在错误态。
        if (res.status === 403) { if (!cancelled) router.push('/'); return }
        if (!res.ok) throw new Error('生成分析失败')
        const json = (await res.json()) as AnalysisResponse
        if (!cancelled) setData(json)
      } catch (e) {
        if (ac.signal.aborted) return          // 中断不算错误，忽略
        if (!cancelled) setError(e instanceof Error ? e.message : '生成分析失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true; ac.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- storyId 随首帧固定不变，初次加载即取用；列入依赖只会无谓重跑分析
  }, [questionId, retryKey])

  function changeLevel(newLevel: string) {
    const prevLevel = level
    setLevel(newLevel)
    setOpenPhrase(null)
    setPhrasesLoading(true)
    ;(async () => {
      try {
        const res = await apiFetch(`/api/analysis/phrases?questionId=${encodeURIComponent(questionId)}&storyId=${encodeURIComponent(storyId)}&level=${encodeURIComponent(newLevel)}`)
        // 服务端同意闸拒绝（403）：回首页触发同意弹窗，不停在换词失败态。
        if (res.status === 403) { router.push('/'); return }
        if (!res.ok) throw new Error('换词失败')
        const json = (await res.json()) as { phrases: AnalysisPhraseGroup[] }
        setData(prev => prev ? { ...prev, analysis: { ...prev.analysis, phrases: json.phrases } } : prev)
      } catch {
        setLevel(prevLevel)
      } finally {
        setPhrasesLoading(false)
      }
    })()
  }

  function toggleSave(item: AnalysisPhrase, group: string) {
    const key = item.text
    const isSaved = savedSet.has(key)
    const newWord: SavedWord = {
      id: key,
      text: key,
      meaning: item.meaning,
      scene: item.scene,
      group,
      level,
      questionEn: data?.question.en ?? '',
      createdAt: new Date().toISOString(),
    }
    // 乐观更新走 SWR 缓存（唯一真源）：点按即时切高亮，出错自动回滚，落库后以服务端结果为准。
    const optimisticWords = isSaved
      ? savedWords.filter(w => w.text !== key)
      : [newWord, ...savedWords]
    const persist = isSaved ? removeSavedWord(key) : addSavedWord(newWord).then(() => undefined)
    void mutate(
      SAVED_WORDS_KEY,
      persist.then(() => listSavedWords()),
      { optimisticData: optimisticWords, rollbackOnError: true, revalidate: false },
    ).catch((e) => console.error('[analysis] 词组收藏失败', e))
  }

  const viewProps: AnalysisViewProps = {
    data,
    loading,
    error,
    level,
    levelMenuOpen,
    phrasesLoading,
    openPhrase,
    savedSet,
    onRetry: () => void retry(),
    onToggleLevelMenu: () => setLevelMenuOpen(v => !v),
    onSelectLevel: (lv) => { setLevelMenuOpen(false); if (lv !== level) changeLevel(lv) },
    onTogglePhrase: (key) => setOpenPhrase(key),
    onToggleSave: toggleSave,
    onStartPractice: () => router.push(`/practice?questionId=${questionId}&storyId=${storyId}&level=${level}&review=${review ? 1 : 0}`),
    onBack: () => router.push(backTarget.href),
    onExit: () => router.push('/'),
  }

  return (
    <>
      <div className="lg:hidden"><AnalysisMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 沉浸外壳（分析步激活）+ split 两栏舞台 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="analysis" onExit={viewProps.onExit} onBack={viewProps.onBack} backLabel={backTarget.label}>
          <AnalysisDesktop {...viewProps} />
        </FlowShellDesktop>
      </div>
    </>
  )
}

export default function AnalysisPage() {
  return <Suspense><AnalysisContent /></Suspense>
}
