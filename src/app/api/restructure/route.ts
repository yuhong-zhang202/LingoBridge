/**
 * @module   api/restructure
 * @desc     POST 接口：收原始文字 → 调千问整理 → 返回整理后短文（密钥只在服务端使用）
 * @author   LingoBridge
 * @created  2026-06-02
 */
import { NextResponse } from 'next/server'
import { restructureText } from '@/services/restructure'
import { logApiUsage, API_PRICING } from '@/lib/api-logger'
import { requireUser, authErrorResponse } from '@/lib/api-auth'

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    await requireUser(req)
    const body = (await req.json()) as { rawText?: unknown }
    const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : ''
    if (!rawText) {
      return NextResponse.json({ error: 'rawText 不能为空' }, { status: 400 })
    }
    const { cleanedText, usable } = await restructureText(rawText)
    // service 层未返回 usage，按输入字数 × 1.5 估算 token 数
    const usage_amount = Math.round(rawText.length * 1.5)
    logApiUsage({ service: 'qwen_flash', endpoint: 'dashscope/chat/completions', usage_amount, usage_unit: 'tokens', estimated_cost_cny: (usage_amount / 1000) * API_PRICING.qwen_flash_per_1k_tokens, latency_ms: Date.now() - t0, status: 'success' }).catch(() => {})
    return NextResponse.json({ cleanedText, usable })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logApiUsage({ service: 'qwen_flash', endpoint: 'dashscope/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' }).catch(() => {})
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
