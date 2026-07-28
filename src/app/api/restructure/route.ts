/**
 * @module   api/restructure
 * @desc     POST 接口：收原始文字 → 调千问整理 → 返回整理后短文（密钥只在服务端使用）
 * @author   LingoBridge
 * @created  2026-06-02
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { restructureText } from '@/services/restructure'
import { logApiUsage, API_PRICING } from '@/lib/api-logger'
import { errorLogMeta, errorKindMeta } from '@/types/errors'
import type { LLMUsage } from '@/lib/llm'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { hasRecordedConsent } from '@/lib/consent-server'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { bumpAnonRestructureTodayServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { ANON_RESTRUCTURE_LIMIT, REG_RESTRUCTURE_DAILY_LIMIT, MIN_CORPUS_CHARS } from '@/lib/constants'
import { isTooShortForCorpus } from '@/lib/utils'

// 输入上限：整理是按字数估算 token 计费的付费调用，限长防止单请求刷高 token 成本
const MAX_RAW_TEXT_LENGTH = 3000

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    // 服务端同意闸：文字流首个第三方 AI 入口（阿里云千问）。未捕获同意 → 拒绝，绝不把文字外发。
    // 客户端同意弹窗只挂首页、深链可绕过，故这里必须再硬校验一次（放在计次/AI 调用之前）。
    if (!(await hasRecordedConsent(userId))) {
      return NextResponse.json({ error: '请先在首页阅读并同意隐私说明', code: 'CONSENT_REQUIRED' }, { status: 403 })
    }
    const body = (await req.json()) as { rawText?: unknown }
    const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : ''
    if (!rawText) {
      return NextResponse.json({ error: 'rawText 不能为空' }, { status: 400 })
    }
    // 源头门槛兜底：深链绕过客户端预检时，在 AI 整理 / usable 判定之前挡下薄素材，省整理钱。
    // 与 usable 无关（那是 LLM 质量判断、故意放行薄素材）；这是独立字数闸。
    if (isTooShortForCorpus(rawText)) {
      return NextResponse.json({ error: `内容太少，请至少写满 ${MIN_CORPUS_CHARS} 字`, code: 'CORPUS_TOO_SHORT' }, { status: 400 })
    }
    if (rawText.length > MAX_RAW_TEXT_LENGTH) {
      return NextResponse.json({ error: '内容过长，请分段提交（上限 3000 字）' }, { status: 400 })
    }
    // 匿名试用整理次数：原子递增当日计数，超上限即 402（原子递增放 AI 调用前，攻击者刷失败也计数、防绕过）。
    if (isAnonymous) {
      const n = await bumpAnonRestructureTodayServer(userId)
      if (n > ANON_RESTRUCTURE_LIMIT) {
        return NextResponse.json({ error: '试用整理次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
      }
    } else {
      // 注册用户熔断：同样先计次后调 AI——超额时 AI 零调用、logApiUsage 零记账。
      // 与三个 AI 接口同范式，只是匿名侧走的是 restructure 专用的 bumpAnonRestructureTodayServer（不落 daily_usage），故这里分支写。
      // 超熔断上限 → 429（不带 code，不触发配额弹层）。
      const dailyCount = await bumpDailyUsageServer(userId, 'restructure')
      if (dailyCount > REG_RESTRUCTURE_DAILY_LIMIT) {
        return NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
      }
    }
    // restructure 处于建语料之前，无 corpusId；带 userId 归属留证。
    // 优先记模型真实 usage（qwen-flash 单价扁平按总 token 计），模型没吐 usage 才回退到按输入字数 × 1.5 估算。
    // onUsage 在服务内部同步触发（callLLMJson 返回前回调），await 结束后 realUsage 已落值。
    let realUsage: LLMUsage | null = null
    const { cleanedText, usable, summary } = await runWithRawLogContext({ userId, corpusId: null }, () =>
      restructureText(rawText, (u) => { realUsage = u }),
    )
    // qwen-flash 单价扁平按总 token 计，故估算兜底把全部字数塞进 promptTokens、completionTokens 记 0，合计即估算 token。
    const usage: LLMUsage = realUsage ?? { promptTokens: Math.round(rawText.length * 1.5), completionTokens: 0 }
    const usage_amount = usage.promptTokens + usage.completionTokens
    await logApiUsage({ service: 'qwen_flash', endpoint: 'dashscope/chat/completions', usage_amount, usage_unit: 'tokens', estimated_cost_cny: (usage_amount / 1000) * API_PRICING.qwen_flash_per_1k_tokens, latency_ms: Date.now() - t0, status: 'success', user_id: userId, is_anonymous: isAnonymous, metadata: { phase: 'restructure', cost_source: realUsage ? 'actual' : 'estimate' } })
    return NextResponse.json({ cleanedText, usable, summary })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    // 失败行补 phase（与成功分支同值），否则空 metadata 会掉进看板「other」桶、辨不出是哪个环节挂的。
    // 此处 catch 只接 AI/系统故障（rawText 空/超长在前面已 400 早退），故不补 error_kind（缺键即系统故障）。
    await logApiUsage({ service: 'qwen_flash', endpoint: 'dashscope/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', metadata: { phase: 'restructure', ...errorLogMeta(e), ...errorKindMeta(e) } })
    logErr('[restructure API]', e)
    return NextResponse.json({ error: '整理失败，请稍后再试' }, { status: 500 })
  }
}
