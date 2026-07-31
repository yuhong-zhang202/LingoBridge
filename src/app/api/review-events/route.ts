/**
 * @module   api/review-events
 * @desc     词组闪卡复习埋点上报入口：POST { kind } → 追加一行 review_events。词组闪卡复习在
 *           /review 页由客户端直接改 phrase_cards（不经服务端），但 review_events 表 RLS 无 insert 策略、
 *           客户端 anon key 写不进，故复习动作完成后另发一次 fire-and-forget 上报走本服务端路由补记事件。
 *
 *           userId【只从鉴权结果取】、绝不接受请求体里的 userId（防伪造他人复习事件）。埋点无 AI 副作用
 *           → 仅鉴权，不走同意/计次。埋点失败对前端无意义 → 恒返回 200，写入成败由服务端内部静默处理。
 * @author   LingoBridge
 * @created  2026-07-31
 */
import { NextResponse } from 'next/server'
import { requireRegistered, authErrorResponse } from '@/lib/api-auth'
import { logReviewEvent } from '@/lib/review-events'

/** POST：上报一次词组闪卡复习事件。恒 200（埋点失败前端无需感知）。 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireRegistered(req)
    const body = (await req.json().catch(() => ({}))) as { kind?: unknown }
    // kind 只接受两个字面量之一，其余（含缺失/非法）→ 400，绝不写入未知类别污染统计。
    if (body.kind !== 'anki' && body.kind !== 'phrase') {
      return NextResponse.json({ error: 'kind 必须为 anki 或 phrase' }, { status: 400 })
    }
    // logReviewEvent 内部已吞掉所有异常，这里 await 它不会抛；无论写入成败均回 200。
    await logReviewEvent(userId, body.kind)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    // 走到这里说明是鉴权外的意外（requireRegistered 抛的非 ApiAuthError 极少）；埋点不阻断，回 200。
    return NextResponse.json({ ok: true })
  }
}
