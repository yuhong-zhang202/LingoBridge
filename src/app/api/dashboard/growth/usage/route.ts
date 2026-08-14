/**
 * @module   api/dashboard/growth/usage
 * @desc     GET /api/dashboard/growth/usage?range=7d|14d|30d — 增长指标·主题三「使用与故障」：
 *           功能使用矩阵 10 行（人数 / 次数 / 人均）、每类故障的去重影响用户数。
 *
 *   【为什么单开路由】理由同 growth/funnel（口径与窗口都与主看板不同源，且主 route 被金标钉死）。
 *   与前两个主题再分开，是因为这两块的读者问题不同：一块答"哪个功能被用"、一块答
 *   "故障波及了多少人"，且后者的数据源是 api_usage_logs（而非 flow_events / auth.users）。
 *
 *   鉴权同主看板：requireAdmin 白名单。api_usage_logs 仅 service_role 可读（0012 起 RLS 无 select 策略）。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin, authErrorResponse } from '@/lib/api-auth'
import { parseRange } from '@/lib/db/dashboard-shared'
import { fetchFeatureUsage, fetchFailureImpact } from '@/lib/db/dashboard-growth-usage'

/**
 * 取使用矩阵与故障影响面。
 *
 * 【降级契约（前端必须据此标「降级中」，绝不静默显示错数）】两块各自独立降级：
 *   任一为 null ⇒ 对应 xxxPending 为 true（迁移 0065 未跑 / RPC 出错 / 查询失败），
 *   那一块的数字【不存在】而不是 0。范式对齐主看板的 newRegistrationsPending。
 *
 * ⚠️ 功能矩阵里依赖 page.tab_view 的五行（素材库四项 + 题库浏览）在埋点起算日之前【必然为 0】，
 *    响应里带 tabViewBaselineStart 与 tabViewCaveat，前端必须显示，否则会被读成"素材库没人用"。
 *
 * @param req  GET 请求，支持 ?range=7d|14d|30d
 * @returns    功能矩阵 + 故障影响面 + 两个降级标记
 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req)
    const { searchParams } = new URL(req.url)
    const windowDays = parseRange(searchParams.get('range'))
    const supabase = getSupabaseServer()

    const [featureUsage, failureImpact] = await Promise.all([
      fetchFeatureUsage(supabase, windowDays),
      fetchFailureImpact(supabase, windowDays),
    ])

    // 触顶绝不静默：打错误日志 + 随响应返 truncated，由 UI 明说方向（偏低）。同主看板纪律。
    if (failureImpact?.truncated) {
      logErr('[dashboard growth/usage API]', new Error('故障影响面取数分页触顶，次数与人数偏低；该把聚合下推到 DB 端了'))
    }

    return NextResponse.json({
      windowDays,
      // ① 功能使用矩阵（10 行，自带 page.tab_view 起算日与偏差说明）
      featureUsage,
      featureUsagePending: featureUsage === null,
      // ② 每类故障的去重影响用户数。
      //    ⚠️ 各环节 affectedUsers 相加 ≠ totalAffectedUsers（同一人可能在多环节踩到故障）。
      failureImpact,
      failureImpactPending: failureImpact === null,
    })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[dashboard growth/usage API]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : '查询失败' }, { status: 500 })
  }
}
