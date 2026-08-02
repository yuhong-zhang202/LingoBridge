/**
 * @module   matching
 * @desc     题目匹配服务 — 三层漏斗：primary 主标签 → secondary 降级 → noMatch → 相关性排名
 * @author   LingoBridge
 * @created  2026-06-03
 */
import 'server-only'
import { extractCorpus, type ExtractionPick } from '@/services/extraction'
import {
  rankQuestionsStreaming,
  type CandidateQuestion,
  type RankingStreamStats,
} from '@/services/ranking'
import type { LLMUsage } from '@/lib/llm'
import { questionFace } from '@/lib/question-face'
import { getQuestionsByObservation } from '@/lib/db/questions'
import { listObservationPoints } from '@/lib/db/observation-points'
import { DIMENSION_LABEL } from '@/lib/constants'
import { OBSERVATION_ADJACENCY } from '@/lib/observation-adjacency'
import type { MatchedPoint, FunnelMatchedQuestion, FunnelMatchResult, RelevanceScore } from '@/lib/types'

// FunnelMatchedQuestion / FunnelMatchResult 已下沉到中性的 @/lib/types（避免 db 层反向依赖本 service）。
// 此处 re-export 保留原 `@/services/matching` 导入路径的兼容（route / 测试仍从这里取类型）。
export type { FunnelMatchedQuestion, FunnelMatchResult }

/**
 * 流式匹配的首帧元信息（阶段二 SSE 的 meta 帧）：观察点 + 各层命中标记 + 候选总数。
 * 在漏斗召回完成、重排开始【之前】就绪，供接口层先发一帧、前端先渲染标题/骨架。
 */
export interface FunnelStreamMeta {
  primary: MatchedPoint | null
  secondary: MatchedPoint | null
  matchedViaSecondary: boolean
  matchedViaNeighbor: boolean
  candidateCount: number
}

/** 召回题数低于此值就进入邻居增援层补题（含 L1/L2 已召回到少量题的情况，非仅完全为空） */
const NEIGHBOR_MIN = 3
/** 邻居增援层累计到此题数即停止继续借相邻观察点 */
const NEIGHBOR_TARGET = 5

/**
 * matchByStory 内两次 AI 调用（萃取 + 重排）各自的真实用量 + 真实耗时回调。
 * 分开两组回调而非一组：route 要把这两次调用【各记一条账】（此前只记了萃取的估算，漏了最大的重排）。
 *
 * 2026-07-20 新增 onExtractionLatency / onRankingLatency：此前 route 两条日志的 latency_ms
 * 都写「从请求入口到全部跑完」的总耗时，同一个总时长被记了两遍（生产数据里两条差值中位数仅 207ms
 * ——那只是中间一次 Supabase insert 的往返）。真实的分段耗时只有本服务内部知道，故由本服务测量后回传。
 */
export interface MatchUsageSink {
  /** extractCorpus 一次调用的真实 token 用量 */
  onExtraction?: (usage: LLMUsage) => void
  /** rankQuestions 一次调用（累加内部重试轮次）的真实 token 用量；无候选题时不触发（不会调重排） */
  onRanking?: (usage: LLMUsage) => void
  /** extractCorpus 一次调用的真实墙钟耗时（ms），只覆盖该调用本身，不含漏斗/重排 */
  onExtractionLatency?: (ms: number) => void
  /** rankQuestions 一次调用（含内部重试轮次）的真实墙钟耗时（ms）；无候选题时不触发 */
  onRankingLatency?: (ms: number) => void
  /**
   * 重排流式路逐条【原始打分】到达时的回调（到达序＝分数序）。阶段一的 eval 观测口子，透传 RelevanceScore；
   * 无候选题时不触发。阶段二不改它，另走 onItem 拿富化后的整题。
   */
  onRankingItem?: (r: RelevanceScore) => void
  /**
   * 重排流式路的畸形行统计（供 eval 报「畸形行出现率」+ 整次降级计数）；无候选题时不触发。
   * SINGLE 路径每次调用触发一次；DIM 路径走缓冲不触发。
   */
  onRankingMalformedStats?: (s: RankingStreamStats) => void
  /**
   * 漏斗召回 + 各层命中标记就绪（重排开始前）时回调一次，供接口层发 SSE meta 帧（阶段二）。
   */
  onMeta?: (meta: FunnelStreamMeta) => void
  /**
   * 单题富化完成（已回填 relevanceScore/relevanceReason）即回调，供接口层发 SSE question 帧（阶段二）。
   * 流式重排路：每条打分到达即触发（到达序＝分数序，先降序高分）；
   * 缓冲/DIM 降级路（流式 onItem 未触发）：拿到整份后按最终序补发；未打分残留题也会补发一次。
   */
  onItem?: (q: FunnelMatchedQuestion) => void
}

/**
 * 根据故事文本做三层漏斗真实反向匹配，并对候选题做相关性排名
 * @param cleanedText  整理后的中文故事
 * @param usage        两次 AI 调用的真实用量 + 真实耗时回调（供 route 各记一条账；不传则不回调）
 * @returns            主/副观察点 + 漏斗匹配结果（含 matchedViaSecondary / noMatch / 排名后 questions）
 */
export async function matchByStory(
  cleanedText: string,
  usage?: MatchUsageSink,
): Promise<FunnelMatchResult> {
  // 1. 萃取观察点（主 + 副）｜2. 观察点元信息（code → name + dimensionId）
  // 两者并发：listObservationPoints 是一次纯读 DB，不依赖萃取结果，串行等于白搭 0.2–0.3s。
  // 耗时在 task 内部单独计（不用 Promise.all 前后的时间差）：并发下墙钟是两者的 max，
  // 那样记出来的「萃取耗时」会混进 DB 查询，口径不准。
  const extractionTask = async (): Promise<Awaited<ReturnType<typeof extractCorpus>>> => {
    const t = Date.now()
    const r = await extractCorpus(cleanedText, usage?.onExtraction)
    usage?.onExtractionLatency?.(Date.now() - t)
    return r
  }
  const [extraction, points] = await Promise.all([extractionTask(), listObservationPoints()])
  const pointMeta = new Map(points.map((p) => [p.code, p]))

  // 观察点元信息的二道网。主防线是 extraction 的 taxonomy 白名单校验；能走到这里说明
  // 「prompt 清单」与「DB observation_points」漂移了（DB 少了某个 code）——那是配置事故，必须留证。
  // 不再兜底的理由：旧写法 pointName 退化成裸 code、dimension 硬编码成「情绪内核」，等于凭空捏造一个
  // 维度显示给用户；且该 code 在 DB 里查不到题，召回必然为 0。与其拿假维度骗用户，不如如实判定为
  // 「这个观察点不存在」返回 null：primary 为 null 时下游走既有 noMatch 收尾页，secondary/邻居直接跳过。
  function toMatchedPoint(pick: ExtractionPick | null): MatchedPoint | null {
    if (!pick) return null
    const meta = pointMeta.get(pick.pointCode)
    if (!meta) {
      console.error('[Matching] 观察点 code 在 DB observation_points 中不存在，已按「无此观察点」处理', {
        pointCode: pick.pointCode,
        hint: 'extraction 的 SYSTEM_PROMPT 清单与 DB observation_points 表可能已漂移，请核对',
      })
      return null
    }
    return {
      pointCode: pick.pointCode,
      pointName: meta.name,
      dimension: DIMENSION_LABEL[meta.dimensionId],
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
    allQuestions.push(...primaryHits)

    if (primaryHits.length > 0) {
      // 第一层命中：主维度有题；若 secondary 非空，再追加副维度题作为补充
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
      }
    }

    // 第三层·邻居增援：不论 L1/L2 是否命中，只要召回不足（< NEIGHBOR_MIN）就按优先级借相邻观察点补题，
    // 累计到 ≥NEIGHBOR_TARGET 或邻居用尽即停；seen 去重避免与已召回题重复。命中即标记 matchedViaNeighbor。
    if (allQuestions.length < NEIGHBOR_MIN) {
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
      if (neighborPointsUsed.length > 0) matchedViaNeighbor = true
    }

    noMatch = allQuestions.length === 0
  } else {
    // 理论上萃取保证 primary 非 null，此处作保险兜底
    noMatch = true
  }

  // 漏斗召回 + 各层命中标记已定案（重排开始前）：发一帧 meta 供接口层的 SSE 首帧 / 前端先渲染标题。
  usage?.onMeta?.({
    primary,
    secondary,
    matchedViaSecondary,
    matchedViaNeighbor,
    candidateCount: allQuestions.length,
  })

  // 4. 相关性排名（仅在有候选题时调用；降级返回空数组时回退到漏斗排序）
  if (allQuestions.length > 0) {
    const candidates: CandidateQuestion[] = allQuestions.map((q) => {
      // 题面走单一事实源 questionFace：Part2 cue card 带完整题面（含 "You should say" 约束 bullet），
      // 与盲标表呈现给标注人的题面一致；Part1/3 行为不变。
      const face = questionFace(q)
      return { id: q.id, en: face.en, zh: face.zh, obs: q.pointName }
    })
    // 逐条富化用：id → 召回题对象（onItem 里每条打分到达即回填分数并回调，实现 SSE 增量）。
    const qById = new Map(allQuestions.map((q): [string, FunnelMatchedQuestion] => [q.id, q]))
    const emitted = new Set<string>()  // 已经过 onItem 发出的题 id（避免末尾补发重复）
    const tRanking = Date.now()
    // 默认走流式（SINGLE 路径按分降序逐行吐、可流式保序）；DIM 路径由 rankQuestionsStreaming 内部转缓冲。
    // 仍返回整份 scores（await 到全部到达），route/前端契约一字不变；onItem 逐条把富化后的整题回调给接口层。
    const scores = await rankQuestionsStreaming(cleanedText, candidates, {
      onUsage: usage?.onRanking,
      // 每条打分到达：先透传原始分给阶段一 eval 观测（onRankingItem 不动），再富化映射成整题回调 onItem。
      // 富化时机由「批处理后一次性」改为「逐条到达即映射」，结果与下方批处理回填完全一致（同分数/同降序）。
      onItem: (r) => {
        usage?.onRankingItem?.(r)
        const q = qById.get(r.id)
        if (!q) return
        q.relevanceScore = r.score
        q.relevanceReason = r.reason
        emitted.add(q.id)
        usage?.onItem?.(q)
      },
      onMalformedStats: usage?.onRankingMalformedStats,
    })
    usage?.onRankingLatency?.(Date.now() - tRanking)

    if (scores.length > 0) {
      // 回填前先核对「返回的 id 集合」与「候选 id 集合」。ranking.ts 已在模型边界做过严格对齐，
      // 这里是第二道网（主要兜 fallback 抢救路径）：三类异常一律显式记账，不静默吞掉。
      // 不抛错的取舍：本层只是防御性复核，为一条脏数据整条链路报错、让用户看到错误页，代价大于收益；
      // 真正的拦截点在 ranking.ts 的 validate。
      const candidateIds = new Set(candidates.map((c) => c.id))
      const scoreMap = new Map<string, (typeof scores)[number]>()
      for (const s of scores) {
        if (!candidateIds.has(s.id)) {
          console.error('[Matching] 重排返回了不在候选中的 id，已丢弃', { id: s.id })
          continue
        }
        if (scoreMap.has(s.id)) {
          console.error('[Matching] 重排返回重复 id，保留首次、丢弃后续', {
            id: s.id,
            kept: scoreMap.get(s.id)?.score,
            dropped: s.score,
          })
          continue
        }
        scoreMap.set(s.id, s)
      }
      const missing = [...candidateIds].filter((id) => !scoreMap.has(id))
      if (missing.length > 0) {
        console.warn('[Matching] 部分候选题未拿到重排分（将按未打分展示）', {
          missingCount: missing.length,
          totalCandidates: candidateIds.size,
          missingIds: missing,
        })
      }

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

    // 逐条流未覆盖的题按【最终序】补发 onItem：缓冲/DIM 降级路（流式 onItem 未触发）整批补发（观感接近批），
    // 以及流式路里始终没拿到打分的残留题也补一次，保证接口层的 SSE 增量列表与本函数 return 的整份 questions 一致。
    for (const q of allQuestions) {
      if (!emitted.has(q.id)) usage?.onItem?.(q)
    }
  }

  // 机制①重排整体降级：候选题存在，但重排一分没产出（返回空数组降级 / 或返回分全部与候选对不上）
  // → allQuestions 全部无 relevanceScore。此时置 rankingDegraded 透传前端走「排序暂不可用·重试」态。
  // 红线：绝不给未打分题回填占位分（覆辙 `?? 100`），无分就是无分——这里只是【读】现状、不改任何分。
  // 部分未打分（机制②：至少一道有分）不算降级：它有低分可展示，前端走 B 类。noMatch（无候选）亦非降级。
  const rankingDegraded = allQuestions.length > 0 && allQuestions.every((q) => q.relevanceScore == null)

  return {
    primary,
    secondary,
    questions: allQuestions,
    count: allQuestions.length,
    matchedViaSecondary,
    matchedViaNeighbor,
    neighborPointsUsed,
    noMatch,
    rankingDegraded,
  }
}
