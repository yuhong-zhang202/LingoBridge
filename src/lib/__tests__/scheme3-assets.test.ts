/**
 * @module   scheme3-assets.test
 * @desc     方案三资产严格校验与冻结 compactKey 规则测试。
 * @author   LingoBridge
 * @created  2026-09-02
 */
import {
  SCHEME3_QUESTION_COUNT,
  compactScheme3QuestionKey,
  parseScheme3AssetBundle,
  type Scheme3AssetBundle,
  type Scheme3QuestionContract,
} from '@/lib/scheme3-assets'

const CONTRACT: Scheme3QuestionContract = {
  requirements: [
    { requirement_id: 'r1', hardness: 'HARD', statement_zh: '本人经历过该事件' },
    { requirement_id: 'r2', hardness: 'HARD', statement_zh: '对象是朋友' },
    { requirement_id: 'r3', hardness: 'SOFT', statement_zh: '说明当时感受' },
  ],
  or_groups: [{ branches: [{ requirement_ids: ['r2'] }, { requirement_ids: ['r3'] }] }],
  allowed_medium_gaps: [{ description_zh: '可补一句动机' }],
  disallowed_inferences: [{ description_zh: '不得把同事换成朋友' }],
}

function assetFixture(): Scheme3AssetBundle {
  return {
    schema: 'lingobridge.scheme3.production-assets.v1',
    algorithm_version: 'fixture-v1',
    embedding_model: 'text-embedding-v3',
    embedding_dimensions: 2,
    question_representation_version: 'question-text-plus-retrieval-description-v1',
    story_representation_version: 'raw-cleaned-text-query-v1',
    ranking_model: 'qwen-plus',
    ranking_system_prompt: '冻结 Compact Ranking Prompt',
    questions: Array.from({ length: SCHEME3_QUESTION_COUNT }, (_, index) => ({
      id: `q-${index}`,
      part: 2 as const,
      question_text: `Question ${index}`,
      question_text_zh: null,
      cue_card_title: null,
      cue_card_title_zh: null,
      is_new: false,
      topic_only: index === 0,
      embedding: [1, index / SCHEME3_QUESTION_COUNT],
      contract: CONTRACT,
    })),
  }
}

describe('方案三生产资产', () => {
  test('完整349题通过，topic_only 保留为普通候选', () => {
    const parsed = parseScheme3AssetBundle(assetFixture())
    expect(parsed.questions).toHaveLength(349)
    expect(parsed.questions[0].topic_only).toBe(true)
  })

  test('题数不足或重复 ID 整包拒绝', () => {
    const missing = assetFixture()
    missing.questions.pop()
    expect(() => parseScheme3AssetBundle(missing)).toThrow('题数不合法')

    const duplicate = assetFixture()
    duplicate.questions[1].id = duplicate.questions[0].id
    expect(() => parseScheme3AssetBundle(duplicate)).toThrow('ID 重复')
  })

  test('Contract requirement_id 重复或 OR 引用不存在 ID 时整包拒绝', () => {
    const duplicateRequirement = assetFixture()
    duplicateRequirement.questions[0].contract = {
      ...CONTRACT,
      requirements: [...CONTRACT.requirements, { ...CONTRACT.requirements[0] }],
    }
    expect(() => parseScheme3AssetBundle(duplicateRequirement)).toThrow('Question Contract 不合法')

    const brokenReference = assetFixture()
    brokenReference.questions[0].contract = {
      ...CONTRACT,
      or_groups: [{ branches: [{ requirement_ids: ['missing'] }] }],
    }
    expect(() => parseScheme3AssetBundle(brokenReference)).toThrow('Question Contract 不合法')
  })

  test('compactKey 保留 HARD、OR、有限缺口和禁止推断', () => {
    expect(compactScheme3QuestionKey(CONTRACT)).toBe(
      '直接回答需：本人经历过该事件。另需满足其一：对象是朋友 或 说明当时感受。有限缺口可为中匹配：可补一句动机。不得虚构或替换：不得把同事换成朋友',
    )
  })
})
