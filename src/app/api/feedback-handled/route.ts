/**
 * @module   api/feedback-handled
 * @desc     POST /api/feedback-handled — 管理员标记 / 撤销一条反馈的「已处理」状态。
 *           body { id, handled }：handled=true 置 handled_at=now()，false 置 null（撤销）。
 *           requireAdmin 鉴权 + service_role 执行（feedback 表 RLS 仅本人可写，管理员改别人的行必须绕 RLS，
 *           越权防护由 requireAdmin 白名单在应用层承担）。迁移 0055 未跑（handled_at 列不存在）时返回
 *           409 + code=HANDLED_NOT_MIGRATED，供前端提示「待迁移」而不是含混的 500。
 *           ⚠️ 日志红线：本路由任何日志不得输出反馈行内容（message/context 含用户内容与 email PII）。
 * @author   LingoBridge
 * @created  2026-08-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin, authErrorResponse } from '@/lib/api-auth'
import { isMissingHandledColumn } from '@/lib/db/dashboard-feedback'

/** feedback.id 是 uuid：不合形的 id 直接 400，不让它带着 22P02 之类的解析错走到 500 分支 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 标记 / 撤销「已处理」。
 * @param req  POST 请求，body { id: string(uuid), handled: boolean }
 * @returns    200 { ok, id, handled } / 400 参数不合法 / 401 未授权 / 403 非管理员 /
 *             404 反馈不存在 / 409 code=HANDLED_NOT_MIGRATED（迁移 0055 未跑）/ 500 其余异常
 * @sideEffect service_role 更新 feedback.handled_at（绕 RLS，仅此一列）
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req)

    let body: unknown = null
    try {
      body = await req.json()
    } catch {
      // body 不是合法 JSON：落到下方统一的 400 分支
    }
    const { id, handled } = (body ?? {}) as { id?: unknown; handled?: unknown }
    if (typeof id !== 'string' || !UUID_RE.test(id) || typeof handled !== 'boolean') {
      return NextResponse.json({ error: '参数不合法：需要 { id: uuid, handled: boolean }' }, { status: 400 })
    }

    const { data, error } = await getSupabaseServer()
      .from('feedback')
      .update({ handled_at: handled ? new Date().toISOString() : null })
      .eq('id', id)
      .select('id')
    if (error) {
      if (isMissingHandledColumn(error)) {
        return NextResponse.json(
          { code: 'HANDLED_NOT_MIGRATED', error: '已处理标记待迁移 0055，当前不可标记' },
          { status: 409 },
        )
      }
      throw error
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: '该反馈不存在' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, id, handled })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    // 只记异常本身（DB 错误对象无行内容）；绝不把 body/反馈内容写进日志
    logErr('[feedback-handled API]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : '更新失败' }, { status: 500 })
  }
}

/**
 * 非 POST 明确 405。Next 对未导出的方法本也会 405，这里显式导出是为了把「方法不对 → 405」
 * 钉进单测（GET/POST 打错是本项目踩过的真实坑：曾拿 405 当「通过」，见 CLAUDE.md 验证纪律 2）。
 * @returns 405 JSON
 */
export function GET(): NextResponse {
  return NextResponse.json({ error: '仅支持 POST' }, { status: 405 })
}
