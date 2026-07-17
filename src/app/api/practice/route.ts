/**
 * @module   api/practice
 * @desc     POST 练习对话 — 首轮构建脚手架并开场，后续基于脚手架续聊（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { buildScaffold, coachReply } from '@/services/practice'
import { logApiUsage, API_PRICING } from '@/lib/api-logger'
import { requireUserAllowAnon, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { countReviewPracticeThisMonthServer } from '@/lib/db/practice-sessions-server'
import { bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'
import { ANON_PRACTICE_TURN_LIMIT, REG_PRACTICE_DAILY_LIMIT } from '@/lib/constants'
import type { PracticeScaffold, PracticeMessage } from '@/lib/types'

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
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

    // 服务端硬防线：每次调用先计次（放在 scaffold 分支之前，伪造 scaffold 也无法绕过），且在任何 AI 调用之前。
    // 匿名超每日轮次上限 → 402(QUOTA_EXCEEDED)；注册超熔断上限 → 429（不带 code，不触发配额弹层）。
    const dailyCount = await bumpDailyUsageServer(userId, 'practice')
    if (isAnonymous ? dailyCount > ANON_PRACTICE_TURN_LIMIT : dailyCount > REG_PRACTICE_DAILY_LIMIT) {
      return isAnonymous
        ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
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
      // 超额返回 402 + code=QUOTA_EXCEEDED，客户端据此弹 QuotaReached（ielts）。
      // 匿名用户走的是 corpus 单条试用额度，不叠加复练月额度，故 !isAnonymous 才校验。
      if (!isAnonymous && body.isReview) {
        const used = await countReviewPracticeThisMonthServer(userId)
        if (used >= IELTS_MONTHLY_LIMIT) {
          return NextResponse.json({ error: '本月复练额度已用完', code: 'QUOTA_EXCEEDED' }, { status: 402 })
        }
      }
      // 越权防护：storyId 属他人语料则 403（storyId 缺省时不带故事，无需校验）
      if (body.storyId) await assertCorpusOwner(userId, body.storyId)
      scaffold = await runWithRawLogContext(rawLogCtx, () =>
        buildScaffold(questionId, body.storyId, body.level),
      )
    }

    const reply = await runWithRawLogContext(rawLogCtx, () => coachReply(scaffold, messages))
    // coachReply 内未向上暴露 usage，按题目 + 对话历史长度估算（+ 系统提示约 600 token）
    const promptTokens = Math.round(scaffold.questionForAI.length * 0.3 + messages.length * 50 + 600)
    const completionTokens = 60
    logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: promptTokens + completionTokens, usage_unit: 'tokens', estimated_cost_cny: (promptTokens / 1_000_000) * API_PRICING.qwen_plus_input_per_1m + (completionTokens / 1_000_000) * API_PRICING.qwen_plus_output_per_1m, latency_ms: Date.now() - t0, status: 'success', metadata: { prompt_tokens: promptTokens, completion_tokens: completionTokens } }).catch(() => {})
    return NextResponse.json({ scaffold, reply })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' }).catch(() => {})
    logErr('[practice API]', e)
    return NextResponse.json({ error: '对话失败' }, { status: 500 })
  }
}
