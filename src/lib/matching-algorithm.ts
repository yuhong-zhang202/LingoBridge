/**
 * @module   matching-algorithm
 * @desc     匹配算法 arm 的解析、版本隔离与用户可见输出守卫；不包含任何模型、题库或数据库逻辑。
 * @author   LingoBridge
 * @created  2026-09-02
 */
import { RANKING_ALGO_VERSION, SCORE_MID } from '@/lib/constants'
import type { FunnelMatchedQuestion, FunnelMatchResult, MatchedPoint } from '@/lib/types'

/** 生产允许的匹配算法 arm。方案三名称不绑定 v7.6/v7.7，避免把未冻结资产冒充任一历史 DUT。 */
export type MatchingAlgorithm = 'mapping' | 'scheme3_enhanced_key'

/** 单个算法 arm 的运行时身份；snapshotKey 同时隔离数据库快照与进程内单飞。 */
export interface MatchingAlgorithmConfig {
  algo: MatchingAlgorithm
  version: string
  snapshotKey: string
  ready: boolean
}

const MAPPING_CONFIG: MatchingAlgorithmConfig = {
  algo: 'mapping',
  version: RANKING_ALGO_VERSION,
  snapshotKey: `mapping:${RANKING_ALGO_VERSION}`,
  ready: true,
}

const SCHEME3_CONFIG: MatchingAlgorithmConfig = {
  algo: 'scheme3_enhanced_key',
  version: 'scheme3-enhanced-key-r3-2026-09-02',
  snapshotKey: 'scheme3_enhanced_key:scheme3-enhanced-key-r3-2026-09-02',
  ready: true,
}

/**
 * 解析 MATCHING_ALGO；未配置时默认方案三，只有显式 mapping 才进入紧急回滚 arm。
 * @param  raw  环境变量原值
 * @returns     对应的算法配置
 * @throws      非法值会抛错，调用方必须显式阻断请求
 */
export function matchingAlgorithmConfig(raw: string | undefined): MatchingAlgorithmConfig {
  if (raw === undefined || raw === '') return SCHEME3_CONFIG
  if (raw === 'mapping') return MAPPING_CONFIG
  if (raw === 'scheme3_enhanced_key') return SCHEME3_CONFIG
  throw new Error(`非法 MATCHING_ALGO：${raw}`)
}

/**
 * 返回当前 arm 的上线阻断原因；null 表示可以执行。
 * @param  config  已解析算法配置
 * @returns        阻断原因或 null
 */
export function matchingAlgorithmBlockReason(config: MatchingAlgorithmConfig): string | null {
  if (config.ready) return null
  return '方案三结构化 Key 资产尚未通过冻结校验，已阻断本次匹配'
}

/**
 * 判断数据库快照能否供当前 arm 使用。
 * @param  storedVersion  快照表中的 algo_version
 * @param  config         当前算法配置
 * @returns               是否兼容
 */
export function isMatchingSnapshotCompatible(
  storedVersion: string | null,
  config: MatchingAlgorithmConfig,
): boolean {
  if (storedVersion === config.snapshotKey) return true
  // Mapping 旧快照只有 ranking 版本。仅 Mapping 可兼容，避免上线骨架让全体旧语料付费重算。
  return config.algo === 'mapping' && storedVersion === RANKING_ALGO_VERSION
}

/**
 * 给服务端结果写入实际执行的算法身份；新快照、埋点与响应都复用这两个字段。
 * @param  result  匹配服务原始结果
 * @param  config  实际执行的算法配置
 * @returns        带算法身份的新结果对象
 */
export function attachMatchingAlgorithm(
  result: FunnelMatchResult,
  config: MatchingAlgorithmConfig,
): FunnelMatchResult {
  return {
    ...result,
    matchingAlgo: config.algo,
    matchingAlgoVersion: config.version,
  }
}

/**
 * 生成单题的用户可见版本。Mapping 保持原样；方案三只允许有分且达到 60 的题。
 * @param  question  服务端原始候选题
 * @param  config    实际执行的算法配置
 * @returns          可发给客户端的题，或 null（fail-closed）
 */
export function matchingQuestionForClient(
  question: FunnelMatchedQuestion,
  config: MatchingAlgorithmConfig,
): FunnelMatchedQuestion | null {
  if (config.algo === 'mapping') return question
  if (question.relevanceScore == null || question.relevanceScore < SCORE_MID) return null
  const reason = question.relevanceReason?.trim()
  return {
    ...question,
    relevanceReason: reason || undefined,
  }
}

/** 方案三的观察点元数据不完整时不向客户端发送空壳。 */
function matchedPointForClient(
  point: MatchedPoint | null,
  config: MatchingAlgorithmConfig,
): MatchedPoint | null {
  if (config.algo === 'mapping' || point === null) return point
  return point.dimension.trim() && point.pointName.trim() ? point : null
}

/**
 * 在 API 最终输出边界执行方案三可见性守卫，不修改留档/埋点所需的原始候选集。
 * @param  result  已带算法身份的服务端结果
 * @param  config  实际执行的算法配置
 * @returns        用户可见 DTO
 */
export function matchingResultForClient(
  result: FunnelMatchResult,
  config: MatchingAlgorithmConfig,
): FunnelMatchResult {
  if (config.algo === 'mapping') return result
  const questions = result.questions.flatMap((question) => {
    const visible = matchingQuestionForClient(question, config)
    return visible ? [visible] : []
  })
  return {
    ...result,
    primary: matchedPointForClient(result.primary, config),
    secondary: matchedPointForClient(result.secondary, config),
    questions,
    count: questions.length,
    noMatch: questions.length === 0,
  }
}
