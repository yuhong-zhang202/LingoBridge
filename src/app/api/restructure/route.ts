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
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { bumpAnonRestructureTodayServer } from '@/lib/db/corpus-server'
import { ANON_RESTRUCTURE_LIMIT } from '@/lib/constants'

// 输入上限：整理是按字数估算 token 计费的付费调用，限长防止单请求刷高 token 成本
const MAX_RAW_TEXT_LENGTH = 3000

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    const body = (await req.json()) as { rawText?: unknown }
    const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : ''
    if (!rawText) {
      return NextResponse.json({ error: 'rawText 不能为空' }, { status: 400 })
    }
    if (rawText.length > MAX_RAW_TEXT_LENGTH) {
      return NextResponse.json({ error: '内容过长，请分段提交（上限 3000 字）' }, { status: 400 })
    }
    // 匿名试用整理次数：原子递增当日计数，超上限即 402（原子递增放 AI 调用前，攻击者刷失败也计数、防绕过）。
    // 注册用户跳过此计数，走各自既有额度。
    if (isAnonymous) {
      const n = await bumpAnonRestructureTodayServer(userId)
      if (n > ANON_RESTRUCTURE_LIMIT) {
        return NextResponse.json({ error: '试用整理次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
      }
    }
    // restructure 处于建语料之前，无 corpusId；带 userId 归属留证。
    const { cleanedText, usable } = await runWithRawLogContext({ userId, corpusId: null }, () =>
      restructureText(rawText),
    )
    // service 层未返回 usage，按输入字数 × 1.5 估算 token 数
    const usage_amount = Math.round(rawText.length * 1.5)
    logApiUsage({ service: 'qwen_flash', endpoint: 'dashscope/chat/completions', usage_amount, usage_unit: 'tokens', estimated_cost_cny: (usage_amount / 1000) * API_PRICING.qwen_flash_per_1k_tokens, latency_ms: Date.now() - t0, status: 'success' }).catch(() => {})
    return NextResponse.json({ cleanedText, usable })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logApiUsage({ service: 'qwen_flash', endpoint: 'dashscope/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' }).catch(() => {})
    logErr('[restructure API]', e)
    return NextResponse.json({ error: '整理失败，请稍后再试' }, { status: 500 })
  }
}
