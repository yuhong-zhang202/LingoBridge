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
import { logApiUsage, API_PRICING } from '@/lib/api-logger'
import { requireUser, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'

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
    const phrases = await generatePhrases({ part: q.part, en: enForAI, zh: q.question_text_zh, story, level })
    const promptTokens = Math.round(enForAI.length * 0.3 + 500)
    const completionTokens = 300
    logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: promptTokens + completionTokens, usage_unit: 'tokens', estimated_cost_cny: (promptTokens / 1_000_000) * API_PRICING.qwen_plus_input_per_1m + (completionTokens / 1_000_000) * API_PRICING.qwen_plus_output_per_1m, latency_ms: Date.now() - t0, status: 'success', metadata: { level } }).catch(() => {})
    return NextResponse.json({ phrases })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' }).catch(() => {})
    logErr('[phrases API]', e)
    return NextResponse.json({ error: '生成词组失败' }, { status: 500 })
  }
}
