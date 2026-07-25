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
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useNav } from '@/components/NavProgress'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
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
      // 匿名整理次数超上限（402）：弹试用结束提示，不当作「整理失败」。
      // /api/restructure 402 匿名 only、不带 reason → readQuotaReason 返回 null → 走 trial（引导注册）。
      if (res.status === 402) {
        const reason = await readQuotaReason(res)
        if (!signal?.aborted) setStoryQuota(reason === 'story' ? 'story' : 'trial')
        return
      }
      // 服务端同意闸拒绝（403，未捕获同意）：深链直达本页时兜底，回首页触发同意弹窗，不卡在「整理失败」。
      if (res.status === 403) { if (!signal?.aborted) router.push('/'); return }
      if (!res.ok) throw new Error('整理失败')
      const data = (await res.json()) as { cleanedText: string; usable: boolean; summary?: string }
      if (signal?.aborted) return
      setAiText(data.cleanedText)
      setAiBaseline(data.cleanedText)
      setUsable(data.usable ?? true)
      setSummary(typeof data.summary === 'string' ? data.summary : null)
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
        // 建语料 402：reason 决定变体——匿名总条数闸 trial（注册引导）/ 注册月额度闸 story（月额度用完）。
        if (res.status === 402) {
          const reason = await readQuotaReason(res)
          setStoryQuota(reason === 'story' ? 'story' : 'trial')
          setIsSaving(false)
          return
        }
        // 服务端同意闸拒绝（403，未捕获同意）：回首页触发同意弹窗，不停在「语料保存失败」错误态。
        if (res.status === 403) { router.push('/'); return }
        if (!res.ok) throw new Error('语料保存失败，请重试')
        const { corpus } = (await res.json()) as { corpus: { id: string } }
        storyId = corpus.id
      }
      // summary 非空才随本次保存写入；null（旧兜底路径/返回态未重算）→ 不传，不覆盖 DB 已有概括。
      await updateCorpusCleaned(storyId, aiText, summary ?? undefined)
      // navigate（非 router.push）：保存完成到目标页（分析/匹配均为 AI 环节、非瞬时）跳转期间亮顶部条，
      // 与按钮「保存中…」spinner 接力，全程有反馈。
      if (qid) {
        // 记录「已选」配对，让答过的语料出现在该题「练习题目」页；写库失败不阻断跳转（upsertMatch 本幂等）
        await upsertMatch(storyId, qid, 'chosen').catch((e) => console.error('[restructure] upsertMatch failed', e))
        navigate(`/analysis?questionId=${qid}&storyId=${storyId}&from=restructure`)   // 雅思流：跳过匹配，直达分析
      } else {
        navigate(`/matching?corpusId=${storyId}`)                    // 故事流：照旧去匹配
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '语料保存失败，请重试')
      setIsSaving(false)
    }
  }, [rawStory, aiText, summary, qid, corpusId, router, navigate])

  // 未保存 = 用户编辑过整理后文本；「重新整理」会覆盖这些改动，故仅该动作按 hasUnsaved 决定是否先确认。
  const hasUnsaved = aiText !== aiBaseline
  const [confirm, setConfirm] = useState<null | 'exit' | 'rerestructure'>(null)
  const doExit = () => router.push('/')
  // 退出（移动端返回键 / 桌面 ✕ / Esc）一律先弹确认：此页的语料尚未落库，直接离开等于丢弃本次输入，
  // 无论是否编辑过整理结果都要问一句。确认才回首页，取消留在本页（数据全在 state，不受影响）。
  const requestExit = () => setConfirm('exit')
  const requestReRestructure = () => { if (hasUnsaved) setConfirm('rerestructure'); else void reRestructure() }

  // 语料取不回（返回态水合失败 / 首程 handoff 已被消费且 URL 无 rawText）：不拿示例故事兜底，
  // 明确告知取不回 + 回首页出口，两种来源共用同一错误态与文案。
  if (loadError) {
    return (
      <div className="min-h-dvh bg-bg-page flex flex-col items-center justify-center gap-5 px-8 text-center">
        <p className="text-[15px] text-v2-text-secondary leading-relaxed">没找到这条语料，可能已被删除或链接失效了。</p>
        <GradientButton
          onClick={() => router.push('/')}
          className="px-6 py-2.5 rounded-full text-[14px] font-medium"
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
      {storyQuota && <QuotaReached variant={storyQuota} asOverlay onClose={() => router.push('/')} />}
    </>
  )
}

export default function RestructurePage() {
  return <Suspense><RestructureContent /></Suspense>
}
