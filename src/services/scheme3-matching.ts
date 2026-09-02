/**
 * @module   scheme3-matching
 * @desc     方案三 Enhanced Embedding Top20 + Question Key Ranking 的纯运行器；外部调用通过依赖显式注入。
 * @author   LingoBridge
 * @created  2026-09-02
 */
import 'server-only'
import { SCORE_MID } from '@/lib/constants'
import {
  SCHEME3_RETRIEVAL_LIMIT,
  compactScheme3QuestionKey,
  type Scheme3AssetBundle,
  type Scheme3QuestionAsset,
} from '@/lib/scheme3-assets'
import type { FunnelMatchedQuestion, FunnelMatchResult } from '@/lib/types'
import type { LLMUsage } from '@/lib/llm'
import { env } from '@/lib/env-server'
import {
  loadScheme3ProductionAssets,
  SCHEME3_PRODUCTION_MANIFEST_SHA256,
} from '@/lib/scheme3-manifest'
import { createScheme3DashScopeRuntime, type Scheme3TransportCapture } from '@/services/scheme3-dashscope'

export interface Scheme3RankingCandidate {
  en: string
  key: string
}

export interface Scheme3ModelCallResult<T> {
  value: T
  usage: LLMUsage | null
  latencyMs: number
}

/** 方案三的两次生产能力：故事向量化与 Compact Ranking。 */
export interface Scheme3RuntimeDependencies {
  embedStory: (
    story: string,
    model: 'text-embedding-v3',
    dimensions: number,
  ) => Promise<Scheme3ModelCallResult<number[]>>
  rank: (input: {
    story: string
    model: 'qwen-plus'
    systemPrompt: string
    candidates: Scheme3RankingCandidate[]
  }) => Promise<Scheme3ModelCallResult<number[]>>
}

export interface Scheme3UsageSink {
  onEmbedding?: (usage: LLMUsage) => void
  onRanking?: (usage: LLMUsage) => void
  onEmbeddingLatency?: (ms: number) => void
  onRankingLatency?: (ms: number) => void
  onTransportCapture?: (capture: Scheme3TransportCapture) => void | Promise<void>
}

let productionAssetsPromise: Promise<Scheme3AssetBundle> | null = null

function productionAssets(): Promise<Scheme3AssetBundle> {
  if (!productionAssetsPromise) {
    productionAssetsPromise = loadScheme3ProductionAssets({
      manifestPath: env.scheme3ManifestPath,
      expectedManifestSha256: SCHEME3_PRODUCTION_MANIFEST_SHA256,
    }).catch((error: unknown) => {
      // 只缓存成功结果：资产挂载短暂缺失后可自行恢复；失败请求仍严格阻断，绝不进入模型或 Mapping。
      productionAssetsPromise = null
      throw error
    })
  }
  return productionAssetsPromise
}

/**
 * 在匹配 API 的任何鉴权、数据库、额度或模型调用前加载并校验方案三生产资产。
 * 成功结果与正式执行器共享同一缓存；失败只清缓存供后续恢复，本次请求必须 fail-closed。
 */
export async function preloadScheme3ProductionAssets(): Promise<Scheme3AssetBundle> {
  return productionAssets()
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]
    const rightValue = right[index]
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }
  if (leftNorm === 0 || rightNorm === 0) throw new Error('方案三向量范数不能为 0')
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function toQuestion(question: Scheme3QuestionAsset, score: number): FunnelMatchedQuestion {
  return {
    id: question.id,
    part: question.part,
    question_text: question.question_text,
    question_text_zh: question.question_text_zh,
    cue_card_title: question.cue_card_title,
    cue_card_title_zh: question.cue_card_title_zh,
    is_new: question.is_new,
    topic_only: question.topic_only,
    // Enhanced 不依赖观察点 Mapping；空元数据由 API 输出边界隐藏，不伪造观察点。
    matched_point: '',
    pointName: '',
    dimension: '',
    isPrimaryMatch: false,
    relevanceScore: score,
  }
}

function validateScores(scores: number[], candidateCount: number): void {
  if (scores.length !== candidateCount) throw new Error('方案三 Ranking 未覆盖全部 Top20 候选')
  for (const score of scores) {
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      throw new Error('方案三 Ranking 分数结构不合法')
    }
  }
}

/**
 * 执行方案三；资产与外部能力均由调用方注入，因此可在零网络测试中验证完整数据流。
 * @param  cleanedText  整理后的中文故事
 * @param  assets       已严格解析并由 Manifest 锁定的 349 题生产资产
 * @param  runtime      embedding 与 ranking 生产适配器
 * @returns             Top20 全候选及其真实分数；60/85 可见规则由既有输出边界统一执行
 */
export async function matchByStoryScheme3(
  cleanedText: string,
  assets: Scheme3AssetBundle,
  runtime: Scheme3RuntimeDependencies,
  usage?: Scheme3UsageSink,
): Promise<FunnelMatchResult> {
  const embeddingCall = await runtime.embedStory(
    cleanedText,
    assets.embedding_model,
    assets.embedding_dimensions,
  )
  if (embeddingCall.usage) usage?.onEmbedding?.(embeddingCall.usage)
  usage?.onEmbeddingLatency?.(embeddingCall.latencyMs)
  const storyEmbedding = embeddingCall.value
  if (storyEmbedding.length !== assets.embedding_dimensions
    || storyEmbedding.some((number) => !Number.isFinite(number))) {
    throw new Error('方案三故事向量维度或数值不合法')
  }
  const topQuestions = assets.questions
    .map((question) => ({
      question,
      similarity: cosineSimilarity(storyEmbedding, question.embedding),
    }))
    .sort((left, right) => {
      const similarityOrder = right.similarity - left.similarity
      if (similarityOrder !== 0) return similarityOrder
      // 冻结 Enhanced 规则：余弦同分按 question_id 字典序，不依赖资产文件内的排列顺序。
      return left.question.id < right.question.id ? -1 : left.question.id > right.question.id ? 1 : 0
    })
    .slice(0, SCHEME3_RETRIEVAL_LIMIT)
    .map((entry) => entry.question)
  const candidates = topQuestions.map((question): Scheme3RankingCandidate => ({
    en: question.question_text,
    key: compactScheme3QuestionKey(question.contract),
  }))
  const rankingCall = await runtime.rank({
    story: cleanedText,
    model: assets.ranking_model,
    systemPrompt: assets.ranking_system_prompt,
    candidates,
  })
  if (rankingCall.usage) usage?.onRanking?.(rankingCall.usage)
  usage?.onRankingLatency?.(rankingCall.latencyMs)
  const scores = rankingCall.value
  validateScores(scores, candidates.length)
  const questions = topQuestions
    .map((question, index) => toQuestion(question, scores[index]))
    .sort((left, right) => (right.relevanceScore ?? -1) - (left.relevanceScore ?? -1))
  return {
    primary: null,
    secondary: null,
    questions,
    count: questions.length,
    matchedViaSecondary: false,
    matchedViaNeighbor: false,
    neighborPointsUsed: [],
    noMatch: !questions.some((question) => (question.relevanceScore ?? -1) >= SCORE_MID),
  }
}

/**
 * 生产默认入口在冻结资产与适配器接入前始终做响，绝不转调 Mapping。
 * @param  cleanedText  整理后的中文故事
 * @param  usage        方案三独立的 Embedding/Ranking 用量、耗时与原始响应回调
 * @returns             方案三完整匹配结果
 * @throws              Manifest、资产、配置或外部协议任一失败时直接上抛
 */
export async function matchByStoryScheme3Production(
  cleanedText: string,
  usage?: Scheme3UsageSink,
): Promise<FunnelMatchResult> {
  const assets = await productionAssets()
  const runtime = createScheme3DashScopeRuntime({
    apiKey: env.dashscopeApiKey,
    baseUrl: env.dashscopeBaseUrl,
    onTransportCapture: usage?.onTransportCapture,
  })
  return matchByStoryScheme3(cleanedText, assets, runtime, usage)
}
