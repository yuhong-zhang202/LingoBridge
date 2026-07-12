/**
 * @module   matching
 * @desc     题目匹配服务 — 三层漏斗：primary 主标签 → secondary 降级 → noMatch → 相关性排名
 * @author   LingoBridge
 * @created  2026-06-03
 */
import 'server-only'
import { extractCorpus, type ExtractionPick } from '@/services/extraction'
import { rankQuestions, type CandidateQuestion } from '@/services/ranking'
import { getQuestionsByObservation } from '@/lib/db/questions'
import { listObservationPoints } from '@/lib/db/observation-points'
import { DIMENSION_LABEL } from '@/lib/constants'
import { OBSERVATION_ADJACENCY } from '@/lib/observation-adjacency'
import type { MatchedPoint } from '@/lib/types'

/** 邻居兜底层累计到此题数即停止继续借相邻观察点 */
const NEIGHBOR_TARGET = 5

export interface FunnelMatchedQuestion {
  id: string
  part: 1 | 2 | 3
  question_text: string
  question_text_zh: string | null
  cue_card_title: string | null
  cue_card_title_zh: string | null
  is_new: boolean
  topic_only: boolean
  matched_point: string
  pointName: string
  dimension: string
  isPrimaryMatch: boolean
  relevanceScore?: number
  relevanceReason?: string
}

export interface FunnelMatchResult {
  primary: MatchedPoint | null
  secondary: MatchedPoint | null
  questions: FunnelMatchedQuestion[]
  count: number
  matchedViaSecondary: boolean
  /** 主/副皆空时经「邻居观察点」兜底层召回到题（第三层） */
  matchedViaNeighbor: boolean
  /** 邻居兜底层实际借用（贡献了题）的相邻观察点，按借用顺序，供前端「换个角度」文案 */
  neighborPointsUsed: MatchedPoint[]
  noMatch: boolean
}

/**
 * 根据故事文本做三层漏斗真实反向匹配，并对候选题做相关性排名
 * @param cleanedText  整理后的中文故事
 * @returns            主/副观察点 + 漏斗匹配结果（含 matchedViaSecondary / noMatch / 排名后 questions）
 */
export async function matchByStory(cleanedText: string): Promise<FunnelMatchResult> {
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

  // 3. 三层漏斗
  const seen = new Set<string>()

  // 从某个观察点收题，tagAsPrimary 决定 isPrimaryMatch 标记（与 DB 的 is_primary 无关）
  // includeSec=true 仅在第二层借道时传入，让副标签挂载的题也能被检索到
  async function collectFrom(
    mp: MatchedPoint,
    tagAsPrimary: boolean,
    includeSec = false,
  ): Promise<FunnelMatchedQuestion[]> {
    const qs = await getQuestionsByObservation(mp.pointCode, includeSec)
    const result: FunnelMatchedQuestion[] = []
    for (const q of qs) {
      if (seen.has(q.id)) continue
      seen.add(q.id)
      result.push({
        id: q.id,
        part: q.part as 1 | 2 | 3,
        question_text: q.question_text,
        question_text_zh: q.question_text_zh,
        cue_card_title: q.cue_card_title,
        cue_card_title_zh: q.cue_card_title_zh,
        is_new: q.is_new,
        topic_only: q.topic_only,
        matched_point: mp.pointCode,
        pointName: mp.pointName,
        dimension: mp.dimension,
        isPrimaryMatch: tagAsPrimary,
      })
    }
    return result
  }

  const allQuestions: FunnelMatchedQuestion[] = []
  let matchedViaSecondary = false
  let matchedViaNeighbor = false
  const neighborPointsUsed: MatchedPoint[] = []
  let noMatch = false

  if (primary) {
    // 第一层含副标签：副挂（is_primary=false）语义为「该点故事也能直接答此题」，首层必须能召回
    const primaryHits = await collectFrom(primary, true, true)

    if (primaryHits.length > 0) {
      // 第一层命中：主维度有题；若 secondary 非空，再追加副维度题作为补充
      allQuestions.push(...primaryHits)
      if (secondary) {
        const secondaryHits = await collectFrom(secondary, false)
        allQuestions.push(...secondaryHits)
      }
    } else {
      // 第二层借道：primary 无题时才尝试故事副观察点，避免混淆主题
      const secondaryHits = secondary ? await collectFrom(secondary, false, true) : []
      if (secondaryHits.length > 0) {
        allQuestions.push(...secondaryHits)
        matchedViaSecondary = true
      } else {
        // 第三层·邻居兜底：主/副皆空，按优先级借主观察点的相邻观察点，累计 ≥NEIGHBOR_TARGET 或邻居用尽即停
        for (const code of OBSERVATION_ADJACENCY[primary.pointCode] ?? []) {
          const neighbor = toMatchedPoint({ pointCode: code, reason: '' })
          if (!neighbor) continue
          const hits = await collectFrom(neighbor, false, true)
          if (hits.length > 0) {
            allQuestions.push(...hits)
            neighborPointsUsed.push(neighbor)
          }
          if (allQuestions.length >= NEIGHBOR_TARGET) break
        }
        if (allQuestions.length > 0) matchedViaNeighbor = true
        else noMatch = true
      }
    }
  } else {
    // 理论上萃取保证 primary 非 null，此处作保险兜底
    noMatch = true
  }

  // 4. 相关性排名（仅在有候选题时调用；降级返回空数组时回退到漏斗排序）
  if (allQuestions.length > 0) {
    const candidates: CandidateQuestion[] = allQuestions.map((q) => ({
      id: q.id,
      en: q.cue_card_title ?? q.question_text,
      zh: q.cue_card_title_zh ?? q.question_text_zh ?? '',
      obs: q.pointName,
    }))
    const scores = await rankQuestions(cleanedText, candidates)

    if (scores.length > 0) {
      const scoreMap = new Map(scores.map((s) => [s.id, s]))
      for (const q of allQuestions) {
        const s = scoreMap.get(q.id)
        if (s) {
          q.relevanceScore = s.score
          q.relevanceReason = s.reason
        }
      }
      // 按 score 降序；未打分（降级）的排末尾，内部按 isPrimaryMatch → Part
      allQuestions.sort((a, b) => {
        const sa = a.relevanceScore ?? -1
        const sb = b.relevanceScore ?? -1
        if (sa !== sb) return sb - sa
        if (a.isPrimaryMatch !== b.isPrimaryMatch) return a.isPrimaryMatch ? -1 : 1
        return a.part - b.part
      })
    } else {
      // 排名服务降级：保留漏斗排序
      allQuestions.sort((a, b) => {
        if (a.isPrimaryMatch !== b.isPrimaryMatch) return a.isPrimaryMatch ? -1 : 1
        return a.part - b.part
      })
    }
  }

  return {
    primary,
    secondary,
    questions: allQuestions,
    count: allQuestions.length,
    matchedViaSecondary,
    matchedViaNeighbor,
    neighborPointsUsed,
    noMatch,
  }
}
