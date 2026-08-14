/**
 * @module   api/dashboard/growth/funnel
 * @desc     GET /api/dashboard/growth/funnel?range=7d|14d|30d — 增长指标·主题一「主线漏斗」：
 *           七步漏斗人数与转化率、三块漏斗质量注脚、额度墙转化与沉默。
 *
 *   【为什么单开路由，不并进 /api/dashboard】三点：
 *     · 口径不同源 —— 本批全部剔除内部账户与 is_qa 自测流量，而主看板的 0047 那批增长指标
 *       两者都不剔（见 0064 顶注）。两批的人数不可互相对照，接口也不该混在一起，
 *       混在一起最先发生的事就是有人把两个字段相减。
 *     · 窗口也不同源 —— 本批沿用 0047 的闭区间 [今日-N, 今日]（N+1 天），主看板是恰好 N 天。
 *     · 主 route 已 337 行且被两道金标守卫钉死（响应结构 63 个顶层键），加字段会直接把守卫打红。
 *   另有一个好处：本块查询挂了只让这一块显错，主看板照常。
 *
 *   鉴权同主看板：requireAdmin 白名单。flow_events 无 select 策略，只有 service_role 读得到。
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
  fetchGrowthFunnel, fetchBrowseOnly, fetchFunnelQuality, fetchQuotaWall,
} from '@/lib/db/dashboard-growth-funnel'

/**
 * 取主线漏斗整块数据。
 *
 * 【降级契约（前端必须据此标「降级中」，绝不静默显示错数）】四块各自独立降级：
 *   funnel / browseOnly / quality / quotaWall 任一为 null ⇒ 对应的 xxxPending 为 true，
 *   表示"迁移 0064 未跑 / RPC 出错 / 查询失败"，那一块的数字【不存在】而不是 0。
 *   范式逐字对齐主看板的 newRegistrationsPending / activationPending。
 *
 * @param req  GET 请求，支持 ?range=7d|14d|30d（额度墙刻意不随 range 变，撞墙窗口锁死 30 天）
 * @returns    七步漏斗 + 三块质量注脚 + 额度墙 + 四个降级标记
 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req)
    const { searchParams } = new URL(req.url)
    const windowDays = parseRange(searchParams.get('range'))
    const supabase = getSupabaseServer()

    // 四块并发；每个 fetcher 自带 try/catch 返 null，不会 reject 拖垮整条 route。
    const [funnel, browseOnly, quality, quotaWall] = await Promise.all([
      fetchGrowthFunnel(supabase, windowDays),
      fetchBrowseOnly(supabase, windowDays),
      fetchFunnelQuality(supabase, windowDays),
      fetchQuotaWall(supabase),
    ])

    // 取数触顶 = 最新那批数据被丢弃、次数与人数偏低（口径没错、数据不全）。绝不静默：
    // 打错误日志 + 随响应返 truncated，由 UI 明说方向（偏低）。同主看板 dataTruncated 的纪律。
    if (quality?.truncated) {
      logErr('[dashboard growth/funnel API]', new Error('漏斗质量注脚取数分页触顶，次数与人数偏低；该把聚合下推到 DB 端了'))
    }

    return NextResponse.json({
      windowDays,
      // ① 七步主线漏斗（含相邻转化率与掉幅最大一级的下标）
      funnel,
      funnelPending: funnel === null,
      // ② 注脚·只浏览未动手的注册用户（同一人群的真集合差，不是两个人数相减）
      browseOnly,
      browseOnlyPending: browseOnly === null,
      // ③ 注脚·匹配质量 / 出题停留 / 反馈卡（flow_events 聚合，自带 truncated）
      quality,
      qualityPending: quality === null,
      // ④ 额度墙（撞墙窗口锁死 30 天、观察期 7 天，均不随 range 变）。
      //    ⚠️ matureUsers ≪ wallUsers 时两个率还没定型 —— 最近 7 天撞墙的人观察期没走完。
      quotaWall,
      quotaWallPending: quotaWall === null,
    })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[dashboard growth/funnel API]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : '查询失败' }, { status: 500 })
  }
}
