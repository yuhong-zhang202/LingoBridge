/**
 * @module   matching
 * @desc     题目匹配服务 — 故事萃取观察点 → 按观察点取真实题目（服务端）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import 'server-only'
import { extractCorpus, type ExtractionPick } from '@/services/extraction'
import { getQuestionsByObservation } from '@/lib/db/questions'
import { listObservationPoints } from '@/lib/db/observation-points'
import { DIMENSION_LABEL } from '@/lib/constants'
import type { MatchResult, MatchedPoint, MatchedQuestion } from '@/lib/types'

/**
 * 根据故事文本做真实反向匹配
 * @param cleanedText  整理后的中文故事
 * @returns            主/副观察点 + 匹配到的真实题目列表
 */
export async function matchByStory(cleanedText: string): Promise<MatchResult> {
  // 1. 萃取观察点（主 + 副）
  const extraction = await extractCorpus(cleanedText)

  // 2. 观察点元信息（code → name + dimensionId）
  const points = await listObservationPoints()
  const pointMeta = new Map(points.map((p) => [p.code, p]))

  function toMatchedPoint(pick: ExtractionPick | null): MatchedPoint | null {
    if (!pick) return null
    const meta = pointMeta.get(pick.pointCode)
    return {
      pointCode: pick.pointCode,
      pointName: meta?.name ?? pick.pointCode,
      dimension: meta ? DIMENSION_LABEL[meta.dimensionId] : '情绪内核',
      reason: pick.reason,
    }
  }

  const primary = toMatchedPoint(extraction.primary)
  const secondary = toMatchedPoint(extraction.secondary)

  // 3. 按观察点取题，主维度优先，合并去重
  const seen = new Set<string>()
  const questions: MatchedQuestion[] = []

  async function collect(mp: MatchedPoint | null): Promise<void> {
    if (!mp) return
    const qs = await getQuestionsByObservation(mp.pointCode)
    qs.sort((a, b) => a.part - b.part) // Part 1 → 2
    for (const q of qs) {
      if (seen.has(q.id)) continue
      seen.add(q.id)
      questions.push({
        id: q.id,
        part: q.part,
        question_text: q.question_text,
        question_text_zh: q.question_text_zh,
        cue_card_title: q.cue_card_title,
        cue_card_title_zh: q.cue_card_title_zh,
        is_new: q.is_new,
        topic_only: q.topic_only,
        matched_point: mp.pointCode,
        dimension: mp.dimension,
      })
    }
  }

  await collect(primary)
  await collect(secondary)

  return { primary, secondary, questions, count: questions.length }
}
