/**
 * @module   api/practice/polish
 * @desc     POST 一句英文 → 千问给优化版 + 改进说明（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { polishSentence } from '@/services/practice'
import { logApiUsage, qwenPlusCostCny } from '@/lib/api-logger'
import { errorLogMeta, errorKindMeta } from '@/types/errors'
import type { LLMUsage } from '@/lib/llm'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { ANON_POLISH_LIMIT, REG_POLISH_DAILY_LIMIT } from '@/lib/constants'

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    // 同意闸硬前置：润色会把用户句子发往千问。未捕获当前版本同意 → 403，绝不外发。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    const body = (await req.json()) as { sentence?: unknown; aiQuestion?: unknown; level?: unknown }
    const sentence = typeof body.sentence === 'string' ? body.sentence.trim() : ''
    const aiQuestion = typeof body.aiQuestion === 'string' ? body.aiQuestion : undefined
    const level = typeof body.level === 'string' ? body.level : '6.0'
    if (!sentence) {
      return NextResponse.json({ error: 'sentence 不能为空' }, { status: 400 })
    }
    // 输入上限（对所有用户生效）。把关的不是 token 成本——polish 平均 ¥0.0013/次，成本可忽略——
    // 而是【保住 POLISH_SYSTEM 的语义边界】：这条 prompt 是按「一句话」写的，超出那个量级它自己会失效。
    //
    // 实测（只算练习转写，n=147）：中位 200、p90 430、p95 611、最长 927 字符；
    // 覆盖率：500 → 92.5%，800 → 98.6%，1200 → 100%。
    // 取 800：约 130–150 词 / 45–60 秒 / 3–6 句，仍在「几句话」的量级，prompt 三条契约都还成立。
    // 不取 1200：那已是「一个完整 Part 2 主答」，届时 needsWork 这个布尔、note「每类合并一行」的契约、
    // 「optimized 长度与原句相当」会【同时】失效——那是产品定位问题，不该由一个阈值偷偷代答。
    //
    // ⚠️ 800 是止血值、不是终局。真正的矛盾在上游：教练 prompt 明确鼓励用户讲「a proper long turn」
    // （1–2 分钟不间断），而 POLISH_SYSTEM 第一句就是「会给你【一句】他刚说的英文」——两个环节的
    // 设计假设互相矛盾。长远要么在 UI 引导用户选句润色，要么做独立的「整段模式」（另一套 prompt 与契约）。
    // 放宽同时必须给 polishSentence 显式 timeoutMs/maxTokens（见 services/practice.ts），否则输入变长
    // → 输出变长 → 撞 llm.ts 的 30s 默认 → 解析拿不到一个字节 → 走 fallback，用户白等两轮。
    if (sentence.length > 800) {
      return NextResponse.json({ error: '句子过长，请精简后再试' }, { status: 400 })
    }
    // 服务端硬防线：先计次再调 AI。匿名超上限 → 402(QUOTA_EXCEEDED)；注册超熔断上限 → 429（不带 code）。
    const dailyCount = await bumpDailyUsageServer(userId, 'polish')
    if (isAnonymous ? dailyCount > ANON_POLISH_LIMIT : dailyCount > REG_POLISH_DAILY_LIMIT) {
      return isAnonymous
        ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
        : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
    }
    // polish 是练习中的单句润色，不绑定具体语料，无 corpusId；带 userId 归属留证。
    // 此前该路由完全漏记账（qwen-plus 一次调用）。优先记真实 usage，模型没吐 usage 才回退到估算。
    // onUsage 在服务内部同步触发（callLLMJson 返回前回调），await 结束后 realUsage 已落值。
    let realUsage: LLMUsage | null = null
    const result = await runWithRawLogContext({ userId, corpusId: null }, () =>
      polishSentence(sentence, aiQuestion, level, (u) => { realUsage = u }),
    )
    // 兜底估算按现网实测重标（2026-08-02 查 api_usage_logs，phase=polish 成功 47 条、cost_source 全为 actual，
    // 即这条兜底至今没真正生效过；重标只为「万一模型不吐 usage」时看板不失真）：
    // · 常量 1400 = POLISH_SYSTEM 的实测 prompt 基线（短句样本 prompt_tokens 1419–1558，扣掉用户消息约 1400）。
    //   原来的 400 是 note 契约段加进 prompt 之前的旧值，现已低估约 1000 token（近 3.5×），输入放宽后偏差还会涨。
    // · 0.3 token/字符：用户消息以英文为主，约 3–4 字符/token，保留不动。
    // · completionTokens 200：实测 p50=131、p90=194、max=292（输入均在旧 500 上限内），
    //   上限放到 800 后输出跟着涨，取 200 落在放宽后的中位偏上，不夸大也不系统性低估。
    const usage: LLMUsage = realUsage ?? {
      promptTokens: Math.round((sentence.length + (aiQuestion?.length ?? 0)) * 0.3 + 1400),
      completionTokens: 200,
    }
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: usage.promptTokens + usage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(usage.promptTokens, usage.completionTokens), latency_ms: Date.now() - t0, status: 'success', user_id: userId, is_anonymous: isAnonymous, metadata: { phase: 'polish', prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, cost_source: realUsage ? 'actual' : 'estimate' } })
    return NextResponse.json(result)
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    // 失败行补 phase（与成功分支同值 'polish'），避免空 metadata 掉进看板 other 桶、辨不出环节。
    // 再经 errorKindMeta 做四分类归因：命中 network（到千问 ECONNRESET/aborted）等则摘出、非系统故障；
    // 其余（缺键）按系统故障计入错误率。sentence 空/超长在前面已 400 早退、不进本分支。
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', metadata: { phase: 'polish', ...errorLogMeta(e), ...errorKindMeta(e) } })
    logErr('[polish API]', e)
    return NextResponse.json({ error: '优化失败' }, { status: 500 })
  }
}
