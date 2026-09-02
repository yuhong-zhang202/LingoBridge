/**
 * @module   scheme3-matching.test
 * @desc     方案三 Top20、topic_only、公平排序及 Ranking 结构失败测试；全程使用注入桩，不访问网络。
 * @author   LingoBridge
 * @created  2026-09-02
 */
jest.mock('server-only', () => ({}))

import {
  matchByStoryScheme3,
  preloadScheme3ProductionAssets,
  type Scheme3RuntimeDependencies,
} from '@/services/scheme3-matching'
import { SCHEME3_QUESTION_COUNT, type Scheme3AssetBundle } from '@/lib/scheme3-assets'

function bundleFixture(): Scheme3AssetBundle {
  return {
    schema: 'lingobridge.scheme3.production-assets.v1',
    algorithm_version: 'fixture-v1',
    embedding_model: 'text-embedding-v3',
    embedding_dimensions: 2,
    question_representation_version: 'question-text-plus-retrieval-description-v1',
    story_representation_version: 'raw-cleaned-text-query-v1',
    ranking_model: 'qwen-plus',
    ranking_system_prompt: '冻结 Prompt',
    questions: Array.from({ length: SCHEME3_QUESTION_COUNT }, (_, index) => ({
      id: `q-${index}`,
      part: 2 as const,
      question_text: `Question ${index}`,
      question_text_zh: null,
      cue_card_title: null,
      cue_card_title_zh: null,
      is_new: false,
      topic_only: index === 0,
      embedding: index < 20 ? [1, index / 1000] : [0, 1],
      contract: {
        requirements: [{ requirement_id: 'r1', hardness: 'HARD' as const, statement_zh: `事实${index}` }],
        or_groups: [],
        allowed_medium_gaps: [],
        disallowed_inferences: [],
      },
    })),
  }
}

describe('方案三运行器', () => {
  test('生产资产预检成功后复用同一份已校验缓存', async () => {
    const first = await preloadScheme3ProductionAssets()
    const second = await preloadScheme3ProductionAssets()

    expect(first).toBe(second)
    expect(first.questions).toHaveLength(SCHEME3_QUESTION_COUNT)
  })

  test('从349题取相似度Top20，topic_only 不过滤也不加分，并把完整Key交给Ranking', async () => {
    const rank = jest.fn<ReturnType<Scheme3RuntimeDependencies['rank']>, Parameters<Scheme3RuntimeDependencies['rank']>>(async () => ({
      value: [59, ...Array.from({ length: 19 }, () => 85)],
      usage: { promptTokens: 30, completionTokens: 20 },
      latencyMs: 22,
    }))
    const runtime: Scheme3RuntimeDependencies = {
      embedStory: jest.fn(async () => ({
        value: [1, 0],
        usage: { promptTokens: 10, completionTokens: 0 },
        latencyMs: 11,
      })),
      rank,
    }

    const onEmbedding = jest.fn()
    const onRanking = jest.fn()
    const onEmbeddingLatency = jest.fn()
    const onRankingLatency = jest.fn()
    const result = await matchByStoryScheme3('故事', bundleFixture(), runtime, {
      onEmbedding, onRanking, onEmbeddingLatency, onRankingLatency,
    })
    const rankingInput = rank.mock.calls[0][0]

    expect(rankingInput.candidates).toHaveLength(20)
    expect(rankingInput.candidates[0]).toEqual({ en: 'Question 0', key: '直接回答需：事实0' })
    expect(result.questions.find((question) => question.id === 'q-0')).toEqual(expect.objectContaining({
      topic_only: true,
      relevanceScore: 59,
    }))
    expect(result.questions[0].relevanceScore).toBe(85)
    expect(result.primary).toBeNull()
    expect(result.noMatch).toBe(false)
    expect(onEmbedding).toHaveBeenCalledWith({ promptTokens: 10, completionTokens: 0 })
    expect(onRanking).toHaveBeenCalledWith({ promptTokens: 30, completionTokens: 20 })
    expect(onEmbeddingLatency).toHaveBeenCalledWith(11)
    expect(onRankingLatency).toHaveBeenCalledWith(22)
  })

  test('余弦同分按 question_id 字典序取Top20，不受资产排列顺序影响', async () => {
    const assets = bundleFixture()
    assets.questions = [...assets.questions]
      .reverse()
      .map((question) => ({ ...question, embedding: [1, 0] }))
    const rank = jest.fn<ReturnType<Scheme3RuntimeDependencies['rank']>, Parameters<Scheme3RuntimeDependencies['rank']>>(async () => ({
      value: Array.from({ length: 20 }, () => 85), usage: null, latencyMs: 1,
    }))

    await matchByStoryScheme3('故事', assets, {
      embedStory: async () => ({ value: [1, 0], usage: null, latencyMs: 1 }),
      rank,
    })

    const actualQuestions = rank.mock.calls[0][0].candidates.map((candidate) => candidate.en)
    const expectedQuestions = assets.questions
      .map((question) => question.id)
      .sort()
      .slice(0, 20)
      .map((id) => `Question ${id.slice(2)}`)
    expect(actualQuestions).toEqual(expectedQuestions)
  })

  test('Ranking 少题、非法分数或故事向量维度错误均 fail-closed', async () => {
    const assets = bundleFixture()
    const missingScore: Scheme3RuntimeDependencies = {
      embedStory: async () => ({ value: [1, 0], usage: null, latencyMs: 1 }),
      rank: async () => ({ value: [], usage: null, latencyMs: 1 }),
    }
    await expect(matchByStoryScheme3('故事', assets, missingScore)).rejects.toThrow('未覆盖全部')

    const invalidScore: Scheme3RuntimeDependencies = {
      embedStory: async () => ({ value: [1, 0], usage: null, latencyMs: 1 }),
      rank: async () => ({ value: [101, ...Array.from({ length: 19 }, () => 85)], usage: null, latencyMs: 1 }),
    }
    await expect(matchByStoryScheme3('故事', assets, invalidScore)).rejects.toThrow('分数结构不合法')

    const wrongDimensions: Scheme3RuntimeDependencies = {
      embedStory: async () => ({ value: [1], usage: null, latencyMs: 1 }),
      rank: async () => ({ value: [], usage: null, latencyMs: 1 }),
    }
    await expect(matchByStoryScheme3('故事', assets, wrongDimensions)).rejects.toThrow('故事向量维度')
  })
})
