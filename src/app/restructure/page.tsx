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
import { takeHandoff, takeHandoffJson } from '@/lib/handoff'
import { updateCorpusCleaned, getCorpusById } from '@/lib/db/corpus'
import { upsertMatch } from '@/lib/db/matches'
import { getSupabase } from '@/lib/supabase'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import RestructureMobile from './RestructureMobile'
import RestructureDesktop from './RestructureDesktop'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { RestructureViewProps } from './types'

/** 结构化 handoff 形状：预检整理结果 { rawText, cleanedText } */
interface StructuredHandoff { rawText: string; cleanedText: string }
function isStructuredHandoff(v: unknown): v is StructuredHandoff {
  return typeof v === 'object' && v !== null
    && typeof (v as Record<string, unknown>).rawText === 'string'
    && typeof (v as Record<string, unknown>).cleanedText === 'string'
}

function RestructureContent() {
  const router   = useRouter()
  const params   = useSearchParams()
  const qid      = params.get('qid')
  // corpusId 存在 = 返回态（从 matching / analysis「返回上一步」进来）：忽略 handoff，改从 DB 水合真实语料。
  // 无 corpusId = 首程：故事正文（及可选预检整理结果）从 sessionStorage 一次性取（取完即删），URL 仅含短 id。
  const corpusId = params.get('corpusId')
  // 首程 handoff（仅无 corpusId 时读取；返回态置 null 不消费 sessionStorage）：
  // 新版结构化 handoff 携 { rawText, cleanedText }：直接进已整理态、跳过首次整理调用；
  // 旧版纯字符串 handoff（网络/非 402 错误兜底）仍原样读出，走自行整理。都无则回退 rawText / MOCK。
  const [handoff] = useState<{ rawStory: string; cleanedText: string | null } | null>(() => {
    if (corpusId) return null   // 返回态：不读 handoff，等下方 effect 从 DB 水合
    const h = params.get('h')
    if (h) {
      const j = takeHandoffJson(h, isStructuredHandoff)
      if (j) return { rawStory: j.rawText, cleanedText: j.cleanedText }
      const s = takeHandoff(h)   // 未通过校验时未消费，此处原样读出旧版纯文本
      if (s !== null) return { rawStory: s, cleanedText: null }
    }
    return { rawStory: params.get('rawText') ?? MOCK_RAW_STORY, cleanedText: null }
  })
  // rawStory 现为 state：返回态由 getCorpusById 异步水合；首程同步取自 handoff。
  const [rawStory,   setRawStory]   = useState(handoff?.rawStory ?? '')
  // 返回态先进加载态（等 DB 水合）；首程沿用 handoff 是否已带整理结果。
  const [isLoading,  setIsLoading]  = useState(corpusId ? true : handoff?.cleanedText == null)
  const [aiText,     setAiText]     = useState(handoff?.cleanedText ?? '')
  // AI 产出的原始整理文本基准；aiText 与它不一致 = 用户编辑过（未保存）
  const [aiBaseline, setAiBaseline] = useState(handoff?.cleanedText ?? '')
  const [isEditing, setIsEditing] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [usable,    setUsable]    = useState<boolean | null>(handoff?.cleanedText != null ? true : null)
  // 返回态 corpusId 水合失败 / 语料为 null：明确错误态 + 回首页出口，禁止沿用 MOCK 把「语料没了」伪装成陌生示例。
  const [loadError, setLoadError] = useState(false)
  // 首次 AI 整理待办：首程无整理结果即待办；返回态由水合按 cleanedText 是否为空决定。
  const [pendingRestructure, setPendingRestructure] = useState(corpusId ? false : handoff?.cleanedText == null)
  const [isSaving,  setIsSaving]  = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // 服务端额度超限（/api/corpus 或 /api/restructure 返回 402）→ 弹 QuotaReached 覆盖层
  const [storyQuotaReached, setStoryQuotaReached] = useState(false)
  // 匿名试用用户：额度提示走 trial 变体（引导注册），注册用户走 story 变体（月额度 10/10）
  const [isAnon, setIsAnon] = useState(false)
  useEffect(() => {
    void getSupabase().auth.getSession().then(({ data: { session } }) => {
      setIsAnon(session?.user?.is_anonymous ?? false)
    })
  }, [])

  const runRestructure = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setIsEditing(false)
    setError(null)
    setUsable(null)
    try {
      const res = await apiFetch('/api/restructure', {
        method: 'POST',
        json: { rawText: rawStory },
        signal,
      })
      // 匿名整理次数超上限（402）：弹试用结束提示，不当作「整理失败」
      if (res.status === 402) { if (!signal?.aborted) setStoryQuotaReached(true); return }
      // 服务端同意闸拒绝（403，未捕获同意）：深链直达本页时兜底，回首页触发同意弹窗，不卡在「整理失败」。
      if (res.status === 403) { if (!signal?.aborted) router.push('/'); return }
      if (!res.ok) throw new Error('整理失败')
      const data = (await res.json()) as { cleanedText: string; usable: boolean }
      if (signal?.aborted) return
      setAiText(data.cleanedText)
      setAiBaseline(data.cleanedText)
      setUsable(data.usable ?? true)
    } catch (e) {
      if (signal?.aborted) return          // 中断不算错误，忽略
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

  const handleMatchClick = useCallback(async (): Promise<void> => {
    setIsSaving(true)
    setSaveError(null)
    try {
      // corpus 幂等：返回态（corpusId 从 URL 水合）已有语料 → 跳过 POST，直接更新整理结果，
      // 保证全程一条语料、不重复建库、不多耗额度；首程无 corpusId → 照旧服务端创建（配额 + 落库防绕过）。
      let storyId = corpusId
      if (!storyId) {
        const res = await apiFetch('/api/corpus', {
          method: 'POST',
          json: { source: 'voice', rawText: rawStory },
        })
        if (res.status === 402) { setStoryQuotaReached(true); setIsSaving(false); return }
        // 服务端同意闸拒绝（403，未捕获同意）：回首页触发同意弹窗，不停在「语料保存失败」错误态。
        if (res.status === 403) { router.push('/'); return }
        if (!res.ok) throw new Error('语料保存失败，请重试')
        const { corpus } = (await res.json()) as { corpus: { id: string } }
        storyId = corpus.id
      }
      await updateCorpusCleaned(storyId, aiText)
      if (qid) {
        // 记录「已选」配对，让答过的语料出现在该题「练习题目」页；写库失败不阻断跳转（upsertMatch 本幂等）
        await upsertMatch(storyId, qid, 'chosen').catch((e) => console.error('[restructure] upsertMatch failed', e))
        router.push(`/analysis?questionId=${qid}&storyId=${storyId}&from=restructure`)   // 雅思流：跳过匹配，直达分析
      } else {
        router.push(`/matching?corpusId=${storyId}`)                    // 故事流：照旧去匹配
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '语料保存失败，请重试')
      setIsSaving(false)
    }
  }, [rawStory, aiText, qid, corpusId, router])

  // 未保存 = 用户编辑过整理后文本；退出 / 重新整理前若有未保存内容先确认（仅桌面接线，移动端行为不变）。
  const hasUnsaved = aiText !== aiBaseline
  const [confirm, setConfirm] = useState<null | 'exit' | 'rerestructure'>(null)
  const doExit = () => router.push('/')
  const requestExit = () => { if (hasUnsaved) setConfirm('exit'); else doExit() }
  const requestReRestructure = () => { if (hasUnsaved) setConfirm('rerestructure'); else void reRestructure() }

  // 返回态水合失败：不 MOCK 兜底，明确告知语料取不回 + 回首页出口。
  if (loadError) {
    return (
      <div className="min-h-dvh bg-bg-page flex flex-col items-center justify-center gap-5 px-8 text-center">
        <p className="text-[15px] text-v2-text-secondary leading-relaxed">没找到这条语料，可能已被删除或链接失效了。</p>
        <button
          onClick={() => router.push('/')}
          className="px-6 py-2.5 rounded-full bg-brand-primary text-white text-[14px] font-medium hover:opacity-90 transition-opacity"
        >
          回到首页
        </button>
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
    onExit: doExit,
  }

  return (
    <>
      <div className="lg:hidden"><RestructureMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 沉浸外壳（整理步激活）+ 两栏舞台。
          ✕ / Esc③ / 重新整理 都走 request*：编辑过未保存时先弹确认。 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="restructure" onExit={requestExit}>
          <RestructureDesktop {...viewProps} onExit={requestExit} onReRestructure={requestReRestructure} />
        </FlowShellDesktop>
        <ConfirmDialog
          open={confirm !== null}
          title="还没保存哦"
          description={confirm === 'rerestructure'
            ? '重新整理会用新的整理结果覆盖你刚改过的内容，确定吗？'
            : '你改过的内容还没保存，离开就没啦。确定要离开吗？'}
          confirmText={confirm === 'rerestructure' ? '重新整理' : '离开'}
          cancelText="留下继续"
          onConfirm={() => { const c = confirm; setConfirm(null); if (c === 'exit') doExit(); else void reRestructure() }}
          onCancel={() => setConfirm(null)}
        />
      </div>
      {/* 额度超限覆盖层：匿名走 trial（引导注册）、注册走 story（月额度）；关闭即回首页 */}
      {storyQuotaReached && <QuotaReached variant={isAnon ? 'trial' : 'story'} asOverlay onClose={() => router.push('/')} />}
    </>
  )
}

export default function RestructurePage() {
  return <Suspense><RestructureContent /></Suspense>
}
