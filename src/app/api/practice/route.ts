/**
 * @module   api/practice
 * @desc     POST 练习对话 — 首轮构建脚手架并开场，后续基于脚手架续聊（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { buildScaffold, coachReply } from '@/services/practice'
import { logApiUsage, qwenPlusCostCny } from '@/lib/api-logger'
import { isQaRequest } from '@/lib/qa-traffic'
import { errorLogMeta, errorKindMeta } from '@/types/errors'
import type { LLMUsage } from '@/lib/llm'
import { requireUserAllowAnon, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { countReviewPracticeThisMonthServer } from '@/lib/db/practice-sessions-server'
import { bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { isInternalAccount } from '@/lib/internal-accounts'
import { IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'
import { ANON_PRACTICE_TURN_LIMIT, REG_PRACTICE_DAILY_LIMIT } from '@/lib/constants'
import { requireGlobalBudget } from '@/lib/global-budget-breaker'
import type { PracticeScaffold, PracticeMessage } from '@/lib/types'

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  // 失败记账也要标 QA（失败一样烧钱），而 userId 声明在 try 内、catch 读不到，故在此暂存一份。
  // 只服务于 is_qa 判定：本路由失败行仍不带 user_id/is_anonymous（归属口径一字未动）。
  let qaUserId: string | undefined
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    qaUserId = userId
    // 同意闸硬前置：练习会把用户故事/对话发往千问（脚手架 + 教练）。未捕获当前版本同意 → 403，绝不外发。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    const body = (await req.json()) as {
      questionId?: string
      storyId?: string
      messages?: PracticeMessage[]
      scaffold?: PracticeScaffold
      level?: string
      isReview?: boolean
    }
    const rawMessages = Array.isArray(body.messages) ? body.messages : []
    // 输入上限（对所有用户生效，防单请求刷 token）：条数上限（8 轮对话约 17–20 条，24 为安全余量）+ 单条内容截断
    if (rawMessages.length > 24) {
      return NextResponse.json({ error: '对话过长，请重新开始练习' }, { status: 400 })
    }
    const messages: PracticeMessage[] = rawMessages.map((m) =>
      typeof m.content === 'string' && m.content.length > 2000 ? { ...m, content: m.content.slice(0, 2000) } : m,
    )

    // 全局预算熔断：今日（东八区）全站 AI 花费触线 → 匿名一律拒新调用，注册用户不受影响。
    // 紧贴下面的额度闸、在计次之前：被熔断拦下的请求没调 AI，不该白扣一轮对话额度。
    const budgetDenied = await requireGlobalBudget(isAnonymous)
    if (budgetDenied) return budgetDenied

    // 服务端硬防线：每次调用先计次（放在 scaffold 分支之前，伪造 scaffold 也无法绕过），且在任何 AI 调用之前。
    // 匿名超每日轮次上限 → 402(QUOTA_EXCEEDED)；注册超熔断上限 → 429（不带 code，不触发配额弹层）。
    // 匿名 402 带 reason:'trial'：匿名没有月额度、撞的是试用轮次，前端据此走 trial 变体（引导注册），
    // 不再靠异步 isAnon 竞态推导（否则匿名会误显示「本月额度已用完」的月额度变体）。
    const dailyCount = await bumpDailyUsageServer(userId, 'practice')
    if (isAnonymous ? dailyCount > ANON_PRACTICE_TURN_LIMIT : dailyCount > REG_PRACTICE_DAILY_LIMIT) {
      return isAnonymous
        ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED', reason: 'trial' }, { status: 402 })
        : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
    }

    // 留证归属：corpusId 取 storyId（有则带、无则 null）。buildScaffold / coachReply 均在此上下文内跑，
    // 令其深处的 appendRawLog 填对 user_id / corpus_id（service 层签名不动）。
    const rawLogCtx = { userId, corpusId: body.storyId ?? null }

    // 首轮没有 scaffold：用 questionId 构建一次
    let scaffold = body.scaffold
    if (!scaffold) {
      if (!body.questionId) {
        return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
      }
      // 提前捕获为局部 const：闭包内 TS 不保留 body.questionId 的收窄，取局部值避免非空断言。
      const questionId = body.questionId
      // 复练月额度服务端强制：仅在开始一次新复练（review + 首轮）时校验，避免拦断进行中的对话。
      // 超额返回 402 + code=QUOTA_EXCEEDED + reason:'ielts'，客户端据此确定性弹 QuotaReached（ielts 月额度变体）。
      // 匿名用户走的是 corpus 单条试用额度，不叠加复练月额度，故 !isAnonymous 才校验（匿名到不了此分支）。
      if (!isAnonymous && body.isReview) {
        const used = await countReviewPracticeThisMonthServer(userId)
        // 内部账户豁免复练月额度（仅对 INTERNAL_ACCOUNT_IDS 生效，普通用户口径不变）。
        if (!isInternalAccount(userId) && used >= IELTS_MONTHLY_LIMIT) {
          return NextResponse.json({ error: '本月复练额度已用完', code: 'QUOTA_EXCEEDED', reason: 'ielts' }, { status: 402 })
        }
      }
      // 越权防护：storyId 属他人语料则 403（storyId 缺省时不带故事，无需校验）
      if (body.storyId) await assertCorpusOwner(userId, body.storyId)
      // 首轮构建脚手架内部会额外发一次 generateAnalysis 调用——此前这条调用完全漏记账，这里单独记一条。
      const scaffoldT0 = Date.now()
      // onUsage 在服务内部同步触发（callLLMJson 返回前回调），await 结束后 analysisUsage 已落值。
      let analysisUsage: LLMUsage | null = null
      scaffold = await runWithRawLogContext(rawLogCtx, () =>
        buildScaffold(questionId, body.storyId, body.level, (u) => { analysisUsage = u }),
      )
      const aUsage: LLMUsage = analysisUsage ?? { promptTokens: Math.round(scaffold.questionForAI.length * 0.3 + 800), completionTokens: 400 }
      await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: aUsage.promptTokens + aUsage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(aUsage.promptTokens, aUsage.completionTokens), latency_ms: Date.now() - scaffoldT0, status: 'success', user_id: userId, corpus_id: body.storyId || undefined, is_anonymous: isAnonymous, is_qa: isQaRequest(req, userId), metadata: { phase: 'analysis', prompt_tokens: aUsage.promptTokens, completion_tokens: aUsage.completionTokens, cost_source: analysisUsage ? 'actual' : 'estimate' } })
    }

    // 教练回复：优先记模型真实 usage，模型没吐 usage 才按题目 + 对话历史长度估算（+ 系统提示约 600 token）。
    const replyT0 = Date.now()
    let coachUsage: LLMUsage | null = null
    const reply = await runWithRawLogContext(rawLogCtx, () => coachReply(scaffold, messages, (u) => { coachUsage = u }))
    const cUsage: LLMUsage = coachUsage ?? { promptTokens: Math.round(scaffold.questionForAI.length * 0.3 + messages.length * 50 + 600), completionTokens: 60 }
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: cUsage.promptTokens + cUsage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(cUsage.promptTokens, cUsage.completionTokens), latency_ms: Date.now() - replyT0, status: 'success', user_id: userId, corpus_id: body.storyId || undefined, is_anonymous: isAnonymous, is_qa: isQaRequest(req, userId), metadata: { phase: 'coach', prompt_tokens: cUsage.promptTokens, completion_tokens: cUsage.completionTokens, cost_source: coachUsage ? 'actual' : 'estimate' } })
    return NextResponse.json({ scaffold, reply })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    // 失败行补 phase：本 catch 包住 analysis（仅首轮建脚手架）+ coach（每轮）两步，从 catch 处无法判定
    // 挂在哪步，故用端点定义相 'coach'（每次请求必经、看板即「教练对话」）作兜底，好过空 metadata 掉进 other 桶。
    // 再经 errorKindMeta 做四分类归因：命中 network（到千问 ECONNRESET/aborted、含教练 30s abort）等则摘出、
    // 非系统故障；其余（缺键）按系统故障计入错误率。缺 questionId、额度超限在前面已 400/402 早退、不进本分支。
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', is_qa: isQaRequest(req, qaUserId), metadata: { phase: 'coach', ...errorLogMeta(e), ...errorKindMeta(e) } })
    logErr('[practice API]', e)
    return NextResponse.json({ error: '对话失败' }, { status: 500 })
  }
}
