/**
 * @module   api/extract
 * @desc     POST 接口：收整理后文字 → 调 Claude 萃取 → 返回主/副观察点（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-02
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { extractCorpus } from '@/services/extraction'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { runWithRawLogContext } from '@/lib/raw-log-context'

// 输入上限：萃取是按文本长度计 token 的付费调用，限长防止单请求刷高 token 成本
const MAX_RAW_TEXT_LENGTH = 3000

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // 接住 userId：留证入库要按用户归属（此前这里丢弃了它）。extract 处于建语料之前，无 corpusId。
    const { userId } = await requireUserAllowAnon(req)
    const body = (await req.json()) as { cleanedText?: unknown }
    const cleanedText = typeof body.cleanedText === 'string' ? body.cleanedText.trim() : ''
    if (!cleanedText) {
      return NextResponse.json({ error: 'cleanedText 不能为空' }, { status: 400 })
    }
    if (cleanedText.length > MAX_RAW_TEXT_LENGTH) {
      return NextResponse.json({ error: '内容过长，请分段提交（上限 3000 字）' }, { status: 400 })
    }
    const result = await runWithRawLogContext({ userId, corpusId: null }, () =>
      extractCorpus(cleanedText),
    )
    return NextResponse.json(result)
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[extract API]', e)
    return NextResponse.json({ error: '萃取失败，请稍后再试' }, { status: 500 })
  }
}
