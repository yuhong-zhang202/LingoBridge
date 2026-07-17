/**
 * @module   api/analysis
 * @desc     GET ?questionId → 取题 + Claude 生成侧重点分析（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getQuestionById } from '@/lib/db/questions'
import { getCorpusByIdServer } from '@/lib/db/corpus-server'
import { generateAnalysis } from '@/services/analysis'
import { logApiUsage, API_PRICING } from '@/lib/api-logger'
import { requireUser, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { DIMENSION_LABEL } from '@/lib/constants'
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

export async function GET(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const { userId } = await requireUser(req)
    const { searchParams } = new URL(req.url)
    const questionId = searchParams.get('questionId') ?? ''
    const storyId    = searchParams.get('storyId') ?? ''
    const storyUrl   = searchParams.get('story') || undefined   // URL 兜底
    if (!questionId) {
      return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    }
    // 越权防护：storyId 属他人语料则 403（storyId 缺省时走通用分析，无需校验）
    if (storyId) await assertCorpusOwner(userId, storyId)

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
    const analysis = await runWithRawLogContext({ userId, corpusId: storyId || null }, () =>
      generateAnalysis({ part: q.part, en: enForAI, zh: q.question_text_zh, story }),
    )
    // generateAnalysis 内未向上暴露 usage，按题目长度估算（英文约 0.3 token/字 + 系统提示约 800）
    const promptTokens = Math.round(enForAI.length * 0.3 + 800)
    const completionTokens = 400
    logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: promptTokens + completionTokens, usage_unit: 'tokens', estimated_cost_cny: (promptTokens / 1_000_000) * API_PRICING.qwen_plus_input_per_1m + (completionTokens / 1_000_000) * API_PRICING.qwen_plus_output_per_1m, latency_ms: Date.now() - t0, status: 'success', metadata: { prompt_tokens: promptTokens, completion_tokens: completionTokens } }).catch(() => {})

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
    logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' }).catch(() => {})
    logErr('[analysis API]', e)
    return NextResponse.json({ error: '生成分析失败' }, { status: 500 })
  }
}
