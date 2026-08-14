/**
 * @module   db/dashboard-growth-flow-baseline.test
 * @desc     `flowBaselineInfo` 的守卫 —— 它决定前端**敢不敢显示七步漏斗的跨源转化率**。
 *
 *   【为什么这个函数必须有测试】2026-08-14 用生产真实数据拉了一次漏斗，发现两处倒挂：
 *   第 2 步 29 人 < 第 3 步 95 人（转化率算出 327.6%、"流失 -66 人"），第 5→6 步同理。
 *   根因不是 SQL 写错，而是**七步漏斗的数据源是混的**：
 *     · 第 1/3/6 步读表（consent_records / corpus / practice_sessions）—— 内测第一天就有数据；
 *     · 第 2/4/5/7 步读 flow_events —— **2026-08-02 才上线**（生产实测最早一条
 *       flow.capture_started 是 2026-08-02 19:52:30Z）。
 *   拉 range=30d 时窗口 7/15~8/14，前 18 天埋点根本不存在 ⇒ 表侧吃满、埋点侧只有后 13 天。
 *
 *   本函数只回答「窗口跨没跨起算日、埋点实际覆盖几天」，**不修正任何数字** ——
 *   历史埋点无法回填（0053 顶注：谁在什么时候自测过，事后无据可判），
 *   任何"补偿系数"都是编数。判错的后果是前端把一个失真三倍的转化率当结论显示。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
jest.mock('server-only', () => ({}))

import { flowBaselineInfo, tabViewBaselineInfo, FLOW_BASELINE_START } from '@/lib/db/dashboard-growth-shared'

/** 起算日 = 东八区 2026-08-02 00:00 = UTC 2026-08-01T16:00Z */
const BASELINE_UTC = '2026-08-01T16:00:00.000Z'

describe('flowBaselineInfo · 埋点起算日与窗口的关系', () => {
  it('起算日常量与 dashboard-flow-events 的唯一真源一致（防两处各写一份日期）', () => {
    expect(FLOW_BASELINE_START).toBe('2026-08-02')
    // 换算关系也钉住：日期串 → 东八区当日 0 点 → UTC 时刻
    expect(new Date(Date.parse(`${FLOW_BASELINE_START}T00:00:00.000Z`) - 8 * 3600_000).toISOString())
      .toBe(BASELINE_UTC)
  })

  it('窗口整段在起算日之后 → 不跨界，有效天数 = 窗口全长', () => {
    // 香港 2026-08-14 20:00；7 天窗口起点 = 香港 08-07 00:00（晚于起算日）
    const r = flowBaselineInfo(new Date('2026-08-14T12:00:00.000Z'), 7)
    expect(r.crossesBaseline).toBe(false)
    expect(r.windowTotalDays).toBe(8)          // 闭区间 = windowDays + 1，见 shared 顶注
    expect(r.effectiveDays).toBe(8)
  })

  it('【本次真实场景】30 天窗口跨界 → 埋点只覆盖 13 天，不是 31 天', () => {
    const r = flowBaselineInfo(new Date('2026-08-14T12:00:00.000Z'), 30)
    expect(r.crossesBaseline).toBe(true)
    expect(r.windowTotalDays).toBe(31)
    // 起算日 08-01T16:00Z → 窗口末尾 08-14T16:00Z，恰好 13 天
    expect(r.effectiveDays).toBe(13)
    // 这就是 327.6% 转化率的来源：表侧 31 天 vs 埋点侧 13 天
    expect(r.effectiveDays).toBeLessThan(r.windowTotalDays)
  })

  it('窗口整段早于起算日 → 有效天数 0（埋点侧全空，绝不是"没人用"）', () => {
    // 香港 2026-07-20，30 天窗口整体落在起算日之前
    const r = flowBaselineInfo(new Date('2026-07-20T12:00:00.000Z'), 30)
    expect(r.crossesBaseline).toBe(true)
    expect(r.effectiveDays).toBe(0)
  })

  it('有效天数恒不为负、且恒不超过窗口全长', () => {
    for (const iso of ['2026-07-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', '2026-12-31T23:59:59.000Z']) {
      for (const d of [7, 14, 30]) {
        const r = flowBaselineInfo(new Date(iso), d)
        expect(r.effectiveDays).toBeGreaterThanOrEqual(0)
        expect(r.effectiveDays).toBeLessThanOrEqual(r.windowTotalDays)
      }
    }
  })

  it('起算日当天不算跨界（边界：窗口起点恰好等于起算日）', () => {
    // 香港 2026-08-09，7 天窗口起点 = 香港 08-02 00:00 = 起算日整点
    const r = flowBaselineInfo(new Date('2026-08-09T12:00:00.000Z'), 7)
    expect(r.crossesBaseline).toBe(false)
    expect(r.effectiveDays).toBe(r.windowTotalDays)
  })
})

describe('tabViewBaselineInfo · page.tab_view 起算日（2026-08-14）', () => {
  it('起算日当天 → 不跨界', () => {
    const r = tabViewBaselineInfo(new Date('2026-08-14T12:00:00.000Z'), 0)
    expect(r.baselineStart).toBe('2026-08-14')
    expect(r.crossesBaseline).toBe(false)
  })

  it('【上线初期的真实场景】30 天窗口 → 跨界，有效天数仅 1（不是 31）', () => {
    // 香港 2026-08-14 20:00；窗口 07-15~08-14，而 tab 埋点当天才上线
    const r = tabViewBaselineInfo(new Date('2026-08-14T12:00:00.000Z'), 30)
    expect(r.crossesBaseline).toBe(true)
    expect(r.windowTotalDays).toBe(31)
    expect(r.effectiveDays).toBe(1)
  })

  it('与 flow 版是两套独立起算日（改一个不该影响另一个）', () => {
    const now = new Date('2026-08-14T12:00:00.000Z')
    expect(tabViewBaselineInfo(now, 30).baselineStart).toBe('2026-08-14')
    expect(flowBaselineInfo(now, 30).baselineStart).toBe('2026-08-02')
    // 同一窗口下两者有效天数不同 —— 混用会让功能矩阵与漏斗各说各话
    expect(tabViewBaselineInfo(now, 30).effectiveDays).not.toBe(flowBaselineInfo(now, 30).effectiveDays)
  })
})
