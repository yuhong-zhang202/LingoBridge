/**
 * @module   api/practice/polish
 * @desc     POST 一句英文 → 千问给优化版 + 改进说明（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { polishSentence } from '@/services/practice'
import { requireRegisteredUser, authErrorResponse } from '@/lib/api-auth'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireRegisteredUser(req)
    const body = (await req.json()) as { sentence?: unknown; aiQuestion?: unknown; level?: unknown }
    const sentence = typeof body.sentence === 'string' ? body.sentence.trim() : ''
    const aiQuestion = typeof body.aiQuestion === 'string' ? body.aiQuestion : undefined
    const level = typeof body.level === 'string' ? body.level : '6.0'
    if (!sentence) {
      return NextResponse.json({ error: 'sentence 不能为空' }, { status: 400 })
    }
    const result = await polishSentence(sentence, aiQuestion, level)
    return NextResponse.json(result)
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[polish API]', e)
    return NextResponse.json({ error: '优化失败' }, { status: 500 })
  }
}
