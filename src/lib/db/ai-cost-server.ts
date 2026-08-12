/**
 * @module   db/ai-cost-server
 * @desc     【仅服务端】读「今日（东八区）全站 AI 花费」——全局预算熔断的唯一取数口。
 *           判定与缓存不在这里，见 src/lib/global-budget-breaker.ts；本模块只负责「问 DB 拿一个数」。
 *
 *   【为什么不在应用层求和】看板那条路（拉全量行回 Node 再 reduce）在这里会算错：分页有页数上限，
 *   触顶即静默少报。少报对看板只是数字偏低，对熔断则是**该断的时候不断**，而「行数暴涨」正是熔断
 *   唯一要对付的场景。故一律走迁移 0063 的 RPC，让 PG 端一次 sum 出精确标量。
 *
 *   【口径三条，与看板成本口径逐条同义】日界东八区、剔 is_qa、剔内部账户 —— 全部在 SQL 侧，
 *   本文件只把内部账户名册（TS 侧唯一真源）作为参数传下去，绝不在 SQL 里再抄一份名册。
 *
 * @author   LingoBridge
 * @created  2026-08-12
 */
import 'server-only'

import { getSupabaseServer } from '../supabase-server'
import { INTERNAL_ACCOUNT_IDS } from '../internal-accounts'

/**
 * 读今日（东八区）全站 AI 花费合计，单位人民币元。
 *
 * 【返回 null 与返回 0 必须分得开】0 = 「今天确实一分钱没花」，null = 「读不到，不知道花了多少」。
 * 本模块刻意不像 readDailyUsageServer 那样把失败折成 0 —— 那会把「读不到」伪装成「没花钱」，
 * 让调用方失去选择失败方向的机会。失败方向由 global-budget-breaker 决定（并在那里论证）。
 *
 * @returns     今日花费（元）；查询失败 / RPC 不存在（迁移未应用）一律 null
 * @sideEffect  service_role 调 RPC global_ai_cost_today_cny（只读聚合，无写入；绕 RLS）
 */
export async function readTodayAiCostCny(): Promise<number | null> {
  try {
    const { data, error } = await getSupabaseServer().rpc('global_ai_cost_today_cny', {
      p_exclude_user_ids: [...INTERNAL_ACCOUNT_IDS],
    })
    if (error) throw new Error(error.message)
    // PostgREST 把 numeric 回成字符串或数字都有可能（取决于数值大小/驱动版本），两种都收；
    // 解析不出有限数一律当读失败（返回 null），绝不让 NaN 流进阈值比较——NaN >= 60 恒 false = 静默失效。
    const n = typeof data === 'number' ? data : Number(data)
    return Number.isFinite(n) ? n : null
  } catch (err) {
    console.error('[ai-cost-server] readTodayAiCostCny 失败，返回 null 交由调用方决定失败方向', err)
    return null
  }
}
