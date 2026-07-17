/**
 * @module   api/analysis/phrases
 * @desc     GET ?questionId&storyId&level → 只按目标雅思水平重出「可用词组」
 * @author   LingoBridge
 * @created  2026-06-07
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getQuestionById } from '@/lib/db/questions'
import { getCorpusByIdServer } from '@/lib/db/corpus-server'
import { generatePhrases } from '@/services/analysis'
import { logApiUsage, qwenPlusCostCny } from '@/lib/api-logger'
import type { LLMUsage } from '@/lib/llm'
import { requireUser, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { runWithRawLogContext } from '@/lib/raw-log-context'

export async function GET(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const { userId } = await requireUser(req)
    const { searchParams } = new URL(req.url)
    const questionId = searchParams.get('questionId') ?? ''
    const storyId    = searchParams.get('storyId') ?? ''
    const storyUrl   = searchParams.get('story') || undefined
    const level      = searchParams.get('level') || '6.0'
    if (!questionId) {
      return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    }
    // 越权防护：storyId 属他人语料则 403（storyId 缺省时走通用词组，无需校验）
    if (storyId) await assertCorpusOwner(userId, storyId)

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
