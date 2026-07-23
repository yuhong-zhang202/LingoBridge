/**
 * @module   api/anki/cards/review
 * @desc     Anki 题卡 SRS 复习（方案 §11 懒物化）：POST { questionId, remembered } → 按 Leitner
 *           算新盒子（记住 box+1 封顶 / 不记得回 box1）+ 刷新 due_at/last_reviewed_at。
 *
 *           懒物化：默认卡从未落库 → 卡行可能不存在 → 走 upsert on conflict (user_id, question_id)
 *           （0030 唯一约束）：新行按默认卡初值（box1、corpus_id null）建、再套本次 review 结果；
 *           已有行只更新 SRS 字段，不碰 corpus_id/generated_answer/edited_answer（换/删语料不 touch SRS，
 *           复习亦不 touch 语料/答案）。无 AI 副作用 → 仅鉴权，不走同意/计次。
 * @author   LingoBridge
 * @created  2026-07-23
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { upsertReview } from '@/lib/db/anki-cards-server'
import { requireUser, authErrorResponse } from '@/lib/api-auth'

/** POST：SRS 复习。 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as { questionId?: unknown; remembered?: unknown }
    const questionId = typeof body.questionId === 'string' ? body.questionId.trim() : ''
    if (!questionId) return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    if (typeof body.remembered !== 'boolean') {
      return NextResponse.json({ error: 'remembered 必须为布尔值' }, { status: 400 })
    }
    const result = await upsertReview(userId, questionId, body.remembered)
    return NextResponse.json(result)
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[anki cards review POST]', e)
    return NextResponse.json({ error: '复习更新失败' }, { status: 500 })
  }
}
