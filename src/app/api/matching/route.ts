/**
 * @module   api/matching
 * @desc     POST 接口：收整理后故事 → 萃取观察点 → 返回真实匹配题目（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { matchByStory } from '@/services/matching'
import { logApiUsage, API_PRICING } from '@/lib/api-logger'

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const body = (await req.json()) as { cleanedText?: unknown }
    const cleanedText = typeof body.cleanedText === 'string' ? body.cleanedText.trim() : ''
    if (!cleanedText) {
      return NextResponse.json({ error: 'cleanedText 不能为空' }, { status: 400 })
    }
    const result = await matchByStory(cleanedText)
    // extractCorpus 内未向上暴露 usage，按语料字数估算输入 token（中文约 0.8 token/字 + 系统提示约 1200）
    const promptTokens = Math.round(cleanedText.length * 0.8 + 1200)
    const completionTokens = 100
    logApiUsage({ service: 'claude_sonnet', endpoint: 'anthropic/v1/messages', usage_amount: promptTokens + completionTokens, usage_unit: 'tokens', estimated_cost_cny: (promptTokens / 1_000_000) * API_PRICING.claude_sonnet_input_per_1m + (completionTokens / 1_000_000) * API_PRICING.claude_sonnet_output_per_1m, latency_ms: Date.now() - t0, status: 'success', metadata: { prompt_tokens: promptTokens, completion_tokens: completionTokens } }).catch(() => {})
    return NextResponse.json(result)
  } catch (e) {
    logApiUsage({ service: 'claude_sonnet', endpoint: 'anthropic/v1/messages', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' }).catch(() => {})
    console.error('[matching API] error', e)
    return NextResponse.json({ error: '匹配失败' }, { status: 500 })
  }
}
