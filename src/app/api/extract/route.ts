/**
 * @module   api/extract
 * @desc     POST 接口：收整理后文字 → 调 Claude 萃取 → 返回主/副观察点（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-02
 */
import { NextResponse } from 'next/server'
import { extractCorpus } from '@/services/extraction'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { cleanedText?: unknown }
    const cleanedText = typeof body.cleanedText === 'string' ? body.cleanedText.trim() : ''
    if (!cleanedText) {
      return NextResponse.json({ error: 'cleanedText 不能为空' }, { status: 400 })
    }
    const result = await extractCorpus(cleanedText)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
