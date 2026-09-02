/**
 * @module   scheme3-assets
 * @desc     方案三静态题库资产的类型、严格校验与 Question Key 压缩；不读取评估目录或临时文件。
 * @author   LingoBridge
 * @created  2026-09-02
 */

/** 方案三生产资产固定题数；包含 topic_only 题。 */
export const SCHEME3_QUESTION_COUNT = 349
/** Enhanced Embedding 固定召回数。 */
export const SCHEME3_RETRIEVAL_LIMIT = 20

export interface Scheme3Requirement {
  requirement_id: string
  hardness: 'HARD' | 'SOFT'
  statement_zh: string
}

export interface Scheme3OrBranch {
  requirement_ids: string[]
}

export interface Scheme3OrGroup {
  branches: Scheme3OrBranch[]
}

export interface Scheme3Description {
  description_zh: string
}

/** v7.6 compactKey 所消费的完整结构化 Question Contract。 */
export interface Scheme3QuestionContract {
  requirements: Scheme3Requirement[]
  or_groups: Scheme3OrGroup[]
  allowed_medium_gaps: Scheme3Description[]
  disallowed_inferences: Scheme3Description[]
}

/** 方案三单题静态记录；题面、向量与 Contract 必须同 ID 冻结。 */
export interface Scheme3QuestionAsset {
  id: string
  part: 1 | 2 | 3
  question_text: string
  question_text_zh: string | null
  cue_card_title: string | null
  cue_card_title_zh: string | null
  is_new: boolean
  topic_only: boolean
  embedding: number[]
  contract: Scheme3QuestionContract
}

/** 可发布的单文件资产包；所有哈希由发布 Manifest 在文件外锁定。 */
export interface Scheme3AssetBundle {
  schema: 'lingobridge.scheme3.production-assets.v1'
  algorithm_version: string
  embedding_model: 'text-embedding-v3'
  embedding_dimensions: number
  question_representation_version: 'question-text-plus-retrieval-description-v1'
  story_representation_version: 'raw-cleaned-text-query-v1'
  ranking_model: 'qwen-plus'
  ranking_system_prompt: string
  questions: Scheme3QuestionAsset[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function isDescription(value: unknown): value is Scheme3Description {
  return isRecord(value) && typeof value.description_zh === 'string' && value.description_zh.trim().length > 0
}

function isContract(value: unknown): value is Scheme3QuestionContract {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.requirements) || !Array.isArray(value.or_groups)) return false
  if (!Array.isArray(value.allowed_medium_gaps) || !Array.isArray(value.disallowed_inferences)) return false
  const requirements = value.requirements.every((requirement) =>
    isRecord(requirement)
    && typeof requirement.requirement_id === 'string'
    && (requirement.hardness === 'HARD' || requirement.hardness === 'SOFT')
    && typeof requirement.statement_zh === 'string'
    && requirement.statement_zh.trim().length > 0,
  )
  const groups = value.or_groups.every((group) =>
    isRecord(group)
    && Array.isArray(group.branches)
    && group.branches.every((branch) =>
      isRecord(branch)
      && Array.isArray(branch.requirement_ids)
      && branch.requirement_ids.every((id) => typeof id === 'string'),
    ),
  )
  if (!requirements || !groups) return false
  const requirementIds = value.requirements.map((requirement) => requirement.requirement_id)
  if (new Set(requirementIds).size !== requirementIds.length) return false
  const knownIds = new Set(requirementIds)
  const referencesAreComplete = value.or_groups.every((group: { branches: Array<{ requirement_ids: string[] }> }) => group.branches.every((branch: { requirement_ids: string[] }) =>
    branch.requirement_ids.length > 0
    && branch.requirement_ids.every((id: string) => knownIds.has(id)),
  ))
  return referencesAreComplete
    && value.allowed_medium_gaps.every(isDescription)
    && value.disallowed_inferences.every(isDescription)
}

function isQuestion(value: unknown, dimensions: number): value is Scheme3QuestionAsset {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && (value.part === 1 || value.part === 2 || value.part === 3)
    && typeof value.question_text === 'string'
    && isNullableString(value.question_text_zh)
    && isNullableString(value.cue_card_title)
    && isNullableString(value.cue_card_title_zh)
    && typeof value.is_new === 'boolean'
    && typeof value.topic_only === 'boolean'
    && Array.isArray(value.embedding)
    && value.embedding.length === dimensions
    && value.embedding.every((number) => typeof number === 'number' && Number.isFinite(number))
    && isContract(value.contract)
}

/**
 * 严格解析方案三静态资产；任一缺字段、重复 ID、维度或数量错误都整体拒绝。
 * @param  value  JSON.parse 后的未知值
 * @returns       类型安全且可执行的资产包
 * @throws        资产契约不完整时抛错，调用方必须阻断流量
 */
export function parseScheme3AssetBundle(value: unknown): Scheme3AssetBundle {
  if (!isRecord(value)
    || value.schema !== 'lingobridge.scheme3.production-assets.v1'
    || typeof value.algorithm_version !== 'string'
    || value.algorithm_version.trim().length === 0
    || value.embedding_model !== 'text-embedding-v3'
    || !Number.isInteger(value.embedding_dimensions)
    || (value.embedding_dimensions as number) <= 0
    || value.question_representation_version !== 'question-text-plus-retrieval-description-v1'
    || value.story_representation_version !== 'raw-cleaned-text-query-v1'
    || value.ranking_model !== 'qwen-plus'
    || typeof value.ranking_system_prompt !== 'string'
    || value.ranking_system_prompt.trim().length === 0
    || !Array.isArray(value.questions)
    || value.questions.length !== SCHEME3_QUESTION_COUNT) {
    throw new Error('方案三生产资产头或题数不合法')
  }
  const dimensions = value.embedding_dimensions as number
  if (!value.questions.every((question) => isQuestion(question, dimensions))) {
    throw new Error('方案三题目、向量或 Question Contract 不合法')
  }
  const ids = value.questions.map((question) => question.id)
  if (new Set(ids).size !== ids.length) throw new Error('方案三题目 ID 重复')
  return value as unknown as Scheme3AssetBundle
}

/**
 * 按冻结 v7.6 规则把完整 Contract 压缩成 Ranking 的单题 Key。
 * @param  contract  单题结构化 Contract
 * @returns          供 Compact Ranking 使用的中文 Key
 */
export function compactScheme3QuestionKey(contract: Scheme3QuestionContract): string {
  const grouped = new Set(contract.or_groups.flatMap((group) =>
    group.branches.flatMap((branch) => branch.requirement_ids),
  ))
  const requirementById = new Map(contract.requirements.map((requirement) =>
    [requirement.requirement_id, requirement] as const,
  ))
  const hard = contract.requirements
    .filter((requirement) => requirement.hardness === 'HARD' && !grouped.has(requirement.requirement_id))
    .map((requirement) => requirement.statement_zh)
  const soft = contract.requirements
    .filter((requirement) => requirement.hardness === 'SOFT' && !grouped.has(requirement.requirement_id))
    .map((requirement) => requirement.statement_zh)
  const alternatives = contract.or_groups.map((group) => group.branches.map((branch) =>
    branch.requirement_ids
      .map((id) => requirementById.get(id)?.statement_zh)
      .filter((statement): statement is string => Boolean(statement))
      .join('且'),
  ).join(' 或 '))
  const gaps = contract.allowed_medium_gaps.map((gap) => gap.description_zh)
  const avoid = contract.disallowed_inferences.map((inference) => inference.description_zh)
  return [
    hard.length > 0 ? `直接回答需：${hard.join('；')}` : '',
    alternatives.length > 0 ? `另需满足其一：${alternatives.join('；')}` : '',
    soft.length + gaps.length > 0 ? `有限缺口可为中匹配：${[...soft, ...gaps].join('；')}` : '',
    avoid.length > 0 ? `不得虚构或替换：${avoid.join('；')}` : '',
  ].filter(Boolean).join('。')
}
