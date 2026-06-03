/**
 * @module   api/matching
 * @desc     POST 接口：收整理后故事 → 萃取观察点 → 返回真实匹配题目（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { matchByStory } from '@/services/matching'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { cleanedText?: unknown }
    const cleanedText = typeof body.cleanedText === 'string' ? body.cleanedText.trim() : ''
    if (!cleanedText) {
      return NextResponse.json({ error: 'cleanedText 不能为空' }, { status: 400 })
    }
    const result = await matchByStory(cleanedText)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[matching API] error', e)
    return NextResponse.json({ error: '匹配失败' }, { status: 500 })
  }
}
