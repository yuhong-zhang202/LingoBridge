/**
 * @module   api/pronounce
 * @desc     POST 想说词/被听成词 → 千问给音标 + 怎么念提示（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-11
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { generatePronunciationTip } from '@/services/pronounce'
import { logApiUsage, qwenPlusCostCny } from '@/lib/api-logger'
import { isQaRequest } from '@/lib/qa-traffic'
import { errorLogMeta, errorKindMeta } from '@/types/errors'
import type { LLMUsage } from '@/lib/llm'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { ANON_PRONOUNCE_LIMIT, REG_PRONOUNCE_DAILY_LIMIT } from '@/lib/constants'

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  // 失败记账也要标 QA（失败一样烧钱），而 userId 声明在 try 内、catch 读不到，故在此暂存一份。
  // 只服务于 is_qa 判定：本路由失败行仍不带 user_id/is_anonymous（归属口径一字未动）。
  let qaUserId: string | undefined
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    qaUserId = userId
    // 同意闸硬前置：发音提示会把用户词/出处句发往千问。未捕获当前版本同意 → 403，绝不外发。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    const body = (await req.json()) as { intended?: unknown; heard?: unknown; context?: unknown }
    const intended = typeof body.intended === 'string' ? body.intended.trim() : ''
    const heard = typeof body.heard === 'string' ? body.heard.trim() : ''
    const context = typeof body.context === 'string' ? body.context : undefined
    if (!intended || !heard) {
      return NextResponse.json({ error: 'intended/heard 不能为空' }, { status: 400 })
    }
    // 输入上限（对所有用户生效，防刷 token）：想说词/被听成词各 100 字，出处句 500 字
    if (intended.length > 100 || heard.length > 100 || (context !== undefined && context.length > 500)) {
      return NextResponse.json({ error: '内容过长，请精简后再试' }, { status: 400 })
    }
    // 服务端硬防线：先计次再调 AI。匿名超上限 → 402(QUOTA_EXCEEDED)；注册超熔断上限 → 429（不带 code）。
    const dailyCount = await bumpDailyUsageServer(userId, 'pronounce')
    if (isAnonymous ? dailyCount > ANON_PRONOUNCE_LIMIT : dailyCount > REG_PRONOUNCE_DAILY_LIMIT) {
      return isAnonymous
        ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
        : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
    }
    // pronounce 不绑定具体语料，无 corpusId；带 userId 归属留证。
    // 此前该路由完全漏记账（qwen-plus 一次调用）。优先记真实 usage，模型没吐 usage 才回退到估算。
    // onUsage 在服务内部同步触发（callLLMJson 返回前回调），await 结束后 realUsage 已落值。
    let realUsage: LLMUsage | null = null
    const result = await runWithRawLogContext({ userId, corpusId: null }, () =>
      generatePronunciationTip(intended, heard, context, (u) => { realUsage = u }),
    )
    const usage: LLMUsage = realUsage ?? { promptTokens: Math.round((intended.length + heard.length + (context?.length ?? 0)) * 0.3 + 300), completionTokens: 150 }
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: usage.promptTokens + usage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(usage.promptTokens, usage.completionTokens), latency_ms: Date.now() - t0, status: 'success', user_id: userId, is_anonymous: isAnonymous, is_qa: isQaRequest(req, userId), metadata: { phase: 'pronounce', prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, cost_source: realUsage ? 'actual' : 'estimate' } })
    return NextResponse.json(result)
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    // 失败行补 phase（与成功分支同值 'pronounce'），避免空 metadata 掉进看板 other 桶、辨不出环节。
    // 再经 errorKindMeta 做四分类归因：命中 network（到千问 ECONNRESET/aborted）等则摘出、非系统故障；
    // 其余（缺键）按系统故障计入错误率。intended/heard 空/超长在前面已 400 早退、不进本分支。
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', is_qa: isQaRequest(req, qaUserId), metadata: { phase: 'pronounce', ...errorLogMeta(e), ...errorKindMeta(e) } })
    logErr('[pronounce API]', e)
    return NextResponse.json({ error: '生成发音提示失败' }, { status: 500 })
  }
}
