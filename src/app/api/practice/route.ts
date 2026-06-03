/**
 * @module   api/practice
 * @desc     POST 练习对话 — 首轮构建脚手架并开场，后续基于脚手架续聊（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { buildScaffold, coachReply } from '@/services/practice'
import type { PracticeScaffold, PracticeMessage } from '@/lib/types'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      questionId?: string
      messages?: PracticeMessage[]
      scaffold?: PracticeScaffold
    }
    const messages = Array.isArray(body.messages) ? body.messages : []

    // 首轮没有 scaffold：用 questionId 构建一次
    let scaffold = body.scaffold
    if (!scaffold) {
      if (!body.questionId) {
        return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
      }
      scaffold = await buildScaffold(body.questionId)
    }

    const reply = await coachReply(scaffold, messages)
    return NextResponse.json({ scaffold, reply })
  } catch (e) {
    console.error('[practice API] error', e)
    return NextResponse.json({ error: '对话失败' }, { status: 500 })
  }
}
