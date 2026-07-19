/**
 * @module   api/matching
 * @desc     POST 接口：按 corpusId 服务端读取整理后故事 → 萃取观察点 → 返回真实匹配题目（故事正文不进 URL）。
 *           匹配结果按 corpusId 冻结存档：命中（存档存在 且 story_hash 一致 且 algo_version 一致）直接读档返回、
 *           不跑模型；未命中/失效才重算并落档 —— 消除「刷新匹配页看到不同高/中/低」的漂浮。
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { matchByStory, type FunnelMatchResult } from '@/services/matching'
import { logApiUsage, qwenPlusCostCny } from '@/lib/api-logger'
import type { LLMUsage } from '@/lib/llm'
import { getCorpusByIdServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { getMatchSnapshotServer, upsertMatchSnapshotServer } from '@/lib/db/match-snapshots'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireUserAllowAnon, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { logEvent } from '@/lib/events'
import {
  SCORE_HIGH, SCORE_MID, RANKING_ALGO_VERSION,
  ANON_MATCHING_LIMIT, REG_MATCHING_DAILY_LIMIT,
} from '@/lib/constants'
import { env } from '@/lib/env-server'

/** 故事正文 → sha256 十六进制哈希，作为存档失效判定（正文一字未变则命中读档、不重算）。 */
function storyHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 相关性分数 → 匹配档位（< SCORE_MID 不展示亦不入库）。
 *
 * 无 score（重排降级或模型漏题）一律返回 null = 不落库。历史上这里是 `score ?? 100`，
 * 等于把「我们不知道它贴不贴合」永久写成 `match_level='high'`，且下游任何读这张表的
 * 功能都会继承这个谎。展示层可以选择乐观降级（那是产品决策），但落库层不行：
 * 写进库的必须是我们真的知道的事。
 *
 * 2026-07-16：'low' 档随产品方拍板取消（台账 042），< SCORE_MID 一律不入库——
 * 与展示层同一条线，不再有「库里有、界面没有」的档位。
 */
function levelForScore(score: number | undefined): 'high' | 'mid' | null {
  if (score === undefined) return null
  if (score >= SCORE_HIGH) return 'high'
  if (score >= SCORE_MID) return 'mid'
  return null
}

/**
 * 把匹配结果落库：对每个匹配题 upsert 一行（corpus_id,question_id 冲突即更新）。
 * 使用 service_role client，user_id 取自 corpus 行；调用方需 catch，写库失败不阻断匹配返回。
 */
async function persistMatches(corpusId: string, result: FunnelMatchResult): Promise<void> {
  const supabase = getSupabaseServer()
  const { data: corpusRow, error: cErr } = await supabase
    .from('corpus')
    .select('user_id')
    .eq('id', corpusId)
    .maybeSingle()
  if (cErr) throw cErr
  const userId = (corpusRow as { user_id: string } | null)?.user_id
  if (!userId) return

  const rows = result.questions
    .map((q) => ({ q, level: levelForScore(q.relevanceScore) }))
    .filter((x): x is { q: typeof x.q; level: 'high' | 'mid' } => x.level !== null)
    .map((x) => ({ user_id: userId, corpus_id: corpusId, question_id: x.q.id, match_level: x.level }))
  if (rows.length === 0) return

  const { error } = await supabase
    .from('corpus_question_matches')
    .upsert(rows, { onConflict: 'corpus_id,question_id' })
  if (error) throw error
}

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    // 同意闸硬前置：匹配会把整理后故事全文发往千问（萃取 + 重排）。未捕获当前版本同意 → 403，绝不外发。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    const body = (await req.json()) as { corpusId?: unknown }
    const corpusId = typeof body.corpusId === 'string' ? body.corpusId.trim() : ''
    if (!corpusId) {
      return NextResponse.json({ error: 'corpusId 不能为空' }, { status: 400 })
    }
    await assertCorpusOwner(userId, corpusId)
    const cleanedText = (await getCorpusByIdServer(corpusId))?.trim() ?? ''
    if (!cleanedText) {
      return NextResponse.json({ error: '语料无正文或不存在' }, { status: 400 })
    }
    const hash = storyHash(cleanedText)

    // 匹配存档：命中即冻结返回、不跑模型。命中判定 = 开关开 且 存档存在 且 story_hash 一致 且 algo_version 一致。
    // env.matchSnapshotEnabled=false（MATCH_SNAPSHOT_ENABLED=0）时永远未命中 → 回退到每次重算的旧行为（回滚开关）。
    let cached: FunnelMatchResult | null = null
    if (env.matchSnapshotEnabled) {
      const snap = await getMatchSnapshotServer(corpusId)
      if (snap && snap.storyHash === hash && snap.algoVersion === RANKING_ALGO_VERSION) {
        cached = snap.result
      }
    }

    let result: FunnelMatchResult
    const servedFrom: 'fresh' | 'cache' = cached ? 'cache' : 'fresh'
    if (cached) {
      // 读档命中：直接用存档结果，不跑模型、不刷 corpus_question_matches 反查表、不记 usage（无模型调用=无成本）。
      result = cached
    } else {
      // 服务端硬防线：仅「真要跑模型」这一路计次，且在任何 AI 调用之前——超额时不产生任何 AI 费用。
      // 刻意放在读档命中判定【之后】：命中存档不跑模型、零成本，用户重看已匹配结果不该被扣次数。
      // 匿名超上限 → 402(QUOTA_EXCEEDED)；注册超熔断上限 → 429（不带 code，不触发配额弹层）。与 practice 同范式。
      const dailyCount = await bumpDailyUsageServer(userId, 'matching')
      if (isAnonymous ? dailyCount > ANON_MATCHING_LIMIT : dailyCount > REG_MATCHING_DAILY_LIMIT) {
        return isAnonymous
          ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
          : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
      }

      // 未命中/失效：重算 → 落快照 → 保持对 corpus_question_matches 的既有写（反查表不动其职责）。
      // 带 userId + corpusId 归属留证（重排链路的 LLM 调用在 matchByStory 内深处触发 appendRawLog）。
      // matchByStory 内部是【两次】qwen-plus 调用（萃取 + 重排），此前只记了萃取的一条估算、漏了最大的重排。
      // 用两个回调把两次调用的真实 usage 各自接出来，各记一条账；模型没吐 usage 才回退到估算。
      // onUsage 在服务内部同步触发（callLLMJson 返回前回调），await 结束后两个变量已落值。
      let extractionUsage: LLMUsage | null = null
      let rankingUsage: LLMUsage | null = null
      result = await runWithRawLogContext({ userId, corpusId }, () =>
        matchByStory(cleanedText, {
          onExtraction: (u) => { extractionUsage = u },
          onRanking: (u) => { rankingUsage = u },
        }),
      )
      // 持久化匹配结果供反查；写库失败不阻断匹配返回
      await persistMatches(corpusId, result).catch((e) => logErr('[matching persist]', e))
      // 写档：整份结果 + story_hash + algo_version；写档失败不阻断匹配返回（下次重访再补写）。
      await upsertMatchSnapshotServer({ corpusId, userId, result, storyHash: hash, algoVersion: RANKING_ALGO_VERSION })
        .catch((e) => logErr('[matching snapshot upsert]', e))

      // ── 调用 1：萃取（extractCorpus）。萃取必发，恒记一条。
      // 估算兜底：语料字数 × 0.8 token/字 + 系统提示约 1200；输出约 100。
      const exUsage: LLMUsage = extractionUsage ?? { promptTokens: Math.round(cleanedText.length * 0.8 + 1200), completionTokens: 100 }
      await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: exUsage.promptTokens + exUsage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(exUsage.promptTokens, exUsage.completionTokens), latency_ms: Date.now() - t0, status: 'success', user_id: userId, corpus_id: corpusId, metadata: { phase: 'extraction', prompt_tokens: exUsage.promptTokens, completion_tokens: exUsage.completionTokens, cost_source: extractionUsage ? 'actual' : 'estimate' } })

      // ── 调用 2：重排（rankQuestions）。仅在有候选题时才会被调用（noMatch/零候选不发），故按候选数判是否记账。
      // 估算兜底：故事全文 × 0.8 + 全部候选题干字数 × 0.5 + 系统提示约 2000；输出按候选数 × 40。
      if (result.questions.length > 0) {
        const candidateChars = result.questions.reduce((n, q) => n + q.question_text.length + (q.question_text_zh?.length ?? 0), 0)
        const rkUsage: LLMUsage = rankingUsage ?? {
          promptTokens: Math.round(cleanedText.length * 0.8 + candidateChars * 0.5 + 2000),
          completionTokens: result.questions.length * 40,
        }
        await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: rkUsage.promptTokens + rkUsage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(rkUsage.promptTokens, rkUsage.completionTokens), latency_ms: Date.now() - t0, status: 'success', user_id: userId, corpus_id: corpusId, metadata: { phase: 'ranking', prompt_tokens: rkUsage.promptTokens, completion_tokens: rkUsage.completionTokens, candidate_count: result.questions.length, cost_source: rankingUsage ? 'actual' : 'estimate' } })
      }
    }
    // 埋点 match.result（第一周只出裸计数与分布、不设阈值）：观察点分布 + noMatch + 假空率的原料。
    // visibleCount 与 page.tsx 的 totalVisible 同口径（≥SCORE_MID 且已打分）；unscoredCount 为兜底残留数。
    // 假空率 = (noMatch=false 但 visibleCount=0) 的故事 ÷ 故事总数（分母走 flow.corpus_bound 计数，
    // 不用 candidateCount——那是模型能自己控的量，违反分母铁律）。logEvent 内部已吞异常，不阻断返回。
    await logEvent({
      event: 'match.result',
      flowId: req.headers.get('x-flow-id'),
      storyId: corpusId,
      userId,
      props: {
        primaryCode: result.primary?.pointCode ?? null,
        secondaryCode: result.secondary?.pointCode ?? null,
        matchedViaSecondary: result.matchedViaSecondary,
        matchedViaNeighbor: result.matchedViaNeighbor,
        noMatch: result.noMatch,
        candidateCount: result.questions.length,
        visibleCount: result.questions.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_MID).length,
        unscoredCount: result.questions.filter((q) => q.relevanceScore == null).length,
        // 读档命中标 'cache'、重算标 'fresh'：离线口径只在 fresh 上算分布/假空率，避免重访读档被重复计数。
        served_from: servedFrom,
      },
    })
    // 响应 DTO 附 servedFrom（在 route 包一层，不改 matchByStory 的 service 返回契约）：前端可据此区分冻结档/新算。
    return NextResponse.json({ ...result, servedFrom })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' })
    logErr('[matching API]', e)
    return NextResponse.json({ error: '匹配失败' }, { status: 500 })
  }
}
