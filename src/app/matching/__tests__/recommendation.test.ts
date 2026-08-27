/**
 * @module   recommendation.test
 * @desc     匹配页全局唯一推荐题的定稿、档位优先级与 Part 筛选回归测试。
 * @author   LingoBridge
 * @created  2026-08-27
 */
import { SCORE_HIGH, SCORE_MID } from '@/lib/constants'
import { recommendedQuestionId } from '../recommendation'

interface Candidate {
  id: string
  relevanceScore?: number
  part: 1 | 2 | 3
}

const question = (id: string, relevanceScore: number, part: 1 | 2 | 3 = 1): Candidate => ({
  id,
  relevanceScore,
  part,
})

describe('全局唯一推荐题', () => {
  test('高匹配优先，并取全局排序中的首道高匹配', () => {
    const questions = [question('mid-first', SCORE_MID), question('high-first', SCORE_HIGH), question('high-second', 99)]
    expect(recommendedQuestionId('result', questions)).toBe('high-first')
  })

  test('没有高匹配时取全局排序中的首道中匹配', () => {
    const questions = [question('low', SCORE_MID - 1), question('mid-first', 72), question('mid-second', 80)]
    expect(recommendedQuestionId('result', questions)).toBe('mid-first')
  })

  test.each(['waiting', 'streaming', 'lowMatch', 'noMatch', 'degraded', 'error', 'limit'] as const)(
    '%s 形态不推荐任何题',
    (phase) => {
      expect(recommendedQuestionId(phase, [question('high', SCORE_HIGH)])).toBeNull()
    },
  )

  test('定稿但只有低匹配或未打分时不推荐', () => {
    const questions: Candidate[] = [question('low', SCORE_MID - 1), { id: 'unscored', part: 2 }]
    expect(recommendedQuestionId('result', questions)).toBeNull()
  })

  test('Part 筛选只隐藏全局推荐题，不会在另一 Part 产生第二个推荐', () => {
    const questions = [question('global', 92, 1), question('part-two', 90, 2)]
    const recommendedId = recommendedQuestionId('result', questions)
    const partTwoVisible = questions.filter((candidate) => candidate.part === 2)
    expect(recommendedId).toBe('global')
    expect(partTwoVisible.filter((candidate) => candidate.id === recommendedId)).toHaveLength(0)
  })
})
