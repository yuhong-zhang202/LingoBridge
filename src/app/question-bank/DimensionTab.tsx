/**
 * @module   DimensionTab
 * @desc     维度设计 Tab — 雷达图 + 统计 + 六维度折叠面板（真实数据版）
 * @author   LingoBridge
 * @created  2026-06-01
 */
'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, CheckCircle2, Circle } from 'lucide-react'
import { DIMENSION_SUMMARIES } from '@/data/questionBank'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import type { DimensionLabel as Dimension, DimensionId } from '@/lib/types'
import { getDimensionScores, getDimensionProgress } from '@/lib/db/dimension-scores'
import { listMyCorpus } from '@/lib/db/corpus'
import RadarChart from './RadarChart'

const DIM_CLR: Record<Dimension, string> = {
  '情绪内核': '#D4875A', '人际羁绊': '#7BA699', '空间感知': '#9A7DB8',
  '精神栖所': '#C4965A', '成长演进': '#5BA08A', '价值底色': '#888888',
}

// 中文维度名 → 数据库英文 id 映射
const DIM_EN: Record<Dimension, DimensionId> = {
  '情绪内核': 'emotion', '人际羁绊': 'relationship', '空间感知': 'space',
  '精神栖所': 'spirit', '成长演进': 'growth', '价值底色': 'value',
}

// 题目匹配保留假数据（题库匹配功能尚未接入）
const totalQ = DIMENSION_SUMMARIES.reduce((s, d) => s + d.total, 0)
const totalM = DIMENSION_SUMMARIES.reduce((s, d) => s + d.matched, 0)

const CARD_GRAD = { background: 'linear-gradient(135deg,rgba(240,188,160,0.35),rgba(168,210,196,0.35))', borderRadius: 21, padding: 1 }

export default function DimensionTab() {
  const router = useRouter()
  const [open, setOpen] = useState<Dimension | null>(null)

  // 真实数据 state（默认 0 占位，雷达图自然塌到中心）
  const [scoreById, setScoreById] = useState<Partial<Record<DimensionId, number>>>({})
  const [progressById, setProgressById] = useState<Partial<Record<DimensionId, { lit: number; total: number }>>>({})
  const [corpusCount, setCorpusCount] = useState(0)

  useEffect(() => {
    Promise.all([
      getDimensionScores(),
      getDimensionProgress(),
      listMyCorpus(),
    ]).then(([scores, progress, corpus]) => {
      setScoreById(Object.fromEntries(scores.map((s) => [s.dimensionId, s.score])))
      setProgressById(Object.fromEntries(progress.map((p) => [p.dimensionId, { lit: p.lit, total: p.total }]))
      )
      setCorpusCount(corpus.length)
    }).catch((e: unknown) => {
      console.error('[DimensionTab] 加载真实数据失败', e)
    })
  }, [])

  // 按真实亮灯数降序排列，0 的排到后面
  const sorted = [...DIMENSION_SUMMARIES].sort((a, b) => {
    const litA = progressById[DIM_EN[a.dimension]]?.lit ?? 0
    const litB = progressById[DIM_EN[b.dimension]]?.lit ?? 0
    return litB - litA
  })

  // 维度覆盖：至少有 1 个亮灯观察点的维度数
  const dimsCov = DIMENSION_SUMMARIES.filter(
    (d) => (progressById[DIM_EN[d.dimension]]?.lit ?? 0) > 0,
  ).length

  return (
    <div className="flex flex-col gap-3">
      <div style={CARD_GRAD}>
        <div className="bg-white rounded-[20px] px-4 pt-4 pb-3">
          <RadarChart dimensions={DIMENSION_SUMMARIES.map(d => ({
            name: d.dimension,
            value: scoreById[DIM_EN[d.dimension]] ?? 0,
          }))} />
          <div className="border-t border-black/[0.04] mt-2 pt-3 flex items-center justify-between">
            <div className="text-center flex-1"><p className="text-[18px] font-semibold text-[#2C2420]">{corpusCount}</p><p className="text-[10px] text-[#A89990]">条语料</p></div>
            <div className="w-px h-7 bg-black/[0.06]" />
            <div className="text-center flex-1"><p className="text-[18px] font-semibold text-[#2C2420]">{dimsCov}<span className="text-[11px] font-normal text-[#A89990]"> / 6</span></p><p className="text-[10px] text-[#A89990]">维度覆盖</p></div>
            <div className="w-px h-7 bg-black/[0.06]" />
            <div className="text-center flex-1"><p className="text-[18px] font-semibold text-[#2C2420]">{totalM}<span className="text-[11px] font-normal text-[#A89990]"> / {totalQ}</span></p><p className="text-[10px] text-[#A89990]">题目匹配</p></div>
          </div>
        </div>
      </div>

      {sorted.map(summary => {
        const dimId = DIM_EN[summary.dimension]
        const lit = progressById[dimId]?.lit ?? 0
        const total = progressById[dimId]?.total ?? 0
        const hasMatch = lit > 0
        const isOpen = open === summary.dimension
        return (
          <div key={summary.dimension} className={`rounded-[16px] overflow-hidden ${!hasMatch ? 'border border-black/[0.05]' : ''}`} style={hasMatch ? GRADIENT_BORDER_STYLE : undefined}>
            <button className="w-full flex items-center justify-between px-4 py-3" onClick={() => setOpen(isOpen ? null : summary.dimension)}>
              <div className="flex items-center gap-2">
                <div className="w-[3px] h-[16px] rounded-full flex-shrink-0" style={{ background: hasMatch ? DIM_CLR[summary.dimension] : '#DDD' }} />
                <span className={`text-[14px] font-semibold ${hasMatch ? 'text-v2-text-primary' : 'text-[#BBB]'}`}>{summary.dimension}</span>
                <span className="text-[12px] text-v2-text-muted ml-1">{lit}/{total}</span>
              </div>
              <ChevronDown size={14} className={`text-v2-text-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && [...summary.questions].sort((a, b) => Number(b.matched) - Number(a.matched)).map(q => (
              <div key={q.id} className="flex items-center gap-2.5 px-4 py-2.5 border-t border-black/[0.04]">
                {q.matched ? <CheckCircle2 size={14} className="text-brand-accent flex-shrink-0" /> : <Circle size={14} className="text-[#DDD] flex-shrink-0" />}
                <p className={`flex-1 text-[12px] leading-snug ${q.matched ? 'text-v2-text-primary' : 'text-[#BBB]'}`}>{q.en}</p>
                {q.matched && <button onClick={() => router.push(`/analysis?questionId=${q.id}&storyId=1`)} style={GRADIENT_BORDER_STYLE} className="text-[11px] font-medium text-[#444] px-[10px] py-[3px] rounded-full flex-shrink-0">练习 →</button>}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
