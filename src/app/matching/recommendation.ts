/**
 * @module   MatchingRecommendation
 * @desc     匹配结果定稿后的全局推荐题选择；Part 筛选只控制该题显隐，不参与重选。
 * @author   LingoBridge
 * @created  2026-08-27
 */
import { SCORE_HIGH, SCORE_MID } from '@/lib/constants'
import type { MatchPhase } from './phase'
import type { FunnelQuestion } from './types'

type RecommendationCandidate = Pick<FunnelQuestion, 'id' | 'relevanceScore'>

/**
 * 从最终全局排序中选择唯一推荐题：首道高匹配优先，无高匹配时取首道中匹配。
 * @param phase     匹配页当前形态
 * @param questions 全局最终排序题目
 * @returns         推荐题 ID；非最终正常结果或无高/中匹配时返回 null
 */
export function recommendedQuestionId(
  phase: MatchPhase,
  questions: readonly RecommendationCandidate[],
): string | null {
  if (phase !== 'result') return null
  const high = questions.find((question) =>
    question.relevanceScore != null && question.relevanceScore >= SCORE_HIGH)
  if (high) return high.id
  const mid = questions.find((question) =>
    question.relevanceScore != null
    && question.relevanceScore >= SCORE_MID
    && question.relevanceScore < SCORE_HIGH)
  return mid?.id ?? null
}
