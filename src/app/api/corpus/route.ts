/**
 * @module   api/corpus
 * @desc     POST 创建一段新语料 —— 服务端强制故事月额度并落库（客户端直连 insert 可绕过额度，故搬服务端）。
 *           鉴权 + 配额照 /api/practice 模式：requireUser → 超额 402(QUOTA_EXCEEDED) → createCorpusServer。
 *           仅创建这一步服务端化；后续 updateCorpusCleaned / upsertMatch / 跳转仍走客户端 RLS。
 * @author   LingoBridge
 * @created  2026-07-12
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { countCorpusThisMonthServer, countCorpusForUserServer, createCorpusServer } from '@/lib/db/corpus-server'
import { STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { ANON_CORPUS_LIMIT } from '@/lib/constants'
import type { CorpusSource } from '@/lib/types'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    const body = (await req.json()) as { source?: unknown; rawText?: unknown }
    const source: CorpusSource = body.source === 'text' ? 'text' : 'voice'
    const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : ''
    if (!rawText) {
      return NextResponse.json({ error: 'rawText 不能为空' }, { status: 400 })
    }

    // 额度服务端强制：超额返回 402 + code=QUOTA_EXCEEDED，客户端据此弹配额提示。
    // 匿名用户走「试用仅 1 条」（总条数）；注册用户维持既有故事月额度。
    if (isAnonymous) {
      const total = await countCorpusForUserServer(userId)
      if (total >= ANON_CORPUS_LIMIT) {
        return NextResponse.json({ error: '试用已完成，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
      }
    } else {
      const used = await countCorpusThisMonthServer(userId)
      if (used >= STORY_MONTHLY_LIMIT) {
        return NextResponse.json({ error: '本月故事额度已用完', code: 'QUOTA_EXCEEDED' }, { status: 402 })
      }
    }

    const corpus = await createCorpusServer(userId, { source, rawText })
    return NextResponse.json({ corpus })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[corpus API]', e)
    return NextResponse.json({ error: '保存语料失败' }, { status: 500 })
  }
}
