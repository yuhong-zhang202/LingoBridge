/**
 * @module   db/dashboard-growth-shared
 * @desc     【仅服务端】产品增长指标批次（迁移 0064/0065）的共享底座 —— 窗口口径、内部账户参数、
 *           数值兜底、比率计算。三个主题模块（funnel / cohorts / usage）一律走它，不各写一套。
 *
 *   ⚠️⚠️【本批次的窗口口径与主看板【不同】，这是刻意的，别"顺手统一"】
 *     · 本批（0064/0065 全部 RPC + 本文件 growthWindowStart）：闭区间 [今日-N, 今日]，
 *       实际覆盖 N+1 个日历日 —— 逐字沿用 0047 那批既有 RPC 的写法；
 *     · 主看板（api/dashboard/route.ts 的 rangeStartDate、dashboard-flow-events 的 flowWindowStart）：
 *       [今日-(N-1), 今日]，恰好 N 天。
 *     两边差【一天的量】，**任何跨批次的加减都是错的**。之所以对齐 0047 而不是对齐主看板：
 *     本批的数会和 0043-0048 那批摆在同一块看板上被人肉对照，SQL 侧两套窗口写法互不相同
 *     才是真的会害人；而 TS 侧只要与自己那批的 SQL 一致即可。
 *
 *   ⚠️【本批次剔除内部账户与 is_qa，0047 那批两者都不剔】两批的人数不可直接相减或对比
 *     （差值既不是"自测量"也不是"内部账户量"，而是两套口径的混合差）。全文见 0064 顶注。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import 'server-only'
import { INTERNAL_ACCOUNT_IDS } from '@/lib/internal-accounts'
import { FLOW_BASELINE_START } from './dashboard-flow-events'

/** 东八区偏移（无夏令时）：日界一律按东八区折算，与看板其余口径一致 */
const HK_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 内部账户名册的 RPC 参数形态（uuid[]）。
 * 名册的唯一真源是 src/lib/internal-accounts.ts —— 刻意【不在 SQL 里再抄一份】：抄了就会两处
 * 各自漂移，且改名册要跑迁移。范式逐字照抄 0063_global_ai_cost_today。
 */
export const GROWTH_EXCLUDE_IDS: readonly string[] = [...INTERNAL_ACCOUNT_IDS]

/**
 * 本批次的窗口起点：东八区「今天 0 点往前推 windowDays 天」的 UTC 时刻。
 *
 * ⚠️ 与 dashboard-flow-events 的 flowWindowStart【差一天】（那个推 windowDays-1 天）。
 *    这里必须与 0064/0065 的 SQL 逐字一致（`>= 今日 - p_window_days`），否则同一张卡上
 *    RPC 算出来的人数与 TS 侧算出来的次数会各用各的窗口 —— 那种错误不会报任何异常，
 *    只会让"人均"这类派生值悄悄偏掉几个百分点。
 * @param now         当前时刻
 * @param windowDays  窗口天数（与看板 range 联动的 7/14/30）
 * @returns           窗口起点（UTC 时刻）
 */
export function growthWindowStart(now: Date, windowDays: number): Date {
  const hk = new Date(now.getTime() + HK_OFFSET_MS)
  const todayStartUtc = new Date(Date.UTC(hk.getUTCFullYear(), hk.getUTCMonth(), hk.getUTCDate()) - HK_OFFSET_MS)
  return new Date(todayStartUtc.getTime() - windowDays * DAY_MS)
}

/**
 * PostgREST 数值兜底：int 列正常回 number，numeric/bigint 列可能回字符串（保精度）。
 * 解析不出数字一律回 0 —— 计数类字段没有"未知"这个状态，回 NaN 会让下游的比率静默变成 NaN。
 * @param v  RPC 回的原始值
 * @returns  安全整数（非有限值回 0）
 */
export function toCount(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * 百分比（0-100，保留 1 位小数）。分母为 0 时返回 null —— 【诚实占位，绝不返回 0】：
 * 0% 和"没有样本"在页面上长得一样，但含义相反（前者=都流失了，后者=还没人走到这一步）。
 * 与 0047 w1_rate「n=0 时返回 null」同一条纪律。
 * @param numerator    分子
 * @param denominator  分母
 * @returns            百分比；分母为 0 时 null
 */
export function ratePct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

/**
 * 比值（保留 2 位小数）。分母为 0 时返回 null（理由同 ratePct）。
 * 供 DAU/MAU 粘性比与「人均次数」用。
 * @param numerator    分子
 * @param denominator  分母
 * @returns            比值；分母为 0 时 null
 */
export function ratio2(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 100) / 100
}

/**
 * page.tab_view 埋点的起算日（东八区，展示用）。
 *
 * 【为什么必须有】page.tab_view 是 2026-08-14 才加的（commit 09a6f7d），上线之前【零历史数据】。
 * 功能矩阵里依赖它的五格（素材库四项 + 题库浏览）在起算日之前必然全 0 —— 那不是"没人用"。
 * 前端必须据此显示「自 YYYY-MM-DD 起统计」，否则这张表第一天就会被读成"素材库没人用"。
 * 范式同 dashboard-shared 的 COST_QA_BASELINE_START / dashboard-flow-events 的 FLOW_BASELINE_START。
 *
 * ⚠️ 这里写的是【代码合入日】。真实起算日 = 该版本部署到生产之日，只会【晚于或等于】这个值。
 *    部署日若与此不符，改这一处（它是唯一真源，前端口径小字直接读它）。
 */
export const TAB_VIEW_BASELINE_START = '2026-08-14'

/**
 * 采集类 flow_events 的起算日（东八区）。**直接复用 dashboard-flow-events 的唯一真源，
 * 刻意不在本文件另写一份日期** —— 两处各写一份，改一处忘另一处时不会报错，只会让两张卡各说各话。
 */
export { FLOW_BASELINE_START }

/** 起算日的 UTC 时刻（= 东八区当日 0 点）。由日期串换算，保持单一真源。 */
const FLOW_BASELINE_TS = Date.parse(`${FLOW_BASELINE_START}T00:00:00.000Z`) - HK_OFFSET_MS

/** 窗口与埋点起算日的关系（前端据此决定能不能显示转化率） */
export type FlowBaselineInfo = {
  /** 起算日（东八区日期串），供 UI 显示「埋点自 YYYY-MM-DD 起统计」 */
  baselineStart: string
  /** 本次窗口是否跨过起算日 —— true 时埋点侧的步骤【系统性偏低】 */
  crossesBaseline: boolean
  /** 窗口内真正有埋点数据的天数（跨界时 < 窗口天数） */
  effectiveDays: number
  /** 窗口总天数（闭区间，= windowDays + 1，见本文件顶注） */
  windowTotalDays: number
}

/**
 * 算出「本次窗口有多少天真的有采集类埋点数据」。
 *
 * 【为什么必须有 —— 2026-08-14 生产实测暴露的真问题】
 *   七步漏斗的数据源是【混的】：第 1/3/6 步读表（consent_records / corpus / practice_sessions，
 *   内测第一天就有数据），第 2/4/5/7 步读 flow_events（**2026-08-02 才上线**）。
 *   拉 range=30d 时窗口是 7/15~8/14，其中【前 18 天埋点根本不存在】⇒ 表侧吃满 30 天、
 *   埋点侧只有后 12 天 ⇒ 漏斗必然倒挂。生产实测：第 2 步 29 人 < 第 3 步 95 人，
 *   转化率算出 327.6%、"流失 -66 人"。
 *
 *   **这不是 SQL 写错，是拿两个起算日不同的数据源做了减法。** 修法不是改 SQL，是把这件事
 *   如实告诉前端：跨界时禁止显示跨源转化率，并标出埋点实际覆盖了几天。
 *
 * ⚠️ 本函数只回答「窗口跨没跨界」，**不修正数字** —— 回填历史埋点是不可能的
 *   （0053 顶注：谁在什么时候自测过，事后无据可判），任何"补偿系数"都是编数。
 *
 * @param now         当前时刻
 * @param windowDays  窗口天数（7/14/30）
 * @returns           起算日、是否跨界、有效天数
 */
export function flowBaselineInfo(now: Date, windowDays: number): FlowBaselineInfo {
  const startTs = growthWindowStart(now, windowDays).getTime()
  const windowTotalDays = windowDays + 1
  if (startTs >= FLOW_BASELINE_TS) {
    return { baselineStart: FLOW_BASELINE_START, crossesBaseline: false, effectiveDays: windowTotalDays, windowTotalDays }
  }
  // 跨界：从起算日算到窗口末尾（东八区今日 24:00）还剩几天，向上取整——首日是部分天，仍算一天
  const endTs = startTs + windowTotalDays * DAY_MS
  const effectiveDays = Math.max(0, Math.min(windowTotalDays, Math.ceil((endTs - FLOW_BASELINE_TS) / DAY_MS)))
  return { baselineStart: FLOW_BASELINE_START, crossesBaseline: true, effectiveDays, windowTotalDays }
}
