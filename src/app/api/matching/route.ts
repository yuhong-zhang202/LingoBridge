/**
 * @module   api/matching
 * @desc     POST 接口：按 corpusId 服务端读取整理后故事 → 萃取观察点 → 返回真实匹配题目（故事正文不进 URL）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { matchByStory } from '@/services/matching'
import { logApiUsage, API_PRICING } from '@/lib/api-logger'
import { getCorpusByIdServer } from '@/lib/db/corpus-server'

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const body = (await req.json()) as { corpusId?: unknown }
    const corpusId = typeof body.corpusId === 'string' ? body.corpusId.trim() : ''
    if (!corpusId) {
      return NextResponse.json({ error: 'corpusId 不能为空' }, { status: 400 })
    }
    const cleanedText = (await getCorpusByIdServer(corpusId))?.trim() ?? ''
    if (!cleanedText) {
      return NextResponse.json({ error: '语料无正文或不存在' }, { status: 400 })
    }
    const result = await matchByStory(cleanedText)
    // extractCorpus 内未向上暴露 usage，按语料字数估算输入 token（中文约 0.8 token/字 + 系统提示约 1200）
    const promptTokens = Math.round(cleanedText.length * 0.8 + 1200)
    const completionTokens = 100
    logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: promptTokens + completionTokens, usage_unit: 'tokens', estimated_cost_cny: (promptTokens / 1_000_000) * API_PRICING.qwen_plus_input_per_1m + (completionTokens / 1_000_000) * API_PRICING.qwen_plus_output_per_1m, latency_ms: Date.now() - t0, status: 'success', metadata: { prompt_tokens: promptTokens, completion_tokens: completionTokens } }).catch(() => {})
    return NextResponse.json(result)
  } catch (e) {
    logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' }).catch(() => {})
    logErr('[matching API]', e)
    return NextResponse.json({ error: '匹配失败' }, { status: 500 })
  }
}
