/**
 * @module   api/dashboard/flow-health
 * @desc     GET /api/dashboard/flow-health?range=7d|14d|30d — 「客户端链路观测」数据源：
 *           读 flow_events 埋点表，返回 AI 调用结局分布 / 埋点健康 / 枚举取值覆盖三块。
 *
 *   【为什么单开一条路由，不并进 /api/dashboard】两点：
 *     · 口径不同源 —— 主看板全部基于 api_usage_logs（真实计费调用），本块基于 flow_events
 *       （用户视角的尝试与结局，含压根没记账的早退分支）。两者数字不该对得上，接口也别混在一起。
 *     · 主 route 已 900+ 行，逼近 ENGINEERING.md §1 的 1000 行红线。
 *   另有一个好处：本块查询挂了只让这一块显错，主看板照常。
 *
 *   鉴权同主看板：requireAdmin 白名单。flow_events 无 select 策略，只有 service_role 读得到。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin, authErrorResponse } from '@/lib/api-auth'
import { fetchFlowHealth } from '@/lib/db/dashboard-flow-events'

/**
 * 解析 range 查询参数为天数（与主看板同款，非法值一律回退 7）。
 * @param raw  URL 参数原始值
 * @returns    7 | 14 | 30
 */
function parseRange(raw: string | null): number {
  if (raw === '14d') return 14
  if (raw === '30d') return 30
  return 7
}

/**
 * 取「客户端链路观测」三块聚合数据。
 * @param req  GET 请求，支持 ?range=7d|14d|30d
 * @returns    FlowHealthResult（AI 结局分布 / 各事件计数 / 枚举取值覆盖 + 窗口与 QA 元信息）
 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req)
    const { searchParams } = new URL(req.url)
    const windowDays = parseRange(searchParams.get('range'))
    const data = await fetchFlowHealth(getSupabaseServer(), windowDays)
    return NextResponse.json(data)
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[dashboard flow-health API]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : '查询失败' }, { status: 500 })
  }
}
