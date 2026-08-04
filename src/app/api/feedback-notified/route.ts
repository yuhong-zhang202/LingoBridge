/**
 * @module   api/feedback-notified
 * @desc     反馈闭环通知的用户侧端点。
 *           GET  — 取当前用户「已处理 + 有回复 + 还没告诉过他」的反馈（弹窗数据源）。
 *           POST — body { ids }：把这些行标记为已通知（弹窗看过即调，防止下次再弹）。
 *
 *   🔴【为什么写入必须走服务端，而不是给 feedback 表加一条 update policy】
 *     加 update policy 就等于给客户端开了写这张表的口子：即便用 WITH CHECK 限死列，
 *     PostgREST 的 update 仍能被拿来改 message、伪造 handled_at。本项目已有「新对象默认对 anon 裸奔」
 *     的实测教训（0052 / 0054），这里的纪律是：**feedback 表永远只有 insert + select 两条策略**，
 *     一切写路径走服务端、由服务端决定能改哪一列、改成什么值。
 *
 *   🔴【越权防线】POST 用 service_role 执行（绕 RLS），所以必须自己把住 user_id：
 *     update 的 where 同时带 `id in (...)` 与 `user_id = 调用者`，别人的行一行都碰不到。
 *     notified_at 的值由服务端取 now()，**不接受客户端传任何时间**（否则可被写成未来时间永久免打扰）。
 *
 *   【只发给谁】仅注册用户（匿名换设备就认不出人，弹窗多半送不到）、仅 kind='manual'
 *     （crash 是用户在报错页写的，不一定期待回音）。两条都是产品方 2026-08-04 拍板。
 *
 * @author   LingoBridge
 * @created  2026-08-04
 */
import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { logErr } from '@/lib/log'

/** 一次最多返回几条：反馈量级是一天 0 到 2 条，取 5 足够，也避免弹窗被历史积压刷屏 */
const MAX_ITEMS = 5

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 迁移 0056 未跑时 Postgres 的报错形状（列不存在），与 feedback-handled 的判定同款 */
function isMissingReplyColumn(e: unknown): boolean {
  const err = e as { code?: string; message?: string }
  return err?.code === '42703' && /reply|notified_at/.test(err?.message ?? '')
}

/**
 * 取当前用户待告知的反馈。
 * @param req  GET 请求（需登录）
 * @returns    200 { items: [{ id, message, reply, created_at, handled_at }] }；未迁移时 items 为空数组
 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    // 匿名用户直接空：他们换个设备就不是同一个人了，通知送不到，也不该让弹窗逻辑去猜
    if (isAnonymous) return NextResponse.json({ items: [] })

    const { data, error } = await getSupabaseServer()
      .from('feedback')
      .select('id, message, reply, created_at, handled_at')
      .eq('user_id', userId)
      .eq('kind', 'manual')
      .not('handled_at', 'is', null)
      .not('reply', 'is', null)
      .is('notified_at', null)
      .order('handled_at', { ascending: false })
      .limit(MAX_ITEMS)
    if (error) {
      // 未迁移 / 查询异常一律静默当「没有待通知」：这是锦上添花的功能，绝不因它挡住用户进首页
      if (!isMissingReplyColumn(error)) logErr('[feedback-notified GET]', error)
      return NextResponse.json({ items: [] })
    }
    return NextResponse.json({ items: data ?? [] })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[feedback-notified GET]', e)
    return NextResponse.json({ items: [] })
  }
}

/**
 * 标记这些反馈已告知当前用户。
 * @param req  POST 请求，body { ids: string[] }（uuid 数组）
 * @returns    200 { ok, count } / 400 参数不合法 / 401 未登录
 * @sideEffect service_role 把 notified_at 置为服务端 now()，where 同时限 id 与 user_id
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    if (isAnonymous) return NextResponse.json({ ok: true, count: 0 })

    let body: unknown = null
    try {
      body = await req.json()
    } catch {
      // 非法 JSON：落到下方 400
    }
    const { ids } = (body ?? {}) as { ids?: unknown }
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ITEMS
      || !ids.every((x) => typeof x === 'string' && UUID_RE.test(x))) {
      return NextResponse.json({ error: '参数不合法：需要 { ids: uuid[] }' }, { status: 400 })
    }

    const { data, error } = await getSupabaseServer()
      .from('feedback')
      .update({ notified_at: new Date().toISOString() })   // 时间由服务端给，不收客户端的值
      .in('id', ids as string[])
      .eq('user_id', userId)                                // 越权防线：只能标自己的行
      .select('id')
    if (error) {
      if (isMissingReplyColumn(error)) {
        return NextResponse.json({ code: 'REPLY_NOT_MIGRATED', error: '待迁移 0056' }, { status: 409 })
      }
      throw error
    }
    return NextResponse.json({ ok: true, count: data?.length ?? 0 })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[feedback-notified POST]', e)
    return NextResponse.json({ error: '标记失败' }, { status: 500 })
  }
}
