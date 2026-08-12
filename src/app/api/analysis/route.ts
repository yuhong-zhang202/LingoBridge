/**
 * @module   api/analysis
 * @desc     POST { questionId, storyId?, story? } → 取题 + 千问生成侧重点分析（密钥只在服务端）
 *
 *           为什么是 POST 而不是 GET：本接口有副作用——扣每日额度 + 真实调用付费 AI。
 *           GET 在 HTTP 语义上被视为安全/可缓存，浏览器预取、爬虫、链接预览、代理预热都会
 *           自行发起 GET；那些无意的请求会直接烧掉 AI 调用费。改成 POST 后，这类自动化
 *           不会主动触发，费用只由用户的显式操作产生。
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getQuestionById } from '@/lib/db/questions'
import { getPersonalAnalysis, upsertPersonalAnalysis } from '@/lib/db/question-analyses'
import { getCorpusByIdServer, getCorpusPrimaryPointCodeServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { generateAnalysis, generateAnalysisStreaming } from '@/services/analysis'
import type { AnalysisStreamSection } from '@/lib/analysis-stream-parse'
import { logApiUsage, qwenPlusCostCny } from '@/lib/api-logger'
import { isQaRequest } from '@/lib/qa-traffic'
import { errorLogMeta, errorKindMeta } from '@/types/errors'
import type { LLMUsage } from '@/lib/llm'
import { requireUserAllowAnon, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { createConcurrencyGate } from '@/lib/concurrency-gate'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { DIMENSION_LABEL, ANON_ANALYSIS_LIMIT, REG_ANALYSIS_DAILY_LIMIT } from '@/lib/constants'
import { requireGlobalBudget } from '@/lib/global-budget-breaker'
// 缓存口径（level 收敛 + content_hash 构造）与 /api/analysis/phrases 共用一份：两路读写同一张
// corpus_question_analyses，哈希差一个字节就互相永不命中，且失效是静默的。详见 analysis-cache 顶注。
import { sanitizeLevel, contentHashOf } from '@/lib/analysis-cache'
import type { AnalysisResponse, DimensionLabel, QuestionAnalysis } from '@/lib/types'

// 预取专用并发闸（全服务器模块级单例）：只护上游 DashScope，【不护本机 CPU】——LLM 调用是 I/O、不吃
// CPU，与 ASR（ffmpeg 转码受 2vCPU 限）本质不同，故不必压到核数。
// maxConcurrent=3 而非 1：此闸全服务器共享，1 = 整台机同时只允许 1 个预取；一次 analysis ~12s → 全服务器
// 每分钟仅 ~5 次预取，10 人同时在匹配页时 9 人的预取会被拒 = 最需要时失效。真实用户请求【不走此闸】，
// 故预取永远排在真实请求之后、绝不拖慢它们；3 是「护上游 vs 预取有效性」的折中起点，可按 DashScope 限流后调。
// 队列小 + 等待短：预取是 best-effort，满即快速拒（503）由客户端静默弃、不堆积不重试。
const analysisPrefetchGate = createConcurrencyGate({ maxConcurrent: 3, maxQueue: 6, maxWaitMs: 4_000 })

// 观察点 code 前缀 → 维度 id
const PREFIX_DIM: Record<string, keyof typeof DIMENSION_LABEL> = {
  EMO: 'emotion', REL: 'relationship', SPA: 'space', SPI: 'spirit', GRO: 'growth', VALUE: 'value',
}
function dimFromCode(code: string | undefined): DimensionLabel | null {
  if (!code) return null
  const dim = PREFIX_DIM[code.split('_')[0]]
  return dim ? DIMENSION_LABEL[dim] : null
}

/** 请求体形状：字段来源同旧版 query string，仅传输位置从 URL 改为 body。 */
interface AnalysisRequestBody {
  questionId?: unknown
  storyId?: unknown
  /** 故事正文兜底：DB 读不到 storyId 对应语料时用它（历史上由 URL 携带，现随 body 走） */
  story?: unknown
  /** 后台预取标志：仅影响「走预取并发闸 + metadata.prefetch:true 成本归因」，【绝不】影响计数/同意/越权。 */
  prefetch?: unknown
  /** 目标雅思水平：只调 phrases 词组表达难度；折进缓存 content_hash（不同档视作不同内容），缺省 '6.0'。 */
  level?: unknown
}

/** 取 body 里的字符串字段；非字符串/缺省一律回退空串（与旧版 searchParams.get() ?? '' 同语义）。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * 阻塞式整批分析（现有实现，函数体一字未改）。
 * 现仅剩一个作用：`?stream=0` 降级目标（前端读流失败/上游不支持流式时重发，返回普通 JSON）。
 * 后台预取自 2026-08-01 阶段三起【改走 handleStreaming】（真·统一流式），不再进本函数——故本函数内的
 * isPrefetch 现恒为 false（降级路是真实用户请求，不带 prefetch）、预取闸 slot 恒 null：那段取闸/释放是
 * 死代码但无害（与 handleStreaming 计费共享 helper、字节等价，保留以维持两路对称、不动它）。
 * 配额/同意/越权/缓存判定/计费/回填的职责与字段全部保持原样——降级路与流式路的字节等价由此保证。
 */
async function handleBuffered(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  // 失败记账用的归属 + QA 标记：userId/isAnonymous 声明在 try 内、catch 读不到，故在此暂存一份
  // （写法对齐 transcribe 的 attribution）。失败行同样烧过钱，既要能归到人、也要能被剔除自测流量。
  let attribution: { userId: string; isAnonymous: boolean } | null = null
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    attribution = { userId, isAnonymous }
    // 同意闸硬前置：分析会把用户故事全文发往千问。未捕获当前版本同意 → 403，绝不外发。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    // body 解析容错：非法/空 JSON 视作空对象，交由下面的 questionId 校验统一回 400
    // （而不是让 req.json() 抛进 catch、白记一条 error 账）。
    const reqBody = await req.json().catch(() => ({})) as AnalysisRequestBody
    const questionId = str(reqBody.questionId)
    const storyId    = str(reqBody.storyId)
    const storyUrl   = str(reqBody.story) || undefined   // 正文兜底
    const level      = sanitizeLevel(reqBody.level)       // 缺省 6.0（照 phrases/route 读法）；折进缓存 hash + 传给 AI
    const isPrefetch = reqBody.prefetch === true         // 仅影响预取闸 + 成本归因，绝不影响计数/同意/越权
    if (!questionId) {
      return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    }
    // 越权防护：storyId 属他人语料则 403（storyId 缺省时走通用分析，无需校验）
    if (storyId) await assertCorpusOwner(userId, storyId)

    // 全局预算熔断：今日（东八区）全站 AI 花费触线 → 匿名一律拒新调用，注册用户不受影响。
    // 位置与下面的额度闸同一处（在它之前）：该闸「命中缓存也照扣次」的口径本就是本路由既有的判断，
    // 熔断沿用它，不在这条路由上另做一套「哪些算数」的判断。
    const budgetDenied = await requireGlobalBudget(isAnonymous)
    if (budgetDenied) return budgetDenied

    // 服务端硬防线：计次在任何 AI 调用之前——超额时不产生任何 AI 费用。
    // 本路由可传任意 questionId 反复调，是最易被脚本刷的一跳。
    // 位置选在入参校验后、读故事/取题之前：超额请求连 DB 都少打，且失败请求不会先扣次数再 400。
    // 匿名超上限 → 402(QUOTA_EXCEEDED)；注册超熔断上限 → 429（不带 code，不触发配额弹层）。与 practice 同范式。
    const dailyCount = await bumpDailyUsageServer(userId, 'analysis')
    if (isAnonymous ? dailyCount > ANON_ANALYSIS_LIMIT : dailyCount > REG_ANALYSIS_DAILY_LIMIT) {
      return isAnonymous
        ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
        : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
    }

    // DB 优先读故事；读不到或 storyId 缺失则退回 URL 里的 story；都无则走通用分析
    let story: string | undefined
    try {
      const dbStory = storyId ? await getCorpusByIdServer(storyId) : null
      story = dbStory ?? storyUrl
    } catch {
      story = storyUrl
    }

    const q = await getQuestionById(questionId)
    if (!q) {
      return NextResponse.json({ error: '题目不存在' }, { status: 404 })
    }

    // 维度标签取「用户语料匹配到的维度」：读匹配时挑定的主观察点维度，取不到再回落题目第一个观察点维度。
    // 只影响展示用的 dimension 字段，不进 AI 入参；读库失败静默回落，不 500、不阻塞分析主流程。
    let dimension: DimensionLabel | null = null
    if (storyId) {
      const primaryCode = await getCorpusPrimaryPointCodeServer(storyId)
      dimension = dimFromCode(primaryCode ?? undefined)
    }
    if (dimension === null) dimension = dimFromCode(q.observation_points[0])

    // ── 个性化分析缓存（corpus_question_analyses，按 (题,语料) + 内容哈希，隐私、随语料删除）──
    // 复练秒开：同一用户对同一 (题,语料) 复练时读档、不再实时调 AI。可缓存判定（红线，逐条硬守）：
    //  1) story 非空（解析后真喂给 AI 的语料正文）——命中/写键于此，不是 body 参数。
    //  2) storyId 存在（真实 corpus，非 storyUrl 兜底）——只缓存能追溯到具体语料、能随语料 CASCADE 的分析。
    //  5) part 守卫：仅 part1/2。
    // 通用（无语料）路径【不缓存】：现实中几乎无入口不带语料进分析页（题库/匹配/整理/素材库全带 storyId），
    // 通用缓存只惠及一条防御性兜底死路、价值近零，故不设，保持路由简洁。
    const canCachePersonal = !!story && !!storyId && (q.part === 1 || q.part === 2)
    // story 非空才求哈希（canCachePersonal 蕴含 story 非空）；story 变量已经过 DB/兜底解析，是 AI 实际看到的文本。
    // 折进 level：不同目标分的词组不同，须视作不同缓存内容（读命中/写回填同口径，见 contentHashOf）。
    const storyHash = canCachePersonal && story ? contentHashOf(story, level) : ''

    // 缓存读（命中判定）：仅个性化。读彻底降级（红线 3）：任何查询错/异常一律静默当未命中，走真实 AI 调用，绝不 500。
    let cached: QuestionAnalysis | null = null
    if (canCachePersonal) {
      // 个性化【三重命中】：键(corpus_id,question_id) 命中 且 season 一致 且 content_hash === sha256(当前 story)。
      // content_hash 校验是本方案核心正确性（红线 4）：改故事→哈希变→未命中→重算，绝不返回旧语料的分析。
      try {
        const row = await getPersonalAnalysis(storyId, q.id)
        if (row && row.season === q.season && row.contentHash === storyHash) cached = row.analysis
      } catch (e) {
        logErr('[analysis API] 个性化缓存读失败，降级为未命中', e)
        cached = null
      }
    }

    // Part 2：完整 cue card 喂 AI，展示用短标题
    const enForAI = q.question_text
    const enForDisplay = q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text
    const zhForDisplay = q.part === 2 ? (q.cue_card_title_zh ?? '') : (q.question_text_zh ?? '')

    let analysis: QuestionAnalysis
    if (cached) {
      // 命中：直接用缓存组装返回。无真实 AI 调用 → 不写 api_usage_logs（红线 5，写了会污染成本看板）。
      // bumpDailyUsageServer 已在前面扣过次（防刷闸），命中也照扣、正确，此处不再动。
      analysis = cached
    } else {
      // 未命中：真调 AI。预取走独立并发闸（护上游 DashScope、不拖真实请求；满/超时→503，客户端静默弃）；
      // 真实用户请求 slot=null、不走闸。⚠️ 闸在 bumpDailyUsage【之后】：预取照常已计数（防刷、无绕过），
      // 闸满被拒的预取也已计过次、只是不产 AI（可接受，且极罕见——需全服务器 >3 并发预取）。
      const slot = isPrefetch ? await analysisPrefetchGate.acquire() : null
      if (slot && !slot.ok) return NextResponse.json({ error: '预取繁忙' }, { status: 503 })
      try {
      // corpusId 取 storyId（有则带、无则 null）：留证可回溯到具体语料。
      // 优先记模型真实 usage；模型没吐 usage 才回退到按题目长度的估算（英文约 0.3 token/字 + 系统提示约 800）。
      // onUsage 在服务内部同步触发（callLLMJson 返回前回调），await 结束后 realUsage 已落值。
      let realUsage: LLMUsage | null = null
      analysis = await runWithRawLogContext({ userId, corpusId: storyId || null }, () =>
        generateAnalysis({ part: q.part, en: enForAI, zh: q.question_text_zh, story, level }, (u) => { realUsage = u }),
      )
      // 记账 + 缓存回填走共享 helper（与 handleStreaming 单一真源，杜绝分叉）：详见 logAnalysisUsage/writeAnalysisCache。
      await logAnalysisUsage({ realUsage, enForAI, userId, isAnonymous, storyId, t0, isPrefetch, isQa: isQaRequest(req, userId) })
      if (canCachePersonal) await writeAnalysisCache(storyId, q.id, q.season, storyHash, analysis)
      } finally {
        // 名额必须归还（成功/抛错都要），否则预取闸越关越死。真实请求 slot=null、跳过。
        if (slot && slot.ok) slot.release()
      }
    }

    const body: AnalysisResponse = {
      question: {
        id: q.id,
        part: q.part,
        en: enForDisplay,
        zh: zhForDisplay,
        dimension,
        isNew: q.is_new,
      },
      analysis,
    }
    return NextResponse.json(body)
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    // 失败行补 phase（与成功分支同值 'analysis'），避免空 metadata 掉进看板 other 桶、辨不出环节。
    // 此处只接 AI/系统故障（缺 questionId、题目不存在在前面已 400/404 早退），故不补 error_kind。
    // 归属三字段（user_id/is_anonymous/is_qa）自 2026-08-07 起补写：此前失败行完全无归属，
    // 既进不了「按用户成本」、也剔不掉自测流量。只补归属，不碰任何计费/错误处理口径。
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', ...(attribution ? { user_id: attribution.userId, is_anonymous: attribution.isAnonymous } : {}), is_qa: isQaRequest(req, attribution?.userId), metadata: { phase: 'analysis', ...errorLogMeta(e), ...errorKindMeta(e) } })
    logErr('[analysis API]', e)
    return NextResponse.json({ error: '生成分析失败' }, { status: 500 })
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
 * 计费记账（共享 helper，handleBuffered + handleStreaming 单一真源）：未命中真调 AI 后记一条 qwen_plus usage。
 * 模型真实 usage 优先、无则按题长估算（0.3/字+800，输出 400）；metadata 的 phase/prompt_tokens/
 * completion_tokens/cost_source/prefetch 字段与职责固定。两路共用此一份，改这里即两路同步、不会分叉。
 * ⚠️ is_anonymous 自 2026-08-07 起补写（此前本路由漏传、落库为 NULL，让看板「匿名 vs 登录成本占比」
 *    两侧都漏算这部分成本）。只修【将来】的数据：历史行仍是 NULL、不追溯改写；看板对历史 NULL 行的处理
 *    见 dashboard-metrics.aggregateUserCosts 顶注（有 user_id 就按该用户当前身份归类，NULL 不参与判断）。
 *    该字段只是「调用那一刻的身份」快照，不能拿来判「这个人现在是谁」（转化用户 user_id 不变 + stale JWT）。
 * ⚠️ is_qa 自 2026-08-07（迁移 0059）起必填：产品方无痕自测的匿名号进不了 isInternalAccount 名册，
 *    不标就永远剔不掉。值由调用方 isQaRequest(req, userId) 算好传入（本 helper 没有 req）。
 *    该标记可伪造，只可写统计列，永不参与额度/权限/计费判定。
 */
async function logAnalysisUsage(a: {
  realUsage: LLMUsage | null; enForAI: string; userId: string; isAnonymous: boolean; storyId: string; t0: number; isPrefetch: boolean
  /** 是否记作 QA 自测流量（0059）：由调用方用 isQaRequest(req, userId) 算好传入——本 helper 拿不到 req。 */
  isQa: boolean
}): Promise<void> {
  const usage: LLMUsage = a.realUsage ?? { promptTokens: Math.round(a.enForAI.length * 0.3 + 800), completionTokens: 400 }
  await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: usage.promptTokens + usage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(usage.promptTokens, usage.completionTokens), latency_ms: Date.now() - a.t0, status: 'success', user_id: a.userId, is_anonymous: a.isAnonymous, is_qa: a.isQa, corpus_id: a.storyId || undefined, metadata: { phase: 'analysis', prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, cost_source: a.realUsage ? 'actual' : 'estimate', prefetch: a.isPrefetch } })
}

/**
 * 个性化缓存回填（共享 helper，handleBuffered + handleStreaming 单一真源）：真调成功后 upsert (题,语料) 分析。
 * 三重命中键/content_hash/season/CASCADE/RLS 固定；写失败吞掉、只 logErr、绝不因回填失败把请求变 500。
 * 两路共用此一份，改这里即两路同步、不会分叉。
 */
async function writeAnalysisCache(
  storyId: string, questionId: string, season: string, storyHash: string, analysis: QuestionAnalysis,
): Promise<void> {
  try {
    await upsertPersonalAnalysis(storyId, questionId, season, storyHash, analysis)
  } catch (e) {
    logErr('[analysis API] 个性化缓存写失败，忽略', e)
  }
}

/** 把一份完整 analysis 拆成 section 帧序（structureLabel → focusPoints → phraseGroups），供缓存命中分支回放。 */
function analysisToSections(analysis: QuestionAnalysis): AnalysisStreamSection[] {
  const out: AnalysisStreamSection[] = []
  if (typeof analysis.structureLabel === 'string' && analysis.structureLabel) {
    out.push({ kind: 'structureLabel', value: analysis.structureLabel })
  }
  for (const fp of analysis.focusPoints) out.push({ kind: 'focusPoint', value: fp })
  for (const g of analysis.phrases) out.push({ kind: 'phraseGroup', value: g })
  return out
}

/**
 * 流式 SSE 分析（默认路，处理真实用户流式请求【与后台预取】——预取现也走流式，仅多带 body.prefetch:true）。
 * 开流【前】过鉴权/同意/入参/归属/配额闸（口径与 handleBuffered 逐字一致：无条件 bump——命中缓存也照扣次，
 * 同 buffered；超额 402/429、未同意 403、缺 questionId 400、题不存在 404 → 普通 JSON 早退，不开流、不计费）。
 * 预取闸（isPrefetch && !cached 才取）在【算完 cached、开流之前】取——命中缓存不调 AI、不取闸（同 handleBuffered
 * 口径）；真实用户 slot=null 不走闸，永远排在预取之前。闸满 → 503 普通 JSON 早退，客户端静默弃。
 * 开流【后】：
 *   1) 先发 meta 帧（题目展示信息，AI 前已备好）；
 *   2) 命中个性化缓存 → 拆出全部 section 帧 + done（不调 AI、不写 usage，同 buffered 命中分支；slot 恒 null）；
 *   3) 未命中 → generateAnalysisStreaming 边生成边发 section 帧；【流末】记账(logAnalysisUsage，传真实 isPrefetch)
 *      +回填缓存(writeAnalysisCache)，时机从「响应前」挪到「流末」，字段/职责一字不变 → done 帧 → 释放预取闸名额；
 *   4) 开流后异常 → 记 error 账（同 buffered catch 口径）+ 发 error 帧让前端降级 ?stream=0 → 释放预取闸名额；
 *   5) 客户端中途断连（cancel）→ 释放预取闸名额。三条出路经 releaseSlot 幂等标志保证【恰好释放一次】不泄漏。
 */
async function handleStreaming(req: Request): Promise<Response> {
  const t0 = Date.now()
  // 同 handleBuffered：开流前异常的失败记账要能拿到归属 + QA 标记（userId 在 try 内、外层 catch 读不到）。
  let attribution: { userId: string; isAnonymous: boolean } | null = null
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    attribution = { userId, isAnonymous }
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    const reqBody = await req.json().catch(() => ({})) as AnalysisRequestBody
    const questionId = str(reqBody.questionId)
    const storyId    = str(reqBody.storyId)
    const storyUrl   = str(reqBody.story) || undefined
    const level      = sanitizeLevel(reqBody.level)       // 缺省 6.0；折进缓存 hash + 传给 AI（与 handleBuffered 同口径）
    const isPrefetch = reqBody.prefetch === true         // 仅影响预取闸 + 成本归因，绝不影响计数/同意/越权（同 handleBuffered）
    if (!questionId) return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    if (storyId) await assertCorpusOwner(userId, storyId)

    // 全局预算熔断：与 handleBuffered 同口径同位置（在 bump 之前），超额早退普通 JSON、不开流。
    const budgetDenied = await requireGlobalBudget(isAnonymous)
    if (budgetDenied) return budgetDenied

    // 配额硬防线：与 handleBuffered 同口径同位置——无条件 bump（命中缓存也照扣次），超额早退普通 JSON、不开流。
    const dailyCount = await bumpDailyUsageServer(userId, 'analysis')
    if (isAnonymous ? dailyCount > ANON_ANALYSIS_LIMIT : dailyCount > REG_ANALYSIS_DAILY_LIMIT) {
      return isAnonymous
        ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
        : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
    }

    // 读故事 / 取题 / 维度 / 缓存判定：全部沿用 handleBuffered 现有逻辑（字段/职责一字不变）。
    let story: string | undefined
    try {
      const dbStory = storyId ? await getCorpusByIdServer(storyId) : null
      story = dbStory ?? storyUrl
    } catch {
      story = storyUrl
    }

    const q = await getQuestionById(questionId)
    if (!q) return NextResponse.json({ error: '题目不存在' }, { status: 404 })

    let dimension: DimensionLabel | null = null
    if (storyId) {
      const primaryCode = await getCorpusPrimaryPointCodeServer(storyId)
      dimension = dimFromCode(primaryCode ?? undefined)
    }
    if (dimension === null) dimension = dimFromCode(q.observation_points[0])

    const canCachePersonal = !!story && !!storyId && (q.part === 1 || q.part === 2)
    // 折进 level（同 handleBuffered）：不同目标分视作不同缓存内容，读命中/写回填同口径。
    const storyHash = canCachePersonal && story ? contentHashOf(story, level) : ''

    let cached: QuestionAnalysis | null = null
    if (canCachePersonal) {
      try {
        const row = await getPersonalAnalysis(storyId, q.id)
        if (row && row.season === q.season && row.contentHash === storyHash) cached = row.analysis
      } catch (e) {
        logErr('[analysis API] 个性化缓存读失败，降级为未命中', e)
        cached = null
      }
    }

    const enForAI = q.question_text
    const enForDisplay = q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text
    const zhForDisplay = q.part === 2 ? (q.cue_card_title_zh ?? '') : (q.question_text_zh ?? '')

    // meta 帧的题目展示信息（与 handleBuffered 返回体 question 字段同源同值）。
    const metaQuestion = { id: q.id, part: q.part, en: enForDisplay, zh: zhForDisplay, dimension, isNew: q.is_new }

    // 预取并发闸：只在【预取 且 未命中缓存】才取（命中不调 AI、无需护上游；真实用户 slot=null 不走闸——与
    // handleBuffered 同口径）。取在【开流前】：闸满即 503 普通 JSON 早退，不开流、不计费，客户端静默弃。
    const slot = (!cached && isPrefetch) ? await analysisPrefetchGate.acquire() : null
    if (slot && !slot.ok) return NextResponse.json({ error: '预取繁忙' }, { status: 503 })
    // 幂等释放：miss 成功（done 后）/ 开流后异常 / 客户端断连（cancel）三条出路各调一次，released 标志保证【恰好一次】
    // 不双释（否则名额凭空变多、预取闸失效）。cancel 可能与 start 的成功/异常路竞态触发，此标志是防泄漏关键。
    let slotReleased = false
    const releaseSlot = (): void => {
      if (slot && slot.ok && !slotReleased) { slotReleased = true; slot.release() }
    }

    let clientGone = false
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // 客户端断连后 enqueue 会抛：吞掉并置 clientGone，避免异常回灌触发误处理。
        const safeEnqueue = (frame: Uint8Array): void => {
          if (clientGone) return
          try {
            controller.enqueue(frame)
          } catch {
            clientGone = true
          }
        }
        // close 同样要守：客户端断连(cancel)后 controller 已进 closed 态，裸 controller.close() 必抛 TypeError，
        // 会被外层 catch 误当系统故障【记一条假 status:error 的 usage 账】、凭空抬高看板故障率。吞掉这个良性异常。
        const safeClose = (): void => {
          try { controller.close() } catch { /* 已 cancel/关闭，close 抛属良性、非系统故障 */ }
        }
        try {
          // 1) meta 先发（AI 前即备好）
          safeEnqueue(sseFrame('meta', { question: metaQuestion }))

          if (cached) {
            // 2) 命中：拆出全部 section 帧 + done，不调 AI、不写 usage（同 handleBuffered 命中分支）
            for (const s of analysisToSections(cached)) safeEnqueue(sseFrame('section', s))
            safeEnqueue(sseFrame('done', { question: metaQuestion, analysis: cached }))
            safeClose()
            return
          }

          // 3) 未命中：流式生成，逐段发 section 帧
          let realUsage: LLMUsage | null = null
          const analysis = await runWithRawLogContext({ userId, corpusId: storyId || null }, () =>
            generateAnalysisStreaming(
              { part: q.part, en: enForAI, zh: q.question_text_zh, story, level },
              (section) => safeEnqueue(sseFrame('section', section)),
              (u) => { realUsage = u },
            ),
          )
          // 流末落地：记账（传真实 isPrefetch，预取的成本归因 metadata.prefetch 才对）+ 回填缓存
          // （时机从「响应前」挪到「流末」，字段/职责与 handleBuffered 一字不变）。
          await logAnalysisUsage({ realUsage, enForAI, userId, isAnonymous, storyId, t0, isPrefetch, isQa: isQaRequest(req, userId) })
          if (canCachePersonal) await writeAnalysisCache(storyId, q.id, q.season, storyHash, analysis)
          safeEnqueue(sseFrame('done', { question: metaQuestion, analysis }))
          releaseSlot()   // 成功出路：AI + 缓存写跑完、done 帧后释放预取闸名额
          safeClose()
        } catch (e) {
          // 4) 开流后异常：记一条 error 账（与 handleBuffered catch 同口径）+ 发 error 帧让前端降级 ?stream=0。
          await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', user_id: userId, is_anonymous: isAnonymous, is_qa: isQaRequest(req, userId), metadata: { phase: 'analysis', ...errorLogMeta(e), ...errorKindMeta(e) } }).catch(() => {})
          logErr('[analysis API stream]', e)
          releaseSlot()   // 异常出路：释放预取闸名额
          try {
            safeEnqueue(sseFrame('error', { error: '生成分析失败' }))
            safeClose()
          } catch {
            /* 已断流：前端读流报错，同样走 ?stream=0 降级 */
          }
        }
      },
      cancel() {
        // 客户端中途断连出路：释放预取闸名额（可能与 start 成功/异常路竞态，releaseSlot 幂等只释一次）。
        clientGone = true
        releaseSlot()
      },
    })
    return new Response(stream, { headers: SSE_HEADERS })
  } catch (e) {
    // 开流前异常（鉴权/同意/入参/归属/配额/取题）：返回普通 JSON。前端据状态（402/403/429）处理，或降级重发 ?stream=0。
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', ...(attribution ? { user_id: attribution.userId, is_anonymous: attribution.isAnonymous } : {}), is_qa: isQaRequest(req, attribution?.userId), metadata: { phase: 'analysis', ...errorLogMeta(e), ...errorKindMeta(e) } })
    logErr('[analysis API stream pre]', e)
    return NextResponse.json({ error: '生成分析失败' }, { status: 500 })
  }
}

/**
 * 分析接口入口：默认走流式 SSE（逐段下发，前端逐块渲染）——真实用户点击【与后台预取】都走这条（预取仅多带
 * body.prefetch:true，由 handleStreaming 内部据此走预取闸 + 成本归因）。仅 `?stream=0` 走阻塞式整批 JSON
 * （handleBuffered），它是读流失败/上游不支持流式时前端重发的【降级目标】。
 * 两路的配额/同意/越权/缓存判定/计费/回填职责与字段完全一致（handleStreaming 的计费/缓存写走共享 helper，
 * 与 handleBuffered 内联那份逐字等价，杜绝分叉）。
 */
export async function POST(req: Request): Promise<Response> {
  if (new URL(req.url).searchParams.get('stream') === '0') return handleBuffered(req)
  return handleStreaming(req)
}
