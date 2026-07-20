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
import { getCorpusByIdServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { generateAnalysis } from '@/services/analysis'
import { logApiUsage, qwenPlusCostCny } from '@/lib/api-logger'
import type { LLMUsage } from '@/lib/llm'
import { requireUserAllowAnon, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { DIMENSION_LABEL, ANON_ANALYSIS_LIMIT, REG_ANALYSIS_DAILY_LIMIT } from '@/lib/constants'
import type { AnalysisResponse, DimensionLabel } from '@/lib/types'

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
}

/** 取 body 里的字符串字段；非字符串/缺省一律回退空串（与旧版 searchParams.get() ?? '' 同语义）。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export async function POST(req: Request): Promise<NextResponse> {
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

    // Part 2：完整 cue card 喂 AI，展示用短标题
    const enForAI = q.question_text
    const enForDisplay = q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text
    const zhForDisplay = q.part === 2 ? (q.cue_card_title_zh ?? '') : (q.question_text_zh ?? '')

    // corpusId 取 storyId（有则带、无则 null）：留证可回溯到具体语料。
    // 优先记模型真实 usage；模型没吐 usage 才回退到按题目长度的估算（英文约 0.3 token/字 + 系统提示约 800）。
    // onUsage 在服务内部同步触发（callLLMJson 返回前回调），await 结束后 realUsage 已落值。
    let realUsage: LLMUsage | null = null
    const analysis = await runWithRawLogContext({ userId, corpusId: storyId || null }, () =>
      generateAnalysis({ part: q.part, en: enForAI, zh: q.question_text_zh, story }, (u) => { realUsage = u }),
    )
    const usage: LLMUsage = realUsage ?? { promptTokens: Math.round(enForAI.length * 0.3 + 800), completionTokens: 400 }
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: usage.promptTokens + usage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(usage.promptTokens, usage.completionTokens), latency_ms: Date.now() - t0, status: 'success', user_id: userId, corpus_id: storyId || undefined, metadata: { phase: 'analysis', prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, cost_source: realUsage ? 'actual' : 'estimate' } })

    const body: AnalysisResponse = {
      question: {
        id: q.id,
        part: q.part,
        en: enForDisplay,
        zh: zhForDisplay,
        dimension: dimFromCode(q.observation_points[0]),
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
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', metadata: { phase: 'analysis' } })
    logErr('[analysis API]', e)
    return NextResponse.json({ error: '生成分析失败' }, { status: 500 })
  }
}
