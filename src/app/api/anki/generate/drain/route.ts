/**
 * @module   api/anki/generate/drain
 * @desc     Anki 卡背生成 drain 处理器（内部 / cron 端点）：批量领取 pending 生成任务 → 逐条调模型生成 →
 *           成功回填 anki_cards.generated_answer + 任务置 done；失败按指数退避重试、超次判死信 failed。
 *
 *   为什么是独立后台端点（方案 §1）：卡背生成是后台 AI 调用，serverless「发了就忘」会随实例回收丢单，
 *   故必须落队列（0031）由本处理器幂等领取执行、失败可退避重试。
 *
 *   鉴权（red-team §12）：本端点没有用户 session、外发用户中文语料给千问，绝不能裸奔。请求头
 *   x-anki-drain-secret 必须等于 env.ankiDrainSecret（固定时间比较），不匹配 / 密钥未配一律 401（fail closed）。
 *
 *   不分档（v0.3 砍 band）：分点式短例句统一「自然达标口语」一个目标、不再按用户 band 定档，
 *   故本处理器不再取 band / tier（原 resolveTargetBand / bandToTier 已随生成器分点式重写移除）。
 *
 *   限流（方案 §2）：单次最多领 ANKI_DRAIN_BATCH 条；领到的任务按卡主 user_id 分桶，桶间限并发
 *   ANKI_DRAIN_CONCURRENCY、桶内串行（= 按 user 串行 + 全局限并发）。领取本身用 0033 的
 *   claim_anki_generation_jobs（FOR UPDATE SKIP LOCKED），多实例并发不抢同一单。
 * @author   LingoBridge
 * @created  2026-07-23
 */
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env-server'
import { logErr } from '@/lib/log'
import { getSupabaseServer } from '@/lib/supabase-server'
import { getCorpusByIdServer } from '@/lib/db/corpus-server'
import { hasRecordedConsent } from '@/lib/consent-server'
import { generateAnkiAnswer } from '@/lib/ai/anki-answer'
import { logApiUsage, qwenPlusCostCny } from '@/lib/api-logger'
import type { LLMUsage } from '@/lib/llm'
import {
  ANKI_DRAIN_BATCH,
  ANKI_DRAIN_CONCURRENCY,
  ANKI_DRAIN_BACKOFF_BASE_MS,
  ANKI_DRAIN_BACKOFF_MAX_MS,
} from '@/lib/constants'

/** 领取到的任务行（0031 anki_generation_jobs 形状里 drain 用得上的字段）。 */
interface ClaimedJob {
  id: string
  user_id: string
  question_id: string
  card_id: string | null
  corpus_id: string | null
  attempts: number
  max_attempts: number
}

/** 生成一条卡背失败的两类结局：可重试（退避）/ 死信（永不重试，语料缺失、part3 等结构性问题）。 */
type FailureKind = 'retryable' | 'terminal'

/** 固定时间比较请求头密钥与配置密钥；长度不等或任一为空一律 false（不泄漏长度、fail closed）。 */
function secretMatches(headerVal: string | null): boolean {
  const expected = env.ankiDrainSecret
  if (!expected || !headerVal) return false
  const a = Buffer.from(headerVal)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** 指数退避下次到点时间：now + min(BASE × 2^(attempts-1), MAX)。attempts 是领取后已 +1 的值。 */
function backoffAt(attempts: number): string {
  const delay = Math.min(
    ANKI_DRAIN_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
    ANKI_DRAIN_BACKOFF_MAX_MS,
  )
  return new Date(Date.now() + delay).toISOString()
}

/** 任务置完成。 */
async function markDone(jobId: string): Promise<void> {
  await getSupabaseServer()
    .from('anki_generation_jobs')
    .update({ status: 'done', last_error: null, updated_at: new Date().toISOString() })
    .eq('id', jobId)
}

/**
 * 任务失败落库：terminal 或已达上限 → failed（死信）；否则 pending + 指数退避 next_attempt_at。
 * @param job   领取到的任务
 * @param kind  可重试还是死信
 * @param err   失败原因（写 last_error 供诊断）
 */
async function markFailure(job: ClaimedJob, kind: FailureKind, err: string): Promise<void> {
  const dead = kind === 'terminal' || job.attempts >= job.max_attempts
  const patch = dead
    ? { status: 'failed', last_error: err, updated_at: new Date().toISOString() }
    : { status: 'pending', last_error: err, next_attempt_at: backoffAt(job.attempts), updated_at: new Date().toISOString() }
  await getSupabaseServer().from('anki_generation_jobs').update(patch).eq('id', job.id)
}

/** 卡背失败：既标注失败结局，又记一条 error 账（对齐 phrases 路由失败分支补 phase）。 */
async function failJob(job: ClaimedJob, kind: FailureKind, err: string, t0: number): Promise<void> {
  await markFailure(job, kind, err)
  await logApiUsage({
    service: 'qwen_plus',
    endpoint: 'dashscope/v1/chat/completions',
    usage_amount: 0,
    usage_unit: 'tokens',
    estimated_cost_cny: 0,
    latency_ms: Date.now() - t0,
    status: 'error',
    user_id: job.user_id,
    corpus_id: job.corpus_id ?? undefined,
    metadata: { phase: 'anki_answer', kind, error: err.slice(0, 200) },
  })
}

/** 处理单条任务：consent 复核 → 取题/分析/语料 → 定档 → 生成 → 回填 + 记账。异常在此收敛为失败落库，不外抛。 */
async function processJob(job: ClaimedJob): Promise<void> {
  const t0 = Date.now()
  const supabase = getSupabaseServer()
  try {
    // 外发前复核卡主同意（drain 才是把语料发往千问的真正出口）：未同意/已撤回 → 死信，绝不外发。
    if (!(await hasRecordedConsent(job.user_id))) {
      await failJob(job, 'terminal', 'CONSENT_MISSING', t0)
      return
    }

    // 取题面 + part（service_role 直读；questions 公开引用数据）。
    const { data: q, error: qErr } = await supabase
      .from('questions')
      .select('part, question_text')
      .eq('id', job.question_id)
      .maybeSingle()
    if (qErr) throw qErr
    const question = q as { part: number; question_text: string } | null
    if (!question) {
      await failJob(job, 'terminal', 'QUESTION_NOT_FOUND', t0)
      return
    }
    if (question.part !== 1 && question.part !== 2) {
      // part3 不生成卡背（0030 不变式）；不该被入队，若混入则死信不重试。
      await failJob(job, 'terminal', `UNSUPPORTED_PART_${question.part}`, t0)
      return
    }

    // 取静态分析（0032）；缺失可重试（可能分析尚未预生成，退避后再来）。
    const { data: a, error: aErr } = await supabase
      .from('question_analyses')
      .select('analysis')
      .eq('question_id', job.question_id)
      .maybeSingle()
    if (aErr) throw aErr
    const analysisRow = a as { analysis: { structureLabel?: string; focusPoints?: { title?: string; desc?: string }[] } } | null
    if (!analysisRow) {
      await failJob(job, 'retryable', 'ANALYSIS_NOT_READY', t0)
      return
    }

    // 取中文语料；无语料无法忠料生成 → 死信。
    const corpus = job.corpus_id ? await getCorpusByIdServer(job.corpus_id) : null
    if (!corpus) {
      await failJob(job, 'terminal', 'CORPUS_MISSING', t0)
      return
    }

    // 分点式逐点例句要按 focusPoints 生成；缺侧重点（分析未就绪/结构异常）→ 可重试。
    const focusPoints = (analysisRow.analysis.focusPoints ?? []).map((p) => ({
      title: p.title ?? '',
      desc: p.desc ?? '',
    }))
    if (focusPoints.length === 0) {
      await failJob(job, 'retryable', 'ANALYSIS_NOT_READY', t0)
      return
    }

    let realUsage: LLMUsage | null = null
    const points = await generateAnkiAnswer(
      { part: question.part, questionText: question.question_text, focusPoints, corpus },
      (u) => { realUsage = u },
    )
    // generated_answer（text 列不变）本轮存点数组的 JSON 字符串；读取渲染下一轮改。
    const answer = JSON.stringify(points)

    // 回填卡背：优先按 card_id（懒物化已回填），否则按 (user_id, question_id)。
    // belt-and-suspenders：按 card_id 回填也附带 .eq('user_id')——card_id 本就唯一，加这条只为防御纵深
    // （万一 job.card_id 被写脏也绝不会把答案写到别人的卡上），与按 (user_id, question_id) 分支同口径。
    const cardUpdate = supabase
      .from('anki_cards')
      .update({ generated_answer: answer, updated_at: new Date().toISOString() })
    const { error: cardErr } = job.card_id
      ? await cardUpdate.eq('id', job.card_id).eq('user_id', job.user_id)
      : await cardUpdate.eq('user_id', job.user_id).eq('question_id', job.question_id)
    if (cardErr) throw cardErr

    await markDone(job.id)

    // 记账：优先真实 usage，模型没吐则按输入规模粗估（绝不把 undefined 当 0，对齐 phrases）。
    // 输入规模按 题面 + 侧重点文本 + 语料 估；分点式输出短（每点 ≤22 词），completion 估值随点数。
    const focusChars = focusPoints.reduce((n, p) => n + p.title.length + p.desc.length, 0)
    const usage: LLMUsage = realUsage ?? {
      promptTokens: Math.round((question.question_text.length + focusChars + corpus.length) * 0.3 + 500),
      completionTokens: question.part === 1 ? 120 : 200,
    }
    await logApiUsage({
      service: 'qwen_plus',
      endpoint: 'dashscope/v1/chat/completions',
      usage_amount: usage.promptTokens + usage.completionTokens,
      usage_unit: 'tokens',
      estimated_cost_cny: qwenPlusCostCny(usage.promptTokens, usage.completionTokens),
      latency_ms: Date.now() - t0,
      status: 'success',
      user_id: job.user_id,
      corpus_id: job.corpus_id ?? undefined,
      metadata: {
        phase: 'anki_answer',
        part: question.part,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        cost_source: realUsage ? 'actual' : 'estimate',
      },
    })
  } catch (e) {
    // AI / 系统故障：可重试（退避）。失败事实落库 + 记 error 账，不外抛（单条失败不拖垮整批）。
    logErr('[anki drain job]', e)
    await failJob(job, 'retryable', e instanceof Error ? e.message : String(e), t0)
  }
}

/**
 * 按卡主 user_id 分桶，桶间限并发、桶内串行地跑完所有任务。
 * @param jobs         领取到的任务
 * @param concurrency  桶间最大并发数
 */
async function runBuckets(jobs: ClaimedJob[], concurrency: number): Promise<void> {
  const buckets = new Map<string, ClaimedJob[]>()
  for (const j of jobs) {
    const arr = buckets.get(j.user_id) ?? []
    arr.push(j)
    buckets.set(j.user_id, arr)
  }
  const queue = [...buckets.values()]
  let idx = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (idx < queue.length) {
        const bucket = queue[idx++]
        for (const job of bucket) await processJob(job) // 同一用户串行
      }
    }),
  )
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!secretMatches(req.headers.get('x-anki-drain-secret'))) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }
  try {
    const { data, error } = await getSupabaseServer().rpc('claim_anki_generation_jobs', {
      p_limit: ANKI_DRAIN_BATCH,
    })
    if (error) throw error
    const jobs = (data ?? []) as ClaimedJob[]
    if (jobs.length === 0) return NextResponse.json({ claimed: 0, processed: 0 })

    await runBuckets(jobs, ANKI_DRAIN_CONCURRENCY)

    // 死信可观测出口：本轮处理后顺带查一次当前 failed（死信）总数随响应返回。
    // 口径取「当前死信总量」而非「本轮新增死信数」——因为死信一旦落库便不再被后续 drain 领取，
    // 只报本轮新增会让既有堆积在事后不可见；报总量则 cron 每次调用的响应/日志都能看到堆积规模，
    // 无需再手查表（原本卡背静默不生成只能手查库）。单条 count(*) 索引扫描、开销可忽略。
    // 查询失败不阻断 drain 主流程：failedCount 取不到时记 null，只影响可观测、不影响已完成的处理。
    const { count: failedCount, error: failedErr } = await getSupabaseServer()
      .from('anki_generation_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed')
    if (failedErr) logErr('[anki drain] 查死信总数失败（不阻断）', failedErr)
    return NextResponse.json({ claimed: jobs.length, processed: jobs.length, failed: failedCount ?? null })
  } catch (e) {
    logErr('[anki drain]', e)
    return NextResponse.json({ error: 'drain 失败' }, { status: 500 })
  }
}
