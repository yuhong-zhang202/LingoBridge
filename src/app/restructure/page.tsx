/**
 * @module   RestructurePage
 * @desc     AI 整理确认页 — 展示原始语料与 AI 整理结果，支持编辑后进入题目匹配
 * @author   LingoBridge
 * @created  2026-05-28
 */
'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Quote, Sparkles, Pencil, Check, RefreshCw, Lightbulb } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import Card from '@/components/Card'
import { StepBar } from '@/components/StepBar'
import Orb from '@/components/Orb'
import Chip from '@/components/Chip'
import GradientButton from '@/components/GradientButton'
import { MOCK_RAW_STORY } from '@/data/restructure'
import { takeHandoff } from '@/lib/handoff'
import { createCorpus, updateCorpusCleaned } from '@/lib/db/corpus'
import { upsertMatch } from '@/lib/db/matches'
import { useAsyncAction } from '@/hooks/useAsyncAction'

function AiResultCard({ text, isEditing, onToggleEdit, onChange }: {
  text: string; isEditing: boolean; onToggleEdit: () => void; onChange: (v: string) => void
}) {
  return (
    <Card variant="gradient" className="px-5 pt-4 pb-5">
      {isEditing ? (
        <textarea
          value={text}
          onChange={e => onChange(e.target.value)}
          className="w-full min-h-[110px] text-[14px] text-v2-text-primary leading-relaxed bg-bg-inner rounded-[12px] px-3 py-2.5 outline-none resize-none focus:ring-1 focus:ring-brand-primary/30"
          autoFocus
        />
      ) : (
        <p className="text-[14px] text-v2-text-primary leading-relaxed">{text}</p>
      )}
      <div className="flex justify-end mt-2">
        <Chip onClick={onToggleEdit} variant="default">
          {isEditing ? <><Check size={12} />完成</> : <><Pencil size={12} />编辑</>}
        </Chip>
      </div>
    </Card>
  )
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

  async function handleMatchClick(): Promise<void> {
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
  }

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      <TopBar title="整理确认" />
      <StepBar currentStep="restructure" />

      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-[88px] relative z-10 flex flex-col gap-4 lg:max-w-5xl lg:mx-auto lg:w-full lg:px-10 lg:pb-10">

        {/* 桌面端：原话 | 整理后 两栏（参照 web.html restructure-view）；移动端仍单列堆叠 */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">

        {/* 原始语料卡片（左栏） */}
        <Card className="px-5 pt-4 pb-5">
          <div className="flex items-center gap-1.5 mb-2.5">
            <Quote size={13} className="text-v2-text-muted" />
            <span className="text-[11px] font-medium text-v2-text-muted">素材录入</span>
          </div>
          <p className="text-[14px] text-v2-text-secondary leading-relaxed">{rawStory}</p>
        </Card>

        {/* 右栏：过渡 + AI 整理结果 */}
        <div className="flex flex-col gap-4">

        {/* 过渡区（桌面两栏下隐藏） */}
        <div className="flex items-center gap-2 px-1 lg:hidden">
          <div className="flex-1 h-px bg-bg-muted" />
          <Sparkles size={12} className="text-v2-text-muted" />
          <span className="text-[11px] text-v2-text-muted">语料梳理</span>
          <div className="flex-1 h-px bg-bg-muted" />
        </div>

        {/* AI 整理结果 / 加载态 / 错误态 */}
        {isLoading ? (
          <div className="flex flex-col items-center py-6 gap-3">
            <Orb size={120} />
            <p className="text-[13px] text-v2-text-muted">AI 整理中…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-6 gap-3">
            <p className="text-[13px] text-red-400">{error}</p>
            <button
              onClick={() => void reRestructure()}
              className="flex items-center gap-1.5 text-[13px] text-v2-text-muted active:opacity-70"
            >
              <RefreshCw size={13} />重试
            </button>
          </div>
        ) : (
          <>
            <AiResultCard
              text={aiText}
              isEditing={isEditing}
              onToggleEdit={() => setIsEditing(v => !v)}
              onChange={setAiText}
            />
            {usable === false && (
              <p className="text-[12px] text-v2-text-muted text-center px-2 leading-relaxed">
                这段内容可以再丰富一些，补充些细节后面练习效果会更好；当然也可以直接继续 ✨
              </p>
            )}
            <div className="px-0.5 mt-[18px]">
              <div className="flex items-center gap-1.5 mb-2.5">
                <Lightbulb size={13} className="text-brand-primary" />
                <span className="text-[13px] font-medium text-v2-text-secondary">怎样的素材更好用</span>
              </div>
              <div className="flex items-start gap-2.5 mb-2">
                <span className="flex-shrink-0 w-[18px] h-[18px] rounded-full border border-brand-primary-light bg-phrase-warm-bg flex items-center justify-center text-[11px] text-brand-primary-dark mt-[1px]">1</span>
                <p className="text-[13px] text-v2-text-secondary leading-relaxed">同一段真实经历，细节越全，能套用的题越多</p>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-[18px] h-[18px] rounded-full border border-brand-primary-light bg-phrase-warm-bg flex items-center justify-center text-[11px] text-brand-primary-dark mt-[1px]">2</span>
                <p className="text-[13px] text-v2-text-secondary leading-relaxed">好用的素材通常会带到：时间、人物、发生的事、你的做法和感受</p>
              </div>
            </div>

            <div className="pt-1">
              {saveError && (
                <p className="text-[12px] text-red-400 text-center mb-2">{saveError}</p>
              )}
              <GradientButton
                onClick={() => void handleMatchClick()}
                disabled={isSaving}
                className="flex items-center justify-center gap-1.5 w-full px-6 py-3 rounded-full text-[14px] font-medium mb-3"
              >
                {isSaving ? '保存中…' : qid ? '开始分析 →' : '开始匹配题目 →'}
              </GradientButton>
              <button
                className="w-full flex items-center justify-center gap-1.5 text-[13px] text-v2-text-muted active:opacity-70 transition-opacity"
                onClick={() => void reRestructure()}
              >
                <RefreshCw size={13} />重新整理
              </button>
            </div>
          </>
        )}
        </div>{/* /右栏 */}
        </div>{/* /两栏 wrapper */}
      </div>

      {/* 流程页桌面端沉浸：隐藏侧栏 */}
      <div className="flex-shrink-0 lg:hidden"><TabBar /></div>
    </div>
  )
}

export default function RestructurePage() {
  return <Suspense><RestructureContent /></Suspense>
}
