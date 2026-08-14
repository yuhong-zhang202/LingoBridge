/**
 * @module   api/dashboard/growth/cohorts
 * @desc     GET /api/dashboard/growth/cohorts?range=7d|14d|30d — 增长指标·主题二「群组」：
 *           W1 留存曲线（逐周分子/分母）、粘性比 DAU/MAU 每日序列、用户分层 × 各层留存。
 *
 *   【为什么单开路由】理由同 growth/funnel（口径与窗口都与主看板不同源，且主 route 被金标钉死）。
 *   本主题与漏斗主题再分开，是因为三条查询都是【群组类】、回看范围可超出所选窗口
 *   （W1 至少回看 30 天、MAU 滚动 30 天），与漏斗那批"窗口内计数"的语义不是一回事。
 *
 *   鉴权同主看板：requireAdmin 白名单。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin, authErrorResponse } from '@/lib/api-auth'
import { parseRange } from '@/lib/db/dashboard-shared'
import {
  fetchRetentionSeries, fetchStickiness, fetchUserSegments,
} from '@/lib/db/dashboard-growth-cohorts'

/**
 * 取群组类指标整块数据。
 *
 * 【降级契约（前端必须据此标「降级中」，绝不静默显示错数）】三块各自独立降级：
 *   任一为 null ⇒ 对应 xxxPending 为 true，表示"迁移 0065 未跑 / RPC 出错"，
 *   那一块的数字【不存在】而不是 0。范式对齐主看板的 weeklyRetentionPending。
 *   ⚠️ retentionSeries 为【空数组】不是降级：那表示回看范围内没有任何成熟群组（内测早期正常），
 *      与"读不到数"是两件事，前端必须分开显示。
 *
 * @param req  GET 请求，支持 ?range=7d|14d|30d
 * @returns    W1 留存曲线 + 粘性序列 + 用户分层 + 三个降级标记
 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req)
    const { searchParams } = new URL(req.url)
    const windowDays = parseRange(searchParams.get('range'))
    const supabase = getSupabaseServer()

    const [retentionSeries, stickiness, segments] = await Promise.all([
      fetchRetentionSeries(supabase, windowDays),
      fetchStickiness(supabase, windowDays),
      fetchUserSegments(supabase, windowDays),
    ])

    return NextResponse.json({
      windowDays,
      // ① W1 留存曲线：每点 (周起始日, 分母 cohortN, 分子 returnedN, 率)。
      //    ⚠️ 前端必须显示 n —— 个位数群组下只显示百分比是假精度。
      retentionSeries,
      retentionSeriesPending: retentionSeries === null,
      // ② 粘性比 DAU/MAU 每日序列（mau=0 时 ratio 为 null，不是 0）
      stickiness,
      stickinessPending: stickiness === null,
      // ③ 用户分层 × 各层 W1 留存 + 核心活跃人数拆分。
      //    ⚠️ 四层中「高频用户」与前三层正交，四行相加没有意义，绝不可画成饼图。
      segments,
      segmentsPending: segments === null,
    })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[dashboard growth/cohorts API]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : '查询失败' }, { status: 500 })
  }
}
