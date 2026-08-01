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
import { createHash } from 'crypto'
import { logErr } from '@/lib/log'
import { getQuestionById } from '@/lib/db/questions'
import { getPersonalAnalysis, upsertPersonalAnalysis } from '@/lib/db/question-analyses'
import { getCorpusByIdServer, getCorpusPrimaryPointCodeServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { generateAnalysis, generateAnalysisStreaming } from '@/services/analysis'
import type { AnalysisStreamSection } from '@/lib/analysis-stream-parse'
import { logApiUsage, qwenPlusCostCny } from '@/lib/api-logger'
import { errorLogMeta, errorKindMeta } from '@/types/errors'
import type { LLMUsage } from '@/lib/llm'
import { requireUserAllowAnon, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { createConcurrencyGate } from '@/lib/concurrency-gate'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { DIMENSION_LABEL, ANON_ANALYSIS_LIMIT, REG_ANALYSIS_DAILY_LIMIT } from '@/lib/constants'
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
}

/** 取 body 里的字符串字段；非字符串/缺省一律回退空串（与旧版 searchParams.get() ?? '' 同语义）。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 个性化缓存的内容哈希：对喂给 AI 的语料正文(story)取 sha256 hex。正文改了→哈希变→命中失效重算。 */
function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * 阻塞式整批分析（现有实现，函数体一字未改，仅由 POST 改名而来）。
 * 作用两处：① `?stream=0` 降级目标（前端读流失败/上游不支持流式时重发，返回普通 JSON）；
 *          ② body.prefetch===true 的后台预取（走预取闸 + metadata.prefetch:true 成本归因，纯暖缓存）。
 * 配额/同意/越权/缓存判定/计费/回填的职责与字段全部保持原样——降级路与预取路的字节等价由此保证。
 */
async function handleBuffered(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    // 同意闸硬前置：分析会把用户故事全文发往千问。未捕获当前版本同意 → 403，绝不外发。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    // body 解析容错：非法/空 JSON 视作空对象，交由下面的 questionId 校验统一回 400
    // （而不是让 req.json() 抛进 catch、白记一条 error 账）。
    const reqBody = await req.json().catch(() => ({})) as AnalysisRequestBody
    const questionId = str(reqBody.questionId)
    const storyId    = str(reqBody.storyId)
    const storyUrl   = str(reqBody.story) || undefined   // 正文兜底
    const isPrefetch = reqBody.prefetch === true         // 仅影响预取闸 + 成本归因，绝不影响计数/同意/越权
    if (!questionId) {
      return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    }
    // 越权防护：storyId 属他人语料则 403（storyId 缺省时走通用分析，无需校验）
    if (storyId) await assertCorpusOwner(userId, storyId)

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
    const storyHash = canCachePersonal && story ? sha256(story) : ''

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
        generateAnalysis({ part: q.part, en: enForAI, zh: q.question_text_zh, story }, (u) => { realUsage = u }),
      )
      // 记账 + 缓存回填走共享 helper（与 handleStreaming 单一真源，杜绝分叉）：详见 logAnalysisUsage/writeAnalysisCache。
      await logAnalysisUsage({ realUsage, enForAI, userId, storyId, t0, isPrefetch })
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
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', metadata: { phase: 'analysis', ...errorLogMeta(e), ...errorKindMeta(e) } })
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
 */
async function logAnalysisUsage(a: {
  realUsage: LLMUsage | null; enForAI: string; userId: string; storyId: string; t0: number; isPrefetch: boolean
}): Promise<void> {
  const usage: LLMUsage = a.realUsage ?? { promptTokens: Math.round(a.enForAI.length * 0.3 + 800), completionTokens: 400 }
  await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: usage.promptTokens + usage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(usage.promptTokens, usage.completionTokens), latency_ms: Date.now() - a.t0, status: 'success', user_id: a.userId, corpus_id: a.storyId || undefined, metadata: { phase: 'analysis', prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, cost_source: a.realUsage ? 'actual' : 'estimate', prefetch: a.isPrefetch } })
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
 * 流式 SSE 分析（默认路，处理真实用户流式请求；预取由 body.prefetch 走 handleBuffered、不到这里）。
 * 开流【前】过鉴权/同意/入参/归属/配额闸（口径与 handleBuffered 逐字一致：无条件 bump——命中缓存也照扣次，
 * 同 buffered；超额 402/429、未同意 403、缺 questionId 400、题不存在 404 → 普通 JSON 早退，不开流、不计费）。
 * 开流【后】：
 *   1) 先发 meta 帧（题目展示信息，AI 前已备好）；
 *   2) 命中个性化缓存 → 拆出全部 section 帧 + done（不调 AI、不写 usage，同 buffered 命中分支）；
 *   3) 未命中 → generateAnalysisStreaming 边生成边发 section 帧；【流末】记账(logAnalysisUsage)+回填缓存
 *      (writeAnalysisCache)，时机从「响应前」挪到「流末」，字段/职责一字不变 → done 帧（完整 AnalysisResponse）；
 *   4) 开流后异常 → 记 error 账（同 buffered catch 口径）+ 发 error 帧让前端降级 ?stream=0。
 */
async function handleStreaming(req: Request): Promise<Response> {
  const t0 = Date.now()
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    const reqBody = await req.json().catch(() => ({})) as AnalysisRequestBody
    const questionId = str(reqBody.questionId)
    const storyId    = str(reqBody.storyId)
    const storyUrl   = str(reqBody.story) || undefined
    if (!questionId) return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    if (storyId) await assertCorpusOwner(userId, storyId)

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
    const storyHash = canCachePersonal && story ? sha256(story) : ''

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
        try {
          // 1) meta 先发（AI 前即备好）
          safeEnqueue(sseFrame('meta', { question: metaQuestion }))

          if (cached) {
            // 2) 命中：拆出全部 section 帧 + done，不调 AI、不写 usage（同 handleBuffered 命中分支）
            for (const s of analysisToSections(cached)) safeEnqueue(sseFrame('section', s))
            safeEnqueue(sseFrame('done', { question: metaQuestion, analysis: cached }))
            controller.close()
            return
          }

          // 3) 未命中：流式生成，逐段发 section 帧
          let realUsage: LLMUsage | null = null
          const analysis = await runWithRawLogContext({ userId, corpusId: storyId || null }, () =>
            generateAnalysisStreaming(
              { part: q.part, en: enForAI, zh: q.question_text_zh, story },
              (section) => safeEnqueue(sseFrame('section', section)),
              (u) => { realUsage = u },
            ),
          )
          // 流末落地：记账 + 回填缓存（时机从「响应前」挪到「流末」，字段/职责与 handleBuffered 一字不变）
          await logAnalysisUsage({ realUsage, enForAI, userId, storyId, t0, isPrefetch: false })
          if (canCachePersonal) await writeAnalysisCache(storyId, q.id, q.season, storyHash, analysis)
          safeEnqueue(sseFrame('done', { question: metaQuestion, analysis }))
          controller.close()
        } catch (e) {
          // 4) 开流后异常：记一条 error 账（与 handleBuffered catch 同口径）+ 发 error 帧让前端降级 ?stream=0。
          await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', metadata: { phase: 'analysis', ...errorLogMeta(e), ...errorKindMeta(e) } }).catch(() => {})
          logErr('[analysis API stream]', e)
          try {
            safeEnqueue(sseFrame('error', { error: '生成分析失败' }))
            controller.close()
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
    // 开流前异常（鉴权/同意/入参/归属/配额/取题）：返回普通 JSON。前端据状态（402/403/429）处理，或降级重发 ?stream=0。
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', metadata: { phase: 'analysis', ...errorLogMeta(e), ...errorKindMeta(e) } })
    logErr('[analysis API stream pre]', e)
    return NextResponse.json({ error: '生成分析失败' }, { status: 500 })
  }
}

/**
 * 分析接口入口：默认走流式 SSE（逐段下发，前端逐块渲染）；`?stream=0` 或 body.prefetch===true 走阻塞式整批
 * JSON（handleBuffered）——前者是读流失败/上游不支持流式的降级目标，后者是后台预取（暖缓存）。
 * 两路的配额/同意/越权/缓存判定/计费/回填职责与字段完全一致（handleStreaming 的计费/缓存写走共享 helper，
 * 与 handleBuffered 内联那份逐字等价，杜绝分叉）。
 */
export async function POST(req: Request): Promise<Response> {
  if (new URL(req.url).searchParams.get('stream') === '0') return handleBuffered(req)
  // 窥探 body.prefetch（用 clone 读，不消费原 req 的 body——下游 handleBuffered/handleStreaming 各自还要 req.json()）。
  let isPrefetch = false
  try {
    const peek = (await req.clone().json()) as { prefetch?: unknown }
    isPrefetch = peek?.prefetch === true
  } catch {
    isPrefetch = false
  }
  return isPrefetch ? handleBuffered(req) : handleStreaming(req)
}
