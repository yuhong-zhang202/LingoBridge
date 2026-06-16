/**
 * @module   AnalysisPage
 * @desc     题目侧重点分析页 — AI 生成考官侧重点与句式框架，选题后跳转练习
 * @author   LingoBridge
 * @created  2026-05-28
 */
'use client'
import { Suspense, useEffect, useState, type ReactNode, type CSSProperties } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Target, Type, ChevronDown, Check, Star } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import { StepBar } from '@/components/StepBar'
import PartTag from '@/components/PartTag'
import type { AnalysisResponse, AnalysisPhraseGroup, AnalysisPhrase } from '@/lib/types'
import { getSavedWords, addSavedWord, removeSavedWord } from '@/lib/storage'
import PhraseDetailCard from '@/components/analysis/PhraseDetailCard'

const GRAD_BORDER = 'linear-gradient(135deg, rgba(232,136,58,0.35), rgba(123,191,116,0.35))'
const GRAD_NUM    = 'linear-gradient(135deg, rgba(232,136,58,0.40), rgba(123,191,116,0.40))'
const LIGHTER_BORDER: CSSProperties = {
  background: 'linear-gradient(white,white) padding-box,linear-gradient(135deg,rgba(232,136,58,0.35),rgba(123,191,116,0.35)) border-box',
  border: '1.5px solid transparent',
}

/** 词组分组配色：按组循环（暖 / 中性 / 绿），浅柔色调 */
const PHRASE_CHIP_STYLES = [
  'bg-[#FAEEDA] text-[#8A5320] border-[#EFDCBE]',
  'bg-[#F4F2EC] text-[#6B5B52] border-black/[0.05]',
  'bg-[#EAF3DE] text-[#3B6D11] border-[#C8DDB9]',
]

/** 可选雅思口语目标水平 */
const LEVELS = ['5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0']


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
    <div className="shadow-[0_2px_12px_rgba(0,0,0,0.06)]" style={{ background: GRAD_BORDER, padding: 1, borderRadius: 17 }}>
      <div className="bg-white rounded-[16px] px-[22px] pt-[16px] pb-[22px]">{children}</div>
    </div>
  )
}

function AnalysisContent() {
  const router     = useRouter()
  const params     = useSearchParams()
  const questionId = params.get('questionId') ?? ''
  const storyId    = params.get('storyId') ?? ''
  const [data, setData]       = useState<AnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [openPhrase, setOpenPhrase] = useState<string | null>(null)
  const [level, setLevel] = useState('6.0')
  const [levelMenuOpen, setLevelMenuOpen] = useState(false)
  const [phrasesLoading, setPhrasesLoading] = useState(false)
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!questionId) { setLoading(false); setError('缺少题目'); return }
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const res = await fetch(`/api/analysis?questionId=${encodeURIComponent(questionId)}&storyId=${encodeURIComponent(storyId)}`)
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

  function changeLevel(newLevel: string) {
    const prevLevel = level
    setLevel(newLevel)
    setOpenPhrase(null)
    setPhrasesLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/analysis/phrases?questionId=${encodeURIComponent(questionId)}&storyId=${encodeURIComponent(storyId)}&level=${encodeURIComponent(newLevel)}`)
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

  useEffect(() => {
    setSavedSet(new Set(getSavedWords().map(w => w.text)))
  }, [])

  function toggleSave(item: AnalysisPhrase, group: string) {
    const isSaved = getSavedWords().some(w => w.text === item.text)
    if (isSaved) {
      removeSavedWord(item.text)
    } else {
      addSavedWord({
        id: item.text,
        text: item.text,
        meaning: item.meaning,
        scene: item.scene,
        group,
        level,
        questionEn: data?.question.en ?? '',
        createdAt: new Date().toISOString(),
      })
    }
    setSavedSet(new Set(getSavedWords().map(w => w.text)))
  }

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
                  <span className="text-[11px] font-medium bg-[#EDF6EB] border border-[#C0DDB9] text-[#3D7A38] px-[10px] py-[5px] rounded-full">
                    {data.question.dimension}
                  </span>
                )}
                {data.question.isNew && (
                  <span className="text-[11px] font-medium bg-[#EDF6EB] border border-[#C0DDB9] text-[#3D7A38] px-[10px] py-[5px] rounded-full">
                    当季新题
                  </span>
                )}
              </div>
              <p className="text-[14px] font-medium text-[#1A1A1A] leading-[1.6] mb-1">{data.question.en}</p>
              <p className="text-[12px] text-[#888888]">{data.question.zh}</p>
            </div>

            {/* 答题侧重点 */}
            <GradCard>
              <div className="flex items-center gap-1.5 mb-2">
                <Target size={13} className="text-brand-primary" />
                <span className="text-[13px] font-semibold text-[#444]">答题侧重点</span>
              </div>
              {data.analysis.structureLabel && (
                <p className="text-[11px] text-v2-text-muted font-medium leading-[1.7] mb-4">{data.analysis.structureLabel}</p>
              )}
              <div className="flex flex-col gap-4">
                {data.analysis.focusPoints.map((fp, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <StepNum n={i + 1} />
                    <div className="flex-1 pt-[1px]">
                      <p className="text-[14px] font-medium text-[#1A1A1A] leading-[1.6]">{fp.title}</p>
                      <p className="text-[12px] text-[#888888] mt-1 leading-relaxed">{fp.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </GradCard>

            {/* 可用词组（按答案分段分组，可直接取用） */}
            <GradCard>
              <div className="flex items-center gap-1.5 mb-3">
                <Type size={13} className="text-brand-accent" />
                <span className="text-[13px] font-semibold text-[#444]">可用词组</span>
                <div className="relative ml-auto">
                  <button
                    onClick={() => setLevelMenuOpen(v => !v)}
                    disabled={phrasesLoading}
                    className="flex items-center gap-1 text-[12px] text-[#8A5320] bg-white border border-[#EFDCBE] rounded-full pl-2.5 pr-1.5 py-[4px] leading-none active:scale-[0.97] transition-transform duration-150 disabled:opacity-50"
                  >
                    雅思 {level}
                    <ChevronDown size={13} className={`transition-transform duration-150 ${levelMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {levelMenuOpen && (
                    <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-[110px] bg-white border border-black/[0.08] rounded-[14px] p-1.5 shadow-[0_6px_20px_rgba(0,0,0,0.10)]">
                      <p className="text-[11px] text-[#A89990] px-2.5 pt-0.5 pb-1">目标水平</p>
                      {LEVELS.map(lv => (
                        <button
                          key={lv}
                          onClick={() => { setLevelMenuOpen(false); if (lv !== level) changeLevel(lv) }}
                          className={`flex items-center w-full text-[13px] px-2.5 py-[7px] rounded-[9px] active:bg-[#F4F2EC] ${lv === level ? 'text-[#B5663A] font-medium' : 'text-[#4B4540]'}`}
                        >
                          {lv}
                          {lv === level && <Check size={13} className="ml-auto text-brand-primary" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {phrasesLoading ? (
                <p className="text-[12px] text-v2-text-muted text-center py-4">正在按雅思 {level} 出词组…</p>
              ) : (
              <div className="flex flex-col gap-3.5">
                {(data.analysis.phrases ?? []).map((g, gi) => {
                  const [og, oi] = openPhrase ? openPhrase.split('-').map(Number) : [-1, -1]
                  const openItem = og === gi ? g.items[oi] : null
                  return (
                    <div key={gi}>
                      <p className="text-[11px] font-medium text-[#888888] mb-2">{g.group}</p>
                      <div className="flex flex-wrap gap-2">
                        {g.items.map((p, ii) => {
                          const isOpen = openPhrase === `${gi}-${ii}`
                          return (
                            <button
                              key={ii}
                              onClick={() => setOpenPhrase(isOpen ? null : `${gi}-${ii}`)}
                              className={`text-[13px] rounded-full px-[11px] py-[5px] leading-[1.3] border whitespace-nowrap active:scale-[0.97] transition-transform duration-150 ${PHRASE_CHIP_STYLES[gi % PHRASE_CHIP_STYLES.length]} ${isOpen ? 'ring-2 ring-brand-primary/25' : ''}`}
                            >
                              {p.text}
                              {savedSet.has(p.text) && (
                                <Star size={11} className="inline-block ml-1 -mt-[2px] align-middle fill-brand-primary text-brand-primary" />
                              )}
                            </button>
                          )
                        })}
                      </div>
                      {openItem && (
                        <div className="mt-2.5">
                          <PhraseDetailCard
                            text={openItem.text}
                            meaning={openItem.meaning}
                            scene={openItem.scene}
                            isSaved={savedSet.has(openItem.text)}
                            onToggleSave={() => toggleSave(openItem, g.group)}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              )}
            </GradCard>

            <button
              className="flex items-center justify-center gap-1.5 w-full px-5 py-2.5 rounded-full text-[14px] font-semibold text-[#444] active:scale-[0.97] transition-transform duration-150"
              style={LIGHTER_BORDER}
              onClick={() => router.push(`/practice?questionId=${questionId}&storyId=${storyId}&level=${level}`)}
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
