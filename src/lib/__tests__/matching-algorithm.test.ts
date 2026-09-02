/**
 * @module   matching-algorithm.test
 * @desc     匹配 arm 默认值、非法配置、跨 arm 隔离与方案三用户可见输出守卫。
 * @author   LingoBridge
 * @created  2026-09-02
 */
import {
  attachMatchingAlgorithm,
  isMatchingSnapshotCompatible,
  matchingAlgorithmBlockReason,
  matchingAlgorithmConfig,
  matchingResultForClient,
} from '@/lib/matching-algorithm'
import type { FunnelMatchResult } from '@/lib/types'

/** 造一份含高分、低分、空 reason、空元数据的最小结果。 */
function resultFixture(): FunnelMatchResult {
  const base = {
    part: 1 as const,
    question_text: 'Question',
    question_text_zh: null,
    cue_card_title: null,
    cue_card_title_zh: null,
    is_new: false,
    topic_only: false,
    matched_point: 'REL_01',
    pointName: '关系',
    dimension: '人际羁绊',
    isPrimaryMatch: true,
  }
  return {
    primary: { pointCode: 'REL_01', pointName: '关系', dimension: '人际羁绊', reason: 'r' },
    secondary: null,
    questions: [
      { ...base, id: 'high', relevanceScore: 85, relevanceReason: '  可直接回答  ' },
      { ...base, id: 'mid-empty-reason', relevanceScore: 60, relevanceReason: '   ' },
      { ...base, id: 'low', relevanceScore: 59 },
      { ...base, id: 'blank-meta', relevanceScore: 90, dimension: '' },
    ],
    count: 4,
    matchedViaSecondary: false,
    matchedViaNeighbor: false,
    neighborPointsUsed: [],
    noMatch: false,
  }
}

describe('MATCHING_ALGO 解析与隔离', () => {
  test('未配置默认方案三，只有显式 mapping 进入紧急回滚', () => {
    expect(matchingAlgorithmConfig(undefined)).toEqual(expect.objectContaining({
      algo: 'scheme3_enhanced_key',
      version: 'scheme3-enhanced-key-r3-2026-09-02',
      ready: true,
    }))
    expect(matchingAlgorithmConfig('').algo).toBe('scheme3_enhanced_key')
    expect(matchingAlgorithmConfig('mapping').algo).toBe('mapping')
  })

  test('非法值显式抛错，不静默回退', () => {
    expect(() => matchingAlgorithmConfig('enhanced')).toThrow('非法 MATCHING_ALGO')
    expect(() => matchingAlgorithmConfig(' mapping ')).toThrow('非法 MATCHING_ALGO')
  })

  test('Mapping 与方案三的 snapshot key 不同，且 Mapping 旧快照只对 Mapping 兼容', () => {
    const mapping = matchingAlgorithmConfig('mapping')
    const scheme3 = matchingAlgorithmConfig('scheme3_enhanced_key')
    expect(mapping.snapshotKey).not.toBe(scheme3.snapshotKey)
    expect(isMatchingSnapshotCompatible(mapping.version, mapping)).toBe(true)
    expect(isMatchingSnapshotCompatible(mapping.version, scheme3)).toBe(false)
    expect(matchingAlgorithmBlockReason(scheme3)).toBeNull()
  })
})

describe('方案三用户可见输出守卫', () => {
  test('过滤低于60，空 reason 不输出空壳；空元数据不误删题，Mapping 保持原题集', () => {
    const source = resultFixture()
    const mapping = attachMatchingAlgorithm(source, matchingAlgorithmConfig('mapping'))
    const scheme3Config = matchingAlgorithmConfig('scheme3_enhanced_key')
    const scheme3 = matchingResultForClient(attachMatchingAlgorithm(source, scheme3Config), scheme3Config)

    expect(matchingResultForClient(mapping, matchingAlgorithmConfig('mapping')).questions).toHaveLength(4)
    expect(scheme3.questions.map((question) => question.id)).toEqual(['high', 'mid-empty-reason', 'blank-meta'])
    expect(scheme3.questions[0].relevanceReason).toBe('可直接回答')
    expect(scheme3.questions[1].relevanceReason).toBeUndefined()
    expect(scheme3.count).toBe(3)
  })
})
