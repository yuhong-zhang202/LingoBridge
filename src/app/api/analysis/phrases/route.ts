/**
 * @module   api/analysis/phrases
 * @desc     POST { questionId, storyId?, story?, level? } → 只按目标雅思水平重出「可用词组」
 *
 *           为什么是 POST 而不是 GET：本接口有副作用——扣每日额度 + 真实调用付费 AI。
 *           GET 在 HTTP 语义上被视为安全/可缓存，浏览器预取、爬虫、链接预览、代理预热都会
 *           自行发起 GET，那些无意的请求会直接烧掉 AI 调用费。与 /api/analysis 同口径。
 * @author   LingoBridge
 * @created  2026-06-07
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getQuestionById } from '@/lib/db/questions'
import { getCorpusByIdServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { generatePhrases } from '@/services/analysis'
import { logApiUsage, qwenPlusCostCny } from '@/lib/api-logger'
import type { LLMUsage } from '@/lib/llm'
import { requireUserAllowAnon, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { ANON_PHRASES_LIMIT, REG_PHRASES_DAILY_LIMIT } from '@/lib/constants'

/** 请求体形状：字段来源同旧版 query string，仅传输位置从 URL 改为 body。 */
interface PhrasesRequestBody {
  questionId?: unknown
  storyId?: unknown
  /** 故事正文兜底：DB 读不到 storyId 对应语料时用它（历史上由 URL 携带，现随 body 走） */
  story?: unknown
  level?: unknown
}

/** 取 body 里的字符串字段；非字符串/缺省一律回退空串（与旧版 searchParams.get() ?? '' 同语义）。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    // 同意闸硬前置：换词组会把用户故事全文发往千问。未捕获当前版本同意 → 403，绝不外发。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    // body 解析容错：非法/空 JSON 视作空对象，交由下面的 questionId 校验统一回 400
    // （而不是让 req.json() 抛进 catch、白记一条 error 账）。
    const body = await req.json().catch(() => ({})) as PhrasesRequestBody
    const questionId = str(body.questionId)
    const storyId    = str(body.storyId)
    const storyUrl   = str(body.story) || undefined
    const level      = str(body.level) || '6.0'
    if (!questionId) {
      return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    }
    // 越权防护：storyId 属他人语料则 403（storyId 缺省时走通用词组，无需校验）
    if (storyId) await assertCorpusOwner(userId, storyId)

    // 服务端硬防线：计次在任何 AI 调用之前——超额时不产生任何 AI 费用。
    // 与 /api/analysis 同理（可反复调），位置同样选在入参校验后、读故事/取题之前。
    // 匿名超上限 → 402(QUOTA_EXCEEDED)；注册超熔断上限 → 429（不带 code，不触发配额弹层）。与 practice 同范式。
    const dailyCount = await bumpDailyUsageServer(userId, 'phrases')
    if (isAnonymous ? dailyCount > ANON_PHRASES_LIMIT : dailyCount > REG_PHRASES_DAILY_LIMIT) {
      return isAnonymous
        ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
        : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
    }

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
    const enForAI = q.question_text
    // corpusId 取 storyId（有则带、无则 null）：留证可回溯到具体语料。
    // 优先记模型真实 usage；模型没吐 usage 才回退到按题目长度的估算。
    // onUsage 在服务内部同步触发（callLLMJson 返回前回调），await 结束后 realUsage 已落值。
    let realUsage: LLMUsage | null = null
    const phrases = await runWithRawLogContext({ userId, corpusId: storyId || null }, () =>
      generatePhrases({ part: q.part, en: enForAI, zh: q.question_text_zh, story, level }, (u) => { realUsage = u }),
    )
    const usage: LLMUsage = realUsage ?? { promptTokens: Math.round(enForAI.length * 0.3 + 500), completionTokens: 300 }
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: usage.promptTokens + usage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(usage.promptTokens, usage.completionTokens), latency_ms: Date.now() - t0, status: 'success', user_id: userId, corpus_id: storyId || undefined, metadata: { phase: 'phrases', level, prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, cost_source: realUsage ? 'actual' : 'estimate' } })
    return NextResponse.json({ phrases })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' })
    logErr('[phrases API]', e)
    return NextResponse.json({ error: '生成词组失败' }, { status: 500 })
  }
}
