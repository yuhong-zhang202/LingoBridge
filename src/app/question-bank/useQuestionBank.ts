/**
 * @module   useQuestionBank
 * @desc     题库数据统一加载 hook — 并行拉取六路数据，组装 QBQuestion / QBDimensionSummary
 * @author   LingoBridge
 * @created  2026-06-04
 */
'use client'
import { useState, useEffect } from 'react'
import { getDimensionScores, getDimensionProgress } from '@/lib/db/dimension-scores'
import { listMyCorpus, listMyObservationCodes } from '@/lib/db/corpus'
import { getQuestions } from '@/lib/db/questions'
import { listObservationPoints } from '@/lib/db/observation-points'
import { DIMENSION_LABEL } from '@/lib/constants'
import type { DimensionId, DimensionLabel, QBQuestion, QBDimensionSummary } from '@/lib/types'

const DIMENSION_ORDER: DimensionId[] = [
  'emotion', 'relationship', 'space', 'spirit', 'growth', 'value',
]

export interface UseQuestionBankReturn {
  loading: boolean
  error: string | null
  scoreById: Partial<Record<DimensionId, number>>
  progressById: Partial<Record<DimensionId, { lit: number; total: number }>>
  corpusCount: number
  mappedQuestions: QBQuestion[]
  dimensionSummaries: QBDimensionSummary[]
  totalMapped: number
  totalMatched: number
  availableParts: (1 | 2 | 3)[]
}

/**
 * 加载题库全部数据并组装为展示层类型
 * @returns  加载状态、错误、雷达图分数、维度进度、映射题目等
 */
export function useQuestionBank(): UseQuestionBankReturn {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scoreById, setScoreById] = useState<Partial<Record<DimensionId, number>>>({})
  const [progressById, setProgressById] = useState<Partial<Record<DimensionId, { lit: number; total: number }>>>({})
  const [corpusCount, setCorpusCount] = useState(0)
  const [mappedQuestions, setMappedQuestions] = useState<QBQuestion[]>([])
  const [dimensionSummaries, setDimensionSummaries] = useState<QBDimensionSummary[]>([])
  const [totalMapped, setTotalMapped] = useState(0)
  const [totalMatched, setTotalMatched] = useState(0)
  const [availableParts, setAvailableParts] = useState<(1 | 2 | 3)[]>([])

  useEffect(() => {
    Promise.all([
      getDimensionScores(),
      getDimensionProgress(),
      listMyCorpus(),
      listMyObservationCodes(),
      getQuestions(),
      listObservationPoints(),
    ]).then(([scores, progress, corpus, userCodes, allQuestions, obsPoints]) => {
      const scoreObj: Partial<Record<DimensionId, number>> = {}
      for (const s of scores) scoreObj[s.dimensionId] = s.score
      setScoreById(scoreObj)

      const progressObj: Partial<Record<DimensionId, { lit: number; total: number }>> = {}
      for (const p of progress) progressObj[p.dimensionId] = { lit: p.lit, total: p.total }
      setProgressById(progressObj)

      setCorpusCount(corpus.length)

      // code → dimensionId 映射
      const codeToDimId: Record<string, DimensionId> = {}
      for (const op of obsPoints) codeToDimId[op.code] = op.dimensionId

      const userCodeSet = new Set(userCodes)

      // 只保留有观察点映射的题（277 道），逐题组装
      const mapped: QBQuestion[] = allQuestions.flatMap((q) => {
        if (q.observation_points.length === 0) return []
        const primaryCode = q.observation_points[0]
        const dimId = codeToDimId[primaryCode]
        if (!dimId) return []
        const dimension: DimensionLabel = DIMENSION_LABEL[dimId]
        return [{
          id: q.id,
          part: q.part as 1 | 2 | 3,
          displayText: q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text,
          displayTextZh: q.part === 2 ? (q.cue_card_title_zh ?? q.question_text_zh) : q.question_text_zh,
          dimension,
          matched: q.observation_points.some((c) => userCodeSet.has(c)),
        }]
      })

      const matched = mapped.filter((q) => q.matched).length
      const parts = [...new Set(mapped.map((q) => q.part))].sort() as (1 | 2 | 3)[]

      // 按 6 维度固定顺序分组
      const summaries: QBDimensionSummary[] = DIMENSION_ORDER.map((dimId) => {
        const label = DIMENSION_LABEL[dimId]
        const qs = mapped.filter((q) => q.dimension === label)
        return { dimension: label, total: qs.length, matched: qs.filter((q) => q.matched).length, questions: qs }
      })

      setMappedQuestions(mapped)
      setDimensionSummaries(summaries)
      setTotalMapped(mapped.length)
      setTotalMatched(matched)
      setAvailableParts(parts)
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[useQuestionBank] 加载失败', e)
      setError(msg)
    }).finally(() => setLoading(false))
  }, [])

  return { loading, error, scoreById, progressById, corpusCount, mappedQuestions, dimensionSummaries, totalMapped, totalMatched, availableParts }
}
