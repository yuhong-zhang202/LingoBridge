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
import { updateCorpusCleaned } from '@/lib/db/corpus'
import { upsertMatch } from '@/lib/db/matches'
import { getSupabase } from '@/lib/supabase'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import RestructureMobile from './RestructureMobile'
import RestructureDesktop from './RestructureDesktop'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { RestructureViewProps } from './types'

/** 取当前 session 的 Bearer 头，供受保护 API 鉴权使用（无 session 时返回空对象） */
async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await getSupabase().auth.getSession()
  const token = session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

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
  const [aiText,     setAiText]     = useState('')
  // AI 产出的原始整理文本基准；aiText 与它不一致 = 用户编辑过（未保存）
  const [aiBaseline, setAiBaseline] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [usable,    setUsable]    = useState<boolean | null>(null)
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
      const res = await fetch('/api/restructure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ rawText: rawStory }),
        signal,
      })
      // 匿名整理次数超上限（402）：弹试用结束提示，不当作「整理失败」
      if (res.status === 402) { if (!signal?.aborted) setStoryQuotaReached(true); return }
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
      // 创建这一步服务端化（配额 + 落库防绕过）；后续整理/匹配/跳转仍走客户端 RLS
      const res = await fetch('/api/corpus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ source: 'voice', rawText: rawStory }),
      })
      if (res.status === 402) { setStoryQuotaReached(true); setIsSaving(false); return }
      if (!res.ok) throw new Error('语料保存失败，请重试')
      const { corpus } = (await res.json()) as { corpus: { id: string } }
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

  // 未保存 = 用户编辑过整理后文本；退出 / 重新整理前若有未保存内容先确认（仅桌面接线，移动端行为不变）。
  const hasUnsaved = aiText !== aiBaseline
  const [confirm, setConfirm] = useState<null | 'exit' | 'rerestructure'>(null)
  const doExit = () => router.push('/')
  const requestExit = () => { if (hasUnsaved) setConfirm('exit'); else doExit() }
  const requestReRestructure = () => { if (hasUnsaved) setConfirm('rerestructure'); else void reRestructure() }

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
