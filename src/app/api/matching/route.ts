/**
 * @module   api/matching
 * @desc     POST 接口：按 corpusId 服务端读取整理后故事 → 萃取观察点 → 返回真实匹配题目（故事正文不进 URL）。
 *           匹配结果按 corpusId 冻结存档：命中（存档存在 且 story_hash 一致 且 algo_version 一致）直接读档返回、
 *           不跑模型；未命中/失效才重算并落档 —— 消除「刷新匹配页看到不同高/中/低」的漂浮。
 *
 *           存档解决的是【已经跑完之后】的重复；【同时在跑】的重复由 matching-inflight 的进程内单飞兜（2026-08-12）：
 *           快照的读与写之间没有锁，第二个并发请求读档必然未命中 → 生产实测 3.1% 的语料跑了两趟。单飞只包住
 *           「真花钱的那一段」（runMatchOnce 内的 matchByStory），鉴权/同意/归属/熔断/计次一律各请求各过一遍，
 *           读档命中路径一步都不进单飞。搭车成功的请求 servedFrom='joined'：不记 usage、不写档、不刷反查表。
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { matchByStory, type FunnelMatchResult } from '@/services/matching'
import { logApiUsage, qwenPlusCostCny } from '@/lib/api-logger'
import { errorLogMeta, errorKindMeta } from '@/types/errors'
import type { LLMUsage } from '@/lib/llm'
import { getCorpusByIdServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { getBoundQuestionIds } from '@/lib/db/anki-cards-server'
import { getMatchSnapshotServer, upsertMatchSnapshotServer } from '@/lib/db/match-snapshots'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireUserAllowAnon, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
// 落库档位判定抽在 @/lib/match-level（逻辑一字未改，只为可测；见该文件顶注）
import { levelForScore } from '@/lib/match-level'
// 与匹配页共用一份码（两头各拼一次字符串必然漂移，且漂移是静默的：客户端只会把它当普通 400）
import { CORPUS_EMPTY_CODE } from '@/lib/match-ai-result'
import { requireConsent } from '@/lib/consent-server'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { logEvent } from '@/lib/events'
// 候选池明细的契约与上限只认 event-schema（埋点契约唯一真源），本文件不另抄一份形状/上限
import { MATCH_RESULT_CANDIDATES_MAX, type MatchResultCandidate } from '@/lib/event-schema'
import { isQaRequest } from '@/lib/qa-traffic'
import {
  SCORE_MID,
  ANON_MATCHING_LIMIT, REG_MATCHING_DAILY_LIMIT,
} from '@/lib/constants'
import { env } from '@/lib/env-server'
import { requireGlobalBudget } from '@/lib/global-budget-breaker'
import { runMatchOnce, matchRunKey } from '@/lib/matching-inflight'
import {
  attachMatchingAlgorithm,
  isMatchingSnapshotCompatible,
  matchingAlgorithmBlockReason,
  matchingAlgorithmConfig,
  matchingQuestionForClient,
  matchingResultForClient,
  type MatchingAlgorithmConfig,
} from '@/lib/matching-algorithm'

/**
 * 本次结果的来源：
 *  · fresh  —— 本请求自己跑了模型（花了钱）；
 *  · cache  —— 命中匹配存档，零模型调用；
 *  · joined —— 搭上了同一条语料**正在飞**的那一趟（进程内单飞），本请求零模型调用。
 * 离线口径只在 fresh 上算分布/假空率 —— joined 与 cache 同样不该被重复计数（同一趟只该被算一次）。
 */
type ServedFrom = 'fresh' | 'cache' | 'joined'

/** 故事正文 → sha256 十六进制哈希，作为存档失效判定（正文一字未变则命中读档、不重算）。 */
function storyHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
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

/**
 * 把萃取(必发) + 重排(仅有候选题时发)两条 qwen-plus usage 记账推入 afterTasks。
 * handleBuffered 与 handleStreaming 共用同一份，杜绝计费估算/字段两路分叉（此前为逐字复制、易只改一路）。
 * 估算兜底（模型没吐 usage 时）：萃取 = 语料字数×0.8+1200 / 输出100；
 *   重排 = 语料字数×0.8 + 候选题干字数×0.5 + 2000 / 输出 候选数×40。
 * latency_ms 走 matchByStory 内部【分段实测】(extractionMs/rankingMs)，非请求总耗时——
 *   2026-07-20 修正：此前两条都写请求总耗时、把 matching 耗时虚报约一倍，看板须按该时点断开口径。
 * ⚠️ is_anonymous 自 2026-08-07 起补写（此前两条都漏传、落库为 NULL，让看板「匿名 vs 登录成本占比」
 *   两侧都漏算这部分成本）。只修【将来】的数据：历史行仍是 NULL、不追溯改写；看板对历史 NULL 行的处理
 *   见 dashboard-metrics.aggregateUserCosts 顶注（有 user_id 就按该用户【当前】身份归类，NULL 不参与判断）。
 *   该字段只是「调用那一刻的身份」快照，不能拿来判「这个人现在是谁」（转化用户 user_id 不变 + stale JWT）。
 * ⚠️ is_qa 自 2026-08-07（迁移 0059）起必填：产品方无痕自测的匿名号进不了 isInternalAccount 名册，
 *   不标就永远剔不掉。值由调用方 isQaRequest(req, userId) 算好传入（与同一次请求的 match.result 埋点同源，
 *   两边必然一致）。该标记可伪造，只可写统计列，永不参与额度/权限/计费判定。
 */
function pushMatchUsageLogs(
  afterTasks: Promise<unknown>[],
  a: { cleanedText: string; result: FunnelMatchResult; extractionUsage: LLMUsage | null; rankingUsage: LLMUsage | null; extractionMs: number; rankingMs: number; userId: string; isAnonymous: boolean; corpusId: string; isQa: boolean },
): void {
  const exUsage: LLMUsage = a.extractionUsage ?? { promptTokens: Math.round(a.cleanedText.length * 0.8 + 1200), completionTokens: 100 }
  afterTasks.push(logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: exUsage.promptTokens + exUsage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(exUsage.promptTokens, exUsage.completionTokens), latency_ms: a.extractionMs, status: 'success', user_id: a.userId, is_anonymous: a.isAnonymous, is_qa: a.isQa, corpus_id: a.corpusId, metadata: { phase: 'extraction', matching_algo: a.result.matchingAlgo, matching_algo_version: a.result.matchingAlgoVersion, prompt_tokens: exUsage.promptTokens, completion_tokens: exUsage.completionTokens, cost_source: a.extractionUsage ? 'actual' : 'estimate' } }))
  if (a.result.questions.length > 0) {
    const candidateChars = a.result.questions.reduce((n, q) => n + q.question_text.length + (q.question_text_zh?.length ?? 0), 0)
    const rkUsage: LLMUsage = a.rankingUsage ?? {
      promptTokens: Math.round(a.cleanedText.length * 0.8 + candidateChars * 0.5 + 2000),
      completionTokens: a.result.questions.length * 40,
    }
    afterTasks.push(logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: rkUsage.promptTokens + rkUsage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(rkUsage.promptTokens, rkUsage.completionTokens), latency_ms: a.rankingMs, status: 'success', user_id: a.userId, is_anonymous: a.isAnonymous, is_qa: a.isQa, corpus_id: a.corpusId, metadata: { phase: 'ranking', matching_algo: a.result.matchingAlgo, matching_algo_version: a.result.matchingAlgoVersion, prompt_tokens: rkUsage.promptTokens, completion_tokens: rkUsage.completionTokens, candidate_count: a.result.questions.length, cost_source: a.rankingUsage ? 'actual' : 'estimate' } }))
  }
}

/**
 * match.result 埋点 props 的【唯一产出处】：观察点分布 + 命中来源 + noMatch + 可见/未打分计数 +
 * served_from + **候选池逐条明细 candidates**。visibleCount 与前端 totalVisible 同口径。
 *
 * ⚠️ 全站共【三处】发 match.result，全部必须走本函数：handleBuffered 一处 + handleStreaming 的
 * 「快照命中」与「新算」各一处。原先 handleBuffered 是手抄的一份内联字面量（口径逐字相同、
 * 但结构上是第二份真源）—— 2026-08-26 加 candidates 时收归本函数，正是因为「加字段只改了两处」
 * 会让第三条路径上的 candidates 永远缺失，而**缺字段和「候选池真的是空的」长得一模一样**。
 * 规则由 __tests__/match-result-candidates-guard.test.ts 静态守住（三处、且都调本函数）。
 *
 * ⚠️ 本函数只统一了 props，logEvent 的外层字段（flowId / storyId / userId / **isQa**）仍在三处各写各的
 * —— 这就是 2026-08-02 那次「流式两处漏 isQa、生产 match.result 全部 is_qa=false」的成因：
 * 抽了 props 公共函数，容易误以为「口径已经统一了」，而 isQa 根本不在这个函数的管辖范围内。
 * 新增/修改任何外层字段时，请三处一起改，别只看这个函数。
 *
 * 【candidates 的口径】契约（字段含义 / 隐私红线 / 空数组语义 / 上限）全文见
 * `@/lib/event-schema` 的 MatchResultCandidate 与 MATCH_RESULT_CANDIDATES_MAX，改动前必读那两段。
 * 三点在此重申：
 *   ① 【无条件写出】任何一条路径、任何结局都带这个 key。`[]` = 零召回（候选池真是空的），
 *      key 缺失 = 历史行或漏写 —— 两者必须分得开，所以绝不做「没候选就不带」的省略。
 *   ② 【不回填占位分】没拿到分的题写 `score: null`（不是 0、不是 100），与 match-level 同一条红线。
 *   ③ 【只读不改】`.map()` 已产出新数组，`.sort()` 排的是副本 —— 绝不能就地 sort `result.questions`，
 *      那是随后要发给用户的展示序（埋点改展示 = 埋点改产品行为）。
 *
 * @param  result      本次匹配结果（新算 / 读档 / 搭车三种来源共用同一形态）
 * @param  servedFrom  本次结果来源，见 ServedFrom
 * @returns            match.result 的完整 props
 */
function matchResultEventProps(result: FunnelMatchResult, servedFrom: ServedFrom): Record<string, unknown> {
  return {
    primaryCode: result.primary?.pointCode ?? null,
    secondaryCode: result.secondary?.pointCode ?? null,
    matchedViaSecondary: result.matchedViaSecondary,
    matchedViaNeighbor: result.matchedViaNeighbor,
    noMatch: result.noMatch,
    candidateCount: result.questions.length,
    visibleCount: result.questions.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_MID).length,
    unscoredCount: result.questions.filter((q) => q.relevanceScore == null).length,
    served_from: servedFrom,
    matching_algo: result.matchingAlgo ?? null,
    matching_algo_version: result.matchingAlgoVersion ?? null,
    // 按分降序、未打分（null）垫底；sort 稳定 ⇒ 同分保持 matchByStory 的既有次序（isPrimaryMatch → part），
    // 即本数组的顺序就是用户看到的顺序。上限只是安全阀，当前题库（最大 91）永不触发。
    candidates: result.questions
      .map((q): MatchResultCandidate => ({
        id: q.id,
        score: q.relevanceScore ?? null,
        isPrimary: q.isPrimaryMatch,
        obs: q.matched_point,
      }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      .slice(0, MATCH_RESULT_CANDIDATES_MAX),
  }
}

/**
 * 阻塞式整批匹配（现有实现；萃取/重排记账已抽成共享 pushMatchUsageLogs，其余逻辑原样）。
 * 作为流式 SSE 的降级目标：`?stream=0`（前端读流失败/上游不支持流式时重发）走此路，返回普通 JSON。
 * 快照命中/matches/计费/埋点的职责与字段全部保持原样。
 */
async function handleBuffered(req: Request, algorithm: MatchingAlgorithmConfig): Promise<NextResponse> {
  const t0 = Date.now()
  // 失败记账用的归属 + QA 标记：userId/isAnonymous 声明在 try 内、catch 读不到，故在此暂存一份
  // （写法对齐 transcribe 的 attribution）。失败行同样烧过钱，既要能归到人、也要能被剔除自测流量。
  let attribution: { userId: string; isAnonymous: boolean } | null = null
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    attribution = { userId, isAnonymous }
    // 同意闸硬前置：匹配会把整理后故事全文发往千问（萃取 + 重排）。未捕获当前版本同意 → 403，绝不外发。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    const body = (await req.json()) as { corpusId?: unknown }
    const corpusId = typeof body.corpusId === 'string' ? body.corpusId.trim() : ''
    if (!corpusId) {
      return NextResponse.json({ error: 'corpusId 不能为空' }, { status: 400 })
    }
    await assertCorpusOwner(userId, corpusId)

    // 鉴权 / 同意闸 / 归属校验三道安全边界【必须串行且在最前】，绝不为省几百毫秒并进下面这组读。
    // 到这里已确认「是本人的这份语料」，才开始并发读：取正文与取匹配存档互不依赖，
    // 香港节点到 Supabase 单次往返 150–300ms，串行等于白搭一次。
    // 开关关（MATCH_SNAPSHOT_ENABLED=0）时【不发】存档查询，保持「回滚后不查存档」的既有行为。
    const [rawText, snap] = await Promise.all([
      getCorpusByIdServer(corpusId),
      env.matchSnapshotEnabled ? getMatchSnapshotServer(corpusId) : Promise.resolve(null),
    ])
    const cleanedText = rawText?.trim() ?? ''
    if (!cleanedText) {
      // code 是给客户端埋点分流用的【机器可读码】：没有它，本 400 与「corpusId 为空」那种真·输入错
      // 在客户端长得一模一样，只能一起记成 bad_input_400 → 看板归进「用户侧·输入不合格」，
      // 而这件事十有八九是【我们】把 cleaned_text 写空了。指错责任方比不报还坏（会被当噪音略过）。
      return NextResponse.json({ error: '语料无正文或不存在', code: CORPUS_EMPTY_CODE }, { status: 400 })
    }
    const hash = storyHash(cleanedText)

    // 匹配存档：命中即冻结返回、不跑模型。命中判定 = 开关开 且 存档存在 且 story_hash 一致 且 algo_version 一致。
    // env.matchSnapshotEnabled=false（MATCH_SNAPSHOT_ENABLED=0）时永远未命中 → 回退到每次重算的旧行为（回滚开关）。
    const cached: FunnelMatchResult | null =
      snap && snap.storyHash === hash && isMatchingSnapshotCompatible(snap.algoVersion, algorithm)
        ? attachMatchingAlgorithm(snap.result, algorithm)
        : null

    let result: FunnelMatchResult
    // 非 const：搭上别人在飞那趟（单飞 follower）时改判 'joined'，见下方 leader 分支
    let servedFrom: ServedFrom = cached ? 'cache' : 'fresh'
    // 响应前必须落地、但互不依赖的后置任务（留档 / 记账 / 埋点）。
    // 全部先「发出去」再统一 await：见下方 Promise.all 处的错误处理纪律说明。
    const afterTasks: Promise<unknown>[] = []
    if (cached) {
      // 读档命中：直接用存档结果，不跑模型、不刷 corpus_question_matches 反查表、不记 usage（无模型调用=无成本）。
      result = cached
    } else {
      // 全局预算熔断：今日（东八区）全站 AI 花费触线 → 匿名一律拒新调用，注册用户不受影响。
      // 与下面的计次同在 `!cached` 分支内、且在它之前：读档命中零成本不该被拦，被熔断拦下的也不该扣次数。
      const budgetDenied = await requireGlobalBudget(isAnonymous)
      if (budgetDenied) return budgetDenied
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
      //
      // latency_ms 口径变更（2026-07-20）：extractionMs / rankingMs 由 matchByStory 内部【分段实测】。
      // 此前两条日志的 latency_ms 都写 `Date.now() - t0`（从请求入口算起的总耗时），等于把同一个
      // 总时长记了两遍——看板上 matching 的耗时因此被虚报了约一倍（例：实际 19.8s 被读成 39s）。
      // 历史数据无法追溯修正：2026-07-20 之前的 api_usage_logs 里 phase=extraction/ranking 两行
      // 各自都是「请求总耗时」，与本日之后的「单次模型调用耗时」不是同一个量，看趋势图时
      // 必须按这个时间点断开，别把口径修正误读成「性能突然变好了一半」。
      let extractionUsage: LLMUsage | null = null
      let rankingUsage: LLMUsage | null = null
      let extractionMs = 0
      let rankingMs = 0
      // 单飞只包住这一段（真花钱的那趟）。onMeta/onItem 照传：本路自己不发帧，但同一趟可能有个
      // 流式请求搭在上面，它要靠这两个回调拿增量帧。leader=false 即「搭车成功」，模型一次没调。
      const { result: runResult, leader } = await runMatchOnce(
        matchRunKey(corpusId, hash, algorithm.snapshotKey),
        {},
        (emit) => runWithRawLogContext({ userId, corpusId }, async () =>
          attachMatchingAlgorithm(await matchByStory(cleanedText, {
            onExtraction: (u) => { extractionUsage = u },
            onRanking: (u) => { rankingUsage = u },
            onExtractionLatency: (ms) => { extractionMs = ms },
            onRankingLatency: (ms) => { rankingMs = ms },
            onMeta: emit.onMeta,
            onItem: emit.onItem,
          }), algorithm),
        ),
      )
      result = runResult

      if (leader) {
        // 持久化匹配结果供反查；写库失败不阻断匹配返回（.catch 必须留着：台账 115 记过它曾静默失败很久）
        afterTasks.push(persistMatches(corpusId, result).catch((e) => logErr('[matching persist]', e)))
        // 写档：整份结果 + story_hash + algo_version；写档失败不阻断匹配返回（下次重访再补写）。
        // 机制①重排整体降级（rankingDegraded：候选存在但重排一分没产出）不写档——降级=瞬时失败，
        // 冻进快照会让前端降级态的「重试」命中降级档、永不重跑重排，重试形同虚设。跳过写档后，重试重发
        // /api/matching 即未命中→重新跑重排。该守卫只影响机制①这个零频分支，正常结果的写档行为一字不变。
        if (!result.rankingDegraded) {
          afterTasks.push(
            upsertMatchSnapshotServer({ corpusId, userId, result, storyHash: hash, algoVersion: algorithm.snapshotKey })
              .catch((e) => logErr('[matching snapshot upsert]', e)),
          )
        }

        // 萃取(必发) + 重排(有候选才发)两条 usage 记账（估算兜底/字段/口径见 pushMatchUsageLogs；与流式路共用同一份）。
        pushMatchUsageLogs(afterTasks, { cleanedText, result, extractionUsage, rankingUsage, extractionMs, rankingMs, userId, isAnonymous, corpusId, isQa: isQaRequest(req, userId) })
      } else {
        // 搭车成功：模型一次没调，这些全归 leader 做。
        // 记账绝不能补一份（那是记一笔没花的钱）；留档/写快照由 leader 用同一份结果落地，重复写只是白费往返。
        servedFrom = 'joined'
      }
    }
    // 埋点 match.result：观察点分布 + noMatch + 假空率 + 候选池逐条明细（candidates）的原料。
    // visibleCount 与 page.tsx 的 totalVisible 同口径（≥SCORE_MID 且已打分）；unscoredCount 为兜底残留数。
    // 假空率 = (noMatch=false 但 visibleCount=0) 的故事 ÷ 故事总数（分母走 flow.corpus_bound 计数，
    // 不用 candidateCount——那是模型能自己控的量，违反分母铁律）。logEvent 内部已吞异常，不阻断返回。
    // props 走共享的 matchResultEventProps（三条路径唯一真源，见该函数顶注；served_from 由它带出：
    // 读档命中标 'cache'、重算标 'fresh'、搭车标 'joined'，离线口径只在 fresh 上算分布/假空率）。
    afterTasks.push(logEvent({
      event: 'match.result',
      flowId: req.headers.get('x-flow-id'),
      storyId: corpusId,
      userId,
      // 不标 QA 的话，产品方自测的匹配结果会混进 ranking 质量分析（分布/假空率）里
      isQa: isQaRequest(req, userId),
      props: matchResultEventProps(result, servedFrom),
    }))

    // 后置任务统一并行等待。这些写没有一条影响返回给用户的响应体（全是留档、记账、埋点），
    // 但仍必须在返回前落地——serverless 上响应一发，进程随时可能被冻结，fire-and-forget 会丢数据。
    // 串行时香港节点到 Supabase 每次 150–300ms、六次白吃 1–2 秒；并行后墙钟≈最慢的那一次。
    //
    // 错误处理纪律：每个任务在 push 前【各自 catch】，所以 Promise.all 收到的永远是 fulfilled ——
    // 1) persistMatches 的 .catch(logErr) 一字未动，静默失败仍会留 error 证据（台账 115）；
    // 2) 任何一个失败都不会中断 Promise.all 的等待，其余任务照样跑完（这正是不用 rejection 的原因）；
    // 3) 两条 logApiUsage（extraction/ranking）并行发出，但都在这里被 await，仍是「都写」而非「写一条」。
    //    它们原先的先后顺序不承载任何语义（各自独立一行，metadata.phase 自带区分）；
    //    logApiUsage 自身内部已 try/catch 吞异常，故不再叠一层 catch。
    // 4) logEvent 不额外包 catch —— 它内部已吞异常，真抛出来说明是编程错误，
    //    与改动前 `await logEvent(...)` 的行为保持逐字一致（照旧冒泡到外层 catch → 500）。
    await Promise.all(afterTasks)

    // 每题补 ankiSaved（已存对子态）：供匹配页书签入口显示「已存/未存」。匿名一律 false（存对子注册专属，
    // 匿名点存必被 401 拦），故不查库、直接空集。查库失败不阻断匹配返回——降级为全部未存（.catch 留证）。
    // 此态用户/时间相关，不进快照（快照按 corpusId 冻结的是匹配结果本身），每次响应实算。
    let savedIds = new Set<string>()
    if (!isAnonymous && result.questions.length > 0) {
      try {
        savedIds = await getBoundQuestionIds(userId, result.questions.map((q) => q.id))
      } catch (e) {
        logErr('[matching ankiSaved]', e)
      }
    }
    const clientResult = matchingResultForClient(result, algorithm)
    const questionsWithSaved = clientResult.questions.map((q) => ({ ...q, ankiSaved: savedIds.has(q.id) }))

    // 响应 DTO 附 servedFrom（在 route 包一层，不改 matchByStory 的 service 返回契约）：前端可据此区分冻结档/新算。
    return NextResponse.json({ ...clientResult, questions: questionsWithSaved, servedFrom })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    // 失败行补 phase：本 catch 包住 extraction + ranking 两步（都在 matchByStory 内深处），
    // 从 catch 处无法判定挂在哪一步，故用能表意的兜底值 'matching'（看板 PHASE_META 无此键则原样显示，
    // 仍好过掉进空 metadata 的 other 桶）。此处只接系统故障（入参校验在前面已 400 早退），不补 error_kind。
    // 归属三字段（user_id/is_anonymous/is_qa）自 2026-08-07 起补写：此前失败行完全无归属，
    // 既进不了「按用户成本」、也剔不掉自测流量。只补归属，不碰任何计费/错误处理口径。
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', ...(attribution ? { user_id: attribution.userId, is_anonymous: attribution.isAnonymous } : {}), is_qa: isQaRequest(req, attribution?.userId), metadata: { phase: 'matching', matching_algo: algorithm.algo, matching_algo_version: algorithm.version, ...errorLogMeta(e), ...errorKindMeta(e) } })
    logErr('[matching API]', e)
    return NextResponse.json({ error: '匹配失败' }, { status: 500 })
  }
}

/** SSE 响应头：禁缓存/禁转换、关代理缓冲（X-Accel-Buffering=no 关 nginx 层缓冲），保证逐帧实时下发。 */
const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}

/** 编码一帧 SSE 事件。data 走 JSON.stringify 天然无换行，单行即完整 data 段。 */
function sseFrame(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * 补每题 ankiSaved（已存对子态）+ 附 servedFrom，产出 done 帧的完整 DTO。
 * 与 handleBuffered 末尾「questionsWithSaved + servedFrom」逻辑同款（职责/字段一字不变，仅时机挪到流结束）。
 */
async function buildStreamDto(
  result: FunnelMatchResult,
  userId: string,
  isAnonymous: boolean,
  servedFrom: ServedFrom,
  algorithm: MatchingAlgorithmConfig,
): Promise<unknown> {
  let savedIds = new Set<string>()
  if (!isAnonymous && result.questions.length > 0) {
    try {
      savedIds = await getBoundQuestionIds(userId, result.questions.map((q) => q.id))
    } catch (e) {
      logErr('[matching ankiSaved]', e)
    }
  }
  const clientResult = matchingResultForClient(result, algorithm)
  const questionsWithSaved = clientResult.questions.map((q) => ({ ...q, ankiSaved: savedIds.has(q.id) }))
  return { ...clientResult, questions: questionsWithSaved, servedFrom }
}

/**
 * 流式 SSE 匹配（默认路）。统一走 SSE：快照命中也走本通道（一帧 meta + 全 question + done，不调模型）；
 * 未命中则边跑 matchByStory 边发帧，流结束后再落 persist/snapshot/usage/埋点（时机从「响应前」挪到「流结束后」，
 * 职责/字段一字不变），最后发 done。开流【前】的配额/同意闸与 handleBuffered 同口径（超额/未同意直接 JSON 早退，
 * 不开流不计费）；开流【后】异常发 error 帧让前端降级到 ?stream=0。
 */
async function handleStreaming(req: Request, algorithm: MatchingAlgorithmConfig): Promise<Response> {
  const t0 = Date.now()
  // 同 handleBuffered：开流前异常的失败记账要能拿到归属 + QA 标记（userId 在 try 内、外层 catch 读不到）。
  let attribution: { userId: string; isAnonymous: boolean } | null = null
  try {
    // 鉴权 / 同意闸 / 入参 / 归属校验（与 handleBuffered 同口径，必须在开流前过，早退返回普通 JSON）
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    attribution = { userId, isAnonymous }
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    const body = (await req.json()) as { corpusId?: unknown }
    const corpusId = typeof body.corpusId === 'string' ? body.corpusId.trim() : ''
    if (!corpusId) return NextResponse.json({ error: 'corpusId 不能为空' }, { status: 400 })
    await assertCorpusOwner(userId, corpusId)

    const [rawText, snap] = await Promise.all([
      getCorpusByIdServer(corpusId),
      env.matchSnapshotEnabled ? getMatchSnapshotServer(corpusId) : Promise.resolve(null),
    ])
    const cleanedText = rawText?.trim() ?? ''
    // 与 handleBuffered 同口径带 code（两条路必须一致：客户端流式失败会降级重发 ?stream=0，
    // 真正被读到的往往是【降级路】那一条响应，只改一条等于没改）
    if (!cleanedText) return NextResponse.json({ error: '语料无正文或不存在', code: CORPUS_EMPTY_CODE }, { status: 400 })
    const hash = storyHash(cleanedText)
    const cached: FunnelMatchResult | null =
      snap && snap.storyHash === hash && isMatchingSnapshotCompatible(snap.algoVersion, algorithm)
        ? attachMatchingAlgorithm(snap.result, algorithm)
        : null
    const flowId = req.headers.get('x-flow-id')
    // QA 标记在开流【前】算好、闭包带入：两处 match.result 埋点都在 start(controller) 回调里，
    // 回调内重复调用没有收益（isQaRequest 是纯函数，结果不会变）。
    // ⚠️ 2026-08-02 修复：此前这两处漏了 isQa，而前端默认走流式（?stream=0 只是兜底），
    // 导致生产库 match.result 全部 is_qa=false —— 产品方自测数据混进 ranking 质量分析。
    const isQa = isQaRequest(req, userId)

    // 配额硬防线：仅「真要跑模型」这一路计次，且在任何 AI 调用之前——放在读档判定之后（命中存档零成本、不计次）。
    // 匿名超上限 → 402(QUOTA_EXCEEDED)；注册超熔断上限 → 429。与 handleBuffered 同口径，早退返回普通 JSON。
    if (!cached) {
      // 全局预算熔断：与 handleBuffered 同口径同位置（`!cached` 分支内、计次之前），早退返回普通 JSON、不开流。
      const budgetDenied = await requireGlobalBudget(isAnonymous)
      if (budgetDenied) return budgetDenied
      const dailyCount = await bumpDailyUsageServer(userId, 'matching')
      if (isAnonymous ? dailyCount > ANON_MATCHING_LIMIT : dailyCount > REG_MATCHING_DAILY_LIMIT) {
        return isAnonymous
          ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
          : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
      }
    }

    let clientGone = false
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // 客户端断连后 enqueue 会抛：吞掉并置 clientGone，避免异常回灌进重排循环触发误降级/重复调模型。
        const safeEnqueue = (frame: Uint8Array): void => {
          if (clientGone) return
          try {
            controller.enqueue(frame)
          } catch {
            clientGone = true
          }
        }
        // close 同样要守：客户端断连(cancel)后 controller 已关，裸 controller.close() 必抛 TypeError，
        // 会被外层 catch 误当系统故障记一条假 status:error 账、抬高看板故障率。吞掉这个良性异常。
        const safeClose = (): void => {
          try { controller.close() } catch { /* 已 cancel/关闭，close 抛属良性、非系统故障 */ }
        }
        try {
          if (cached) {
            // 快照命中：一帧 meta + 全部 question + done，不调模型、不记 usage（同 handleBuffered 读档分支）
            safeEnqueue(sseFrame('meta', {
              primary: cached.primary,
              secondary: cached.secondary,
              matchedViaSecondary: cached.matchedViaSecondary,
              matchedViaNeighbor: cached.matchedViaNeighbor,
              candidateCount: cached.questions.length,
            }))
            for (const q of cached.questions) {
              const visible = matchingQuestionForClient(q, algorithm)
              if (visible) safeEnqueue(sseFrame('question', visible))
            }
            await logEvent({ event: 'match.result', flowId, storyId: corpusId, userId, isQa, props: matchResultEventProps(cached, 'cache') })
            const dto = await buildStreamDto(cached, userId, isAnonymous, 'cache', algorithm)
            safeEnqueue(sseFrame('done', dto))
            safeClose()
            return
          }

          // 未命中：边跑边发帧。萃取/重排 usage + 分段耗时口径与 handleBuffered 一字不变，仅把落库/记账挪到流结束后。
          let extractionUsage: LLMUsage | null = null
          let rankingUsage: LLMUsage | null = null
          let extractionMs = 0
          let rankingMs = 0
          // 单飞（进程内、按 corpusId+storyHash）：同一条语料在飞时不发第二趟模型调用。
          // 本路把「发帧」当订阅口交给单飞：自己是 leader 时帧由自己这趟产出，搭车时由 leader 那趟扇出
          // （晚到者先回放已发生的 meta/question，再续收后续增量），故两种角色下前端看到的帧序完全一致。
          const { result, leader } = await runMatchOnce(
            matchRunKey(corpusId, hash, algorithm.snapshotKey),
            {
              onMeta: (meta) => safeEnqueue(sseFrame('meta', meta)),
              onItem: (q) => {
                const visible = matchingQuestionForClient(q, algorithm)
                if (visible) safeEnqueue(sseFrame('question', visible))
              },
            },
            (emit) => runWithRawLogContext({ userId, corpusId }, async () =>
              attachMatchingAlgorithm(await matchByStory(cleanedText, {
                onExtraction: (u) => { extractionUsage = u },
                onRanking: (u) => { rankingUsage = u },
                onExtractionLatency: (ms) => { extractionMs = ms },
                onRankingLatency: (ms) => { rankingMs = ms },
                onMeta: emit.onMeta,
                onItem: emit.onItem,
              }), algorithm),
            ),
          )

          // 流结束后落地：persist / snapshot / usage(萃取+重排) / match.result 埋点。
          // 与 handleBuffered 逐字同款（字段/职责一字不变），差别仅在时机：从「响应前」挪到「所有帧发完后」。
          // 搭车（leader=false）时模型一次没调：留档/写档/记账全归 leader，本请求只发帧 + 标 served_from='joined'。
          const afterTasks: Promise<unknown>[] = []
          const servedFrom: ServedFrom = leader ? 'fresh' : 'joined'
          if (leader) {
            afterTasks.push(persistMatches(corpusId, result).catch((e) => logErr('[matching persist]', e)))
            // 机制①降级不写档（与 handleBuffered 同守卫）：冻进快照会让前端降级态的「重试」命中降级档、
            // 永不重跑重排。跳过后重试重发即未命中→重新跑重排。只影响零频降级分支，正常写档不变。
            if (!result.rankingDegraded) {
              afterTasks.push(
                upsertMatchSnapshotServer({ corpusId, userId, result, storyHash: hash, algoVersion: algorithm.snapshotKey })
                  .catch((e) => logErr('[matching snapshot upsert]', e)),
              )
            }
            pushMatchUsageLogs(afterTasks, { cleanedText, result, extractionUsage, rankingUsage, extractionMs, rankingMs, userId, isAnonymous, corpusId, isQa })
          }
          afterTasks.push(logEvent({ event: 'match.result', flowId, storyId: corpusId, userId, isQa, props: matchResultEventProps(result, servedFrom) }))
          await Promise.all(afterTasks)

          const dto = await buildStreamDto(result, userId, isAnonymous, servedFrom, algorithm)
          safeEnqueue(sseFrame('done', dto))
          safeClose()
        } catch (e) {
          // 开流后异常：记一条 error 账（与 handleBuffered catch 同口径）+ 发 error 帧让前端降级到 ?stream=0。
          await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', user_id: userId, is_anonymous: isAnonymous, is_qa: isQa, metadata: { phase: 'matching', matching_algo: algorithm.algo, matching_algo_version: algorithm.version, ...errorLogMeta(e), ...errorKindMeta(e) } }).catch(() => {})
          logErr('[matching API stream]', e)
          try {
            safeEnqueue(sseFrame('error', { error: '匹配失败' }))
            safeClose()
          } catch {
            /* 已断流：前端读流报错，同样走 ?stream=0 降级 */
          }
        }
      },
      cancel() {
        clientGone = true
      },
    })
    return new Response(stream, { headers: SSE_HEADERS })
  } catch (e) {
    // 开流前异常（鉴权/同意/入参/存档读取/配额）：返回普通 JSON。前端据状态（402/403/429）处理，或降级重发 ?stream=0。
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', ...(attribution ? { user_id: attribution.userId, is_anonymous: attribution.isAnonymous } : {}), is_qa: isQaRequest(req, attribution?.userId), metadata: { phase: 'matching', matching_algo: algorithm.algo, matching_algo_version: algorithm.version, ...errorLogMeta(e), ...errorKindMeta(e) } })
    logErr('[matching API stream pre]', e)
    return NextResponse.json({ error: '匹配失败' }, { status: 500 })
  }
}

/**
 * 匹配接口入口：默认走流式 SSE（逐题下发，前端逐条渲染）；`?stream=0` 走阻塞式整批 JSON（handleBuffered），
 * 作为前端读流失败/上游不支持流式时的降级目标。两路的快照/matches/计费职责与字段完全一致。
 */
export async function POST(req: Request): Promise<Response> {
  let algorithm: MatchingAlgorithmConfig
  try {
    algorithm = matchingAlgorithmConfig(env.matchingAlgoRaw)
  } catch (error) {
    logErr('[matching config]', error)
    return NextResponse.json({ error: '匹配算法配置无效', code: 'MATCHING_ALGO_INVALID' }, { status: 503 })
  }
  const blocked = matchingAlgorithmBlockReason(algorithm)
  if (blocked) {
    return NextResponse.json({ error: blocked, code: 'MATCHING_ALGO_NOT_READY' }, { status: 503 })
  }
  const wantsBuffered = new URL(req.url).searchParams.get('stream') === '0'
  return wantsBuffered ? handleBuffered(req, algorithm) : handleStreaming(req, algorithm)
}
