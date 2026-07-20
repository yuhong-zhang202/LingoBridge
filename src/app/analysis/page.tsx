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
import QuotaReached from '@/components/QuotaReached'
import Toast from '@/components/Toast'
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
  // 402（匿名试用额度用尽）→ 弹 QuotaReached trial 引导注册；429（注册用户当日上限）→ 行内/Toast 提示，绝不引导注册。
  // 记来源而非布尔：两处 402 的关闭语义不同 —— 整页取数失败关掉只能回首页（页面无内容），
  // 换词失败时页面主体（当前档位词组）还在，关掉应留在原页继续看。
  const [quotaShown, setQuotaShown] = useState<'page' | 'phrases' | null>(null)
  const [dailyLimitHit, setDailyLimitHit] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
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
      setLoading(true); setError(null); setDailyLimitHit(false)
      try {
        // POST 而非 GET：该接口扣额度 + 真调 AI，用 GET 会被浏览器预取 / 爬虫无意触发、白烧钱。
        // apiFetch 行为不变——非 2xx 不抛、返回原始 Response，故下面仍按 res.status 分流。
        const res = await apiFetch('/api/analysis', {
          method: 'POST',
          json: { questionId, storyId },
          signal: ac.signal,
        })
        // 服务端同意闸拒绝（403，未捕获同意）：深链直达本页时兜底，回首页触发同意弹窗，不裸报「生成分析失败」。
        // 分析是零红线环节（点进题目看到的全部内容），务必兜好而非停在错误态。
        if (res.status === 403) { if (!cancelled) router.push('/'); return }
        // 402 = 匿名试用额度用尽 → 转化点，弹注册引导覆盖层
        if (res.status === 402) { if (!cancelled) setQuotaShown('page'); return }
        // 429 = 注册用户当日上限 → 只告知「明天恢复」，不走 error 通道（其 CTA 是重试，点了还撞 429）
        if (res.status === 429) { if (!cancelled) setDailyLimitHit(true); return }
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
        // 同 /api/analysis：POST 而非 GET（扣额度 + 真调 AI，不能被预取无意触发）
        const res = await apiFetch('/api/analysis/phrases', {
          method: 'POST',
          json: { questionId, storyId, level: newLevel },
        })
        // 服务端同意闸拒绝（403）：回首页触发同意弹窗，不停在换词失败态。
        // 同样要回退档位：跳转是异步的，回退前这一帧（以及用户按浏览器返回退回本页时）
        // 档位不能停在换失败的新值上，否则与页面里没换成的词组内容对不上。
        if (res.status === 403) { setLevel(prevLevel); router.push('/'); return }
        // 402/429 必须在此判、不能等 catch —— catch 里拿不到 res.status。
        // 档位回退保留（状态不该与内容脱节），但必须配提示：否则用户点 7.0 → 档位自己跳回 6.0
        // → 内容一字未变 → 零反馈 → 以为按钮坏了反复点，每点一次烧一次 AI。
        if (res.status === 402) { setLevel(prevLevel); setQuotaShown('phrases'); return }
        if (res.status === 429) { setLevel(prevLevel); setToast('操作太频繁，今天先歇歇吧。明天会自动恢复。'); return }
        if (!res.ok) throw new Error('换词失败')
        const json = (await res.json()) as { phrases: AnalysisPhraseGroup[] }
        setData(prev => prev ? { ...prev, analysis: { ...prev.analysis, phrases: json.phrases } } : prev)
      } catch {
        setLevel(prevLevel)
        setToast(`没换成 ${newLevel}，还是 ${prevLevel} 的版本。再点一次试试？`)
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
    dailyLimitHit,
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
    onReviewCards: () => router.push('/review'),
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
      {/* 402 匿名试用额度用尽：引导注册。整页失败关掉回首页；换词失败关掉留在原页（词组内容还在） */}
      {quotaShown && (
        <QuotaReached
          variant="trial"
          asOverlay
          onClose={quotaShown === 'phrases' ? () => setQuotaShown(null) : () => router.push('/')}
        />
      )}
      {/* 换词失败/换词当日上限：页面主体内容仍可读，用 Toast 而非遮罩，不打断阅读 */}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  )
}

export default function AnalysisPage() {
  return <Suspense><AnalysisContent /></Suspense>
}
