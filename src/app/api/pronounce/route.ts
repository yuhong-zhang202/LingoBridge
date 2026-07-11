/**
 * @module   api/pronounce
 * @desc     POST 想说词/被听成词 → 千问给音标 + 怎么念提示（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-11
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { generatePronunciationTip } from '@/services/pronounce'
import { requireUser, authErrorResponse } from '@/lib/api-auth'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireUser(req)
    const body = (await req.json()) as { intended?: unknown; heard?: unknown; context?: unknown }
    const intended = typeof body.intended === 'string' ? body.intended.trim() : ''
    const heard = typeof body.heard === 'string' ? body.heard.trim() : ''
    const context = typeof body.context === 'string' ? body.context : undefined
    if (!intended || !heard) {
      return NextResponse.json({ error: 'intended/heard 不能为空' }, { status: 400 })
    }
    const result = await generatePronunciationTip(intended, heard, context)
    return NextResponse.json(result)
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[pronounce API]', e)
    return NextResponse.json({ error: '生成发音提示失败' }, { status: 500 })
  }
}
