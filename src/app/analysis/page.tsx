/**
 * @module   AnalysisPage
 * @desc     题目侧重点分析页 — AI 生成考官侧重点与句式框架，选题后跳转练习
 * @author   LingoBridge
 * @created  2026-05-28
 */
'use client'
import { Suspense, useEffect, useState, type ReactNode, type CSSProperties } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Target, Type } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import { StepBar } from '@/components/StepBar'
import PartTag from '@/components/PartTag'
import type { AnalysisResponse } from '@/lib/types'

const GRAD_BORDER = 'linear-gradient(135deg, rgba(232,136,58,0.35), rgba(123,191,116,0.35))'
const GRAD_NUM    = 'linear-gradient(135deg, rgba(232,136,58,0.40), rgba(123,191,116,0.40))'
const LIGHTER_BORDER: CSSProperties = {
  background: 'linear-gradient(white,white) padding-box,linear-gradient(135deg,rgba(232,136,58,0.35),rgba(123,191,116,0.35)) border-box',
  border: '1.5px solid transparent',
}

/** 句式填空 [xxx] 渲染为绿色加粗 */
function HighlightSentence({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]+\])/).map((part, i) =>
        part.startsWith('[')
          ? <span key={i} className="font-semibold text-[#4A8A45]">{part}</span>
          : part
      )}
    </>
  )
}

/** 序号圆圈：外层极淡渐变描边 + 内层白底 + 灰色数字 */
function StepNum({ n }: { n: number }) {
  return (
    <div style={{ background: GRAD_NUM, padding: 1, borderRadius: '50%', width: 20, height: 20, flexShrink: 0 }}>
      <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
        <span className="text-[11px] font-bold leading-none text-[#A0A09A]">{n}</span>
      </div>
    </div>
  )
}

/** 渐变描边卡片 — 极淡 1px 渐变 border + 白底内层 */
function GradCard({ children }: { children: ReactNode }) {
  return (
    <div className="shadow-[0_2px_12px_rgba(0,0,0,0.06)]" style={{ background: GRAD_BORDER, padding: 1, borderRadius: 21 }}>
      <div className="bg-white rounded-[20px] px-[22px] pt-[16px] pb-[22px]">{children}</div>
    </div>
  )
}

function AnalysisContent() {
  const router     = useRouter()
  const params     = useSearchParams()
  const questionId = params.get('questionId') ?? ''
  const storyId    = params.get('storyId') ?? '1'
  const [data, setData]       = useState<AnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!questionId) { setLoading(false); setError('缺少题目'); return }
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const res = await fetch(`/api/analysis?questionId=${encodeURIComponent(questionId)}`)
        if (!res.ok) throw new Error('生成分析失败')
        const json = (await res.json()) as AnalysisResponse
        if (!cancelled) setData(json)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '生成分析失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [questionId])

  return (
    <div
      className="relative flex flex-col bg-bg-page overflow-hidden"
      style={{ height: '100dvh', paddingBottom: 'calc(56px + env(safe-area-inset-bottom))' }}
    >
      <TopBar title="题目分析" />
      <StepBar currentStep="analysis" />

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-8 relative z-10 flex flex-col gap-4">

        {loading && <div className="text-center text-[14px] text-v2-text-muted py-20">AI 分析中…</div>}
        {!loading && error && <div className="text-center text-[14px] text-v2-text-muted py-20">{error}</div>}

        {!loading && !error && data && (
          <>
            {/* 题目卡片 */}
            <div className="card px-[22px] pt-[16px] pb-[22px]">
              <div className="flex items-center gap-2 mb-2.5">
                <PartTag label={`Part ${data.question.part}`} />
                {data.question.dimension && (
                  <span className="text-[10px] font-medium bg-[#EDF6EB] border border-[#C0DDB9] text-[#3D7A38] px-[8px] py-[3px] rounded-full">
                    {data.question.dimension}
                  </span>
                )}
                {data.question.isNew && (
                  <span className="text-[10px] font-medium bg-[#EDF6EB] border border-[#C0DDB9] text-[#3D7A38] px-[8px] py-[3px] rounded-full">
                    当季新题
                  </span>
                )}
              </div>
              <p className="text-[14px] font-medium text-[#1A1A1A] leading-[1.6] mb-1">{data.question.en}</p>
              <p className="text-[12px] text-[#888888]">{data.question.zh}</p>
            </div>

            {/* 答题侧重点 */}
            <GradCard>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <Target size={13} className="text-brand-primary" />
                  <span className="text-[13px] font-semibold text-[#444]">答题侧重点</span>
                </div>
                {data.analysis.structureLabel && (
                  <span className="text-[10px] text-v2-text-muted font-medium">{data.analysis.structureLabel}</span>
                )}
              </div>
              <div className="flex flex-col gap-3">
                {data.analysis.focusPoints.map((fp, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <StepNum n={i + 1} />
                    <div className="flex-1 pt-[1px]">
                      <p className="text-[14px] font-medium text-[#1A1A1A] leading-[1.6]">{fp.title}</p>
                      <p className="text-[12px] text-[#888888] mt-0.5 leading-relaxed">{fp.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </GradCard>

            {/* 可用句式框架 */}
            <GradCard>
              <div className="flex items-center gap-1.5 mb-3">
                <Type size={13} className="text-brand-accent" />
                <span className="text-[13px] font-semibold text-[#444]">可用句式框架</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {data.analysis.sentenceFrames.map((sf, i) => (
                  <div key={i} className="bg-[#F8F7F5] rounded-[10px] px-4 py-3">
                    <p className="text-[14px] text-[#1A1A1A] leading-[1.6]"><HighlightSentence text={sf.text} /></p>
                    {sf.tip && <p className="text-[12px] text-[#888888] mt-1.5">{sf.tip}</p>}
                  </div>
                ))}
              </div>
            </GradCard>

            <button
              className="flex items-center justify-center gap-1.5 w-full px-5 py-2.5 rounded-full text-[14px] font-semibold text-[#444] active:scale-[0.97] transition-transform duration-150"
              style={LIGHTER_BORDER}
              onClick={() => router.push(`/practice?questionId=${questionId}&storyId=${storyId}`)}
            >
              开始练习 →
            </button>
          </>
        )}
      </div>

      <TabBar />
    </div>
  )
}

export default function AnalysisPage() {
  return <Suspense><AnalysisContent /></Suspense>
}
