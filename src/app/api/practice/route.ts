/**
 * @module   api/practice
 * @desc     POST 练习对话 — 首轮构建脚手架并开场，后续基于脚手架续聊（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { buildScaffold, coachReply } from '@/services/practice'
import { logApiUsage, API_PRICING } from '@/lib/api-logger'
import type { PracticeScaffold, PracticeMessage } from '@/lib/types'

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const body = (await req.json()) as {
      questionId?: string
      messages?: PracticeMessage[]
      scaffold?: PracticeScaffold
    }
    const messages = Array.isArray(body.messages) ? body.messages : []

    // 首轮没有 scaffold：用 questionId 构建一次
    let scaffold = body.scaffold
    if (!scaffold) {
      if (!body.questionId) {
        return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
      }
      scaffold = await buildScaffold(body.questionId)
    }

    const reply = await coachReply(scaffold, messages)
    // coachReply 内未向上暴露 usage，按题目 + 对话历史长度估算（+ 系统提示约 600 token）
    const promptTokens = Math.round(scaffold.questionForAI.length * 0.3 + messages.length * 50 + 600)
    const completionTokens = 60
    logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: promptTokens + completionTokens, usage_unit: 'tokens', estimated_cost_cny: (promptTokens / 1_000_000) * API_PRICING.qwen_plus_input_per_1m + (completionTokens / 1_000_000) * API_PRICING.qwen_plus_output_per_1m, latency_ms: Date.now() - t0, status: 'success', metadata: { prompt_tokens: promptTokens, completion_tokens: completionTokens } }).catch(() => {})
    return NextResponse.json({ scaffold, reply })
  } catch (e) {
    logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' }).catch(() => {})
    console.error('[practice API] error', e)
    return NextResponse.json({ error: '对话失败' }, { status: 500 })
  }
}
