/**
 * @module   api/restructure
 * @desc     POST 接口：收原始文字 → 调千问整理 → 返回整理后短文（密钥只在服务端使用）
 * @author   LingoBridge
 * @created  2026-06-02
 */
import { NextResponse } from 'next/server'
import { restructureText } from '@/services/restructure'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { rawText?: unknown }
    const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : ''
    if (!rawText) {
      return NextResponse.json({ error: 'rawText 不能为空' }, { status: 400 })
    }
    const cleanedText = await restructureText(rawText)
    return NextResponse.json({ cleanedText })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
