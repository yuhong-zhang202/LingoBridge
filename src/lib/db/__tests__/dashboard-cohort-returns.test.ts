/**
 * @module   db/dashboard-cohort-returns.test
 * @desc     看板 cohort 回访聚合的口径守卫（方案 §四）：
 *           aggregateCohortReturns —— 剔 QA / 剔内部账户（分母与回访信号两侧）、东八区日界、
 *           「待满 1 天」判定（严格到边界日）、注册当天活动不算「回来」、人数去重、空日合并计数。
 *           纯函数直测，不碰真实 DB。变异自查：断言精确到分子/分母与排序，改坏任一口径会红。
 *
 *   【2026-08-15】原同文件还守着 aggregatePageViews（「哪些页面被用得多」）。该聚合的界面消费者
 *   PageActivityList 已于 2026-08-14 从看板摘除，本次连同 fetchPageViewStats 与 route 字段整链删除，
 *   故那一组用例一并移除 —— 删的是【守卫的对象已不存在】，不是守卫标准放松。
 * @author   LingoBridge
 * @created  2026-08-04
 */
jest.mock('server-only', () => ({}))

import {
  aggregateCohortReturns,
  type CohortRegUser, type CohortFlowRow,
} from '@/lib/db/dashboard-metrics'
import { INTERNAL_ACCOUNT_IDS } from '@/lib/internal-accounts'

/** 名册里真实存在的内部账户 id（口径测试必须用真名册，不 mock —— 防名册与判定脱钩） */
const INTERNAL_ID = [...INTERNAL_ACCOUNT_IDS][0]

// 「现在」固定为东八区 2026-08-04 21:00（= UTC 08-04 13:00），日界测试全部围绕它展开
const NOW = new Date('2026-08-04T13:00:00.000Z')

/** 造一名注册用户：regIso 为注册时刻（UTC ISO） */
function reg(id: string, regIso: string): CohortRegUser {
  return { id, createdAt: regIso }
}

/** 造一行 flow_events 回访信号 */
function flow(userId: string | null, iso: string, isQa = false): CohortFlowRow {
  return { user_id: userId, created_at: iso, is_qa: isQa }
}

describe('aggregateCohortReturns', () => {
  it('基本口径：次日回来 = D+1 当天有事件；至今回来 = D+1 起任意一天；注册当天活动不算回来', () => {
    // 8/1（东八区）注册两人：A 只在注册当天活跃（不算回来）；B 在 8/2（次日）活跃
    const regs = [reg('user-a', '2026-08-01T02:00:00.000Z'), reg('user-b', '2026-08-01T03:00:00.000Z')]
    const flows = [
      flow('user-a', '2026-08-01T05:00:00.000Z'),   // A 注册当天 → 不算回来
      flow('user-b', '2026-08-02T01:00:00.000Z'),   // B 次日 → 次日回来 + 至今回来
    ]
    const out = aggregateCohortReturns(regs, flows, NOW)
    const day = out.days.find(d => d.dateLabel === '8/1')
    expect(day).toEqual({
      dateLabel: '8/1', registered: 2, d1Pending: false, d1Returned: 1, totalReturned: 1,
    })
  })

  it('至今回来可大于次日回来：隔天才回来的人计入至今、不计入次日', () => {
    const regs = [reg('user-c', '2026-08-01T02:00:00.000Z')]
    const flows = [flow('user-c', '2026-08-03T02:00:00.000Z')]   // D+2 才回来
    const day = aggregateCohortReturns(regs, flows, NOW).days.find(d => d.dateLabel === '8/1')
    expect(day?.d1Returned).toBe(0)
    expect(day?.totalReturned).toBe(1)
  })

  it('人数去重：同一人多条事件只算一个人', () => {
    const regs = [reg('user-d', '2026-08-01T02:00:00.000Z')]
    const flows = [
      flow('user-d', '2026-08-02T01:00:00.000Z'),
      flow('user-d', '2026-08-02T02:00:00.000Z'),
      flow('user-d', '2026-08-03T03:00:00.000Z'),
    ]
    const day = aggregateCohortReturns(regs, flows, NOW).days.find(d => d.dateLabel === '8/1')
    expect(day?.d1Returned).toBe(1)
    expect(day?.totalReturned).toBe(1)
  })

  it('剔 QA：is_qa=true 的事件不算回访信号', () => {
    const regs = [reg('user-e', '2026-08-01T02:00:00.000Z')]
    const flows = [flow('user-e', '2026-08-02T01:00:00.000Z', true)]
    const day = aggregateCohortReturns(regs, flows, NOW).days.find(d => d.dateLabel === '8/1')
    expect(day?.d1Returned).toBe(0)
    expect(day?.totalReturned).toBe(0)
  })

  it('剔内部账户：注册分母与回访信号两侧都剔', () => {
    // 内部账户注册 → 不进分母；该日只剩普通用户 1 人
    const regs = [reg(INTERNAL_ID, '2026-08-01T02:00:00.000Z'), reg('user-f', '2026-08-01T02:30:00.000Z')]
    const flows = [flow(INTERNAL_ID, '2026-08-02T01:00:00.000Z')]
    const day = aggregateCohortReturns(regs, flows, NOW).days.find(d => d.dateLabel === '8/1')
    expect(day?.registered).toBe(1)
    expect(day?.totalReturned).toBe(0)
  })

  it('东八区日界：UTC 8/1 17:00 = 东八区 8/2 01:00，注册归 8/2 组', () => {
    const regs = [reg('user-g', '2026-08-01T17:00:00.000Z')]
    const out = aggregateCohortReturns(regs, [], NOW)
    expect(out.days.find(d => d.dateLabel === '8/2')?.registered).toBe(1)
    expect(out.days.find(d => d.dateLabel === '8/1')).toBeUndefined()
  })

  it('待满 1 天：注册日为今天或昨天（东八区）→ d1Pending=true；前天 → false', () => {
    const regs = [
      reg('user-h', '2026-08-04T01:00:00.000Z'),   // 今天注册
      reg('user-i', '2026-08-03T01:00:00.000Z'),   // 昨天注册（D+1=今天，未过完）
      reg('user-j', '2026-08-02T01:00:00.000Z'),   // 前天注册（D+1=昨天，已过完）
    ]
    const out = aggregateCohortReturns(regs, [], NOW)
    expect(out.days.find(d => d.dateLabel === '8/4')?.d1Pending).toBe(true)
    expect(out.days.find(d => d.dateLabel === '8/3')?.d1Pending).toBe(true)
    expect(out.days.find(d => d.dateLabel === '8/2')?.d1Pending).toBe(false)
  })

  it('空日合并：无注册的日子不出行、计入 emptyDays；窗口外注册不进任何组', () => {
    const regs = [
      reg('user-k', '2026-08-01T02:00:00.000Z'),
      reg('user-l', '2026-07-20T02:00:00.000Z'),   // 窗口外（7 天前更早）
    ]
    const out = aggregateCohortReturns(regs, [], NOW)
    expect(out.days).toHaveLength(1)
    expect(out.emptyDays).toBe(6)
  })

  it('行序新到旧：晚注册的日子排前面', () => {
    const regs = [reg('user-m', '2026-08-01T02:00:00.000Z'), reg('user-n', '2026-08-03T02:00:00.000Z')]
    const out = aggregateCohortReturns(regs, [], NOW)
    expect(out.days.map(d => d.dateLabel)).toEqual(['8/3', '8/1'])
  })
})

/**
 * 【2026-08-15 新增】展示窗口跟随区间选择器。
 *
 *   改之前这块恒取 7 天，而所在的「谁留下了」区徽标写 `windowDays + 1`（7/15/31）——
 *   30 天档下同一区里「近 31 天」的徽标压着一张只有 7 天数据的表。产品方拍板让表跟区间走。
 *
 *   🔴 这组用例真正要钉死的不是「31 天能取到 31 天」，而是
 *     **用过的窗口天数必须随数据一起返回**（`displayDays`），供界面文案直接读。
 *     只要文案还能自己按 range 算一遍，那个「标签与数据各说各的」的 bug 就随时能复发。
 */
describe('aggregateCohortReturns · 展示窗口跟随区间', () => {
  it('不传 displayDays → 回落到 7 天（与改动前的固定口径逐字一致）', () => {
    const regs = [reg('user-p', '2026-08-01T02:00:00.000Z')]
    const out = aggregateCohortReturns(regs, [], NOW)
    expect(out.displayDays).toBe(7)
    expect(out.days).toHaveLength(1)
    expect(out.emptyDays).toBe(6)          // 7 天窗口里 1 天有注册、6 天没有
  })

  it('传 31（= 30 天档的 windowDays+1）→ 7 天窗口外的注册【进得来】', () => {
    const regs = [
      reg('user-q', '2026-08-01T02:00:00.000Z'),   // 7 天窗口内
      reg('user-r', '2026-07-20T02:00:00.000Z'),   // 7 天窗口外、31 天窗口内 —— 改之前会被整条丢弃
    ]
    const out7  = aggregateCohortReturns(regs, [], NOW, 7)
    const out31 = aggregateCohortReturns(regs, [], NOW, 31)
    expect(out7.days.map(d => d.dateLabel)).toEqual(['8/1'])
    expect(out31.days.map(d => d.dateLabel)).toEqual(['8/1', '7/20'])   // 新到旧
    expect(out31.displayDays).toBe(31)
  })

  it('emptyDays 跟着窗口一起变：有注册的天数不变时，窗口越大空日越多', () => {
    const regs = [reg('user-s', '2026-08-04T02:00:00.000Z')]  // 今天注册
    expect(aggregateCohortReturns(regs, [], NOW, 7).emptyDays).toBe(6)
    expect(aggregateCohortReturns(regs, [], NOW, 15).emptyDays).toBe(14)
    expect(aggregateCohortReturns(regs, [], NOW, 31).emptyDays).toBe(30)
  })

  it('三档区间下 有注册天数 + 空日 恒等于 displayDays（窗口不多算也不漏算一天）', () => {
    const regs = [
      reg('user-t', '2026-08-04T02:00:00.000Z'),
      reg('user-u', '2026-07-25T02:00:00.000Z'),
      reg('user-v', '2026-07-10T02:00:00.000Z'),
    ]
    for (const d of [7, 15, 31]) {
      const out = aggregateCohortReturns(regs, [], NOW, d)
      expect(out.days.length + out.emptyDays).toBe(d)
      expect(out.displayDays).toBe(d)
    }
  })

  it('窗口再大也不会把【未来】的注册算进来（上界仍是今天）', () => {
    const regs = [reg('user-w', '2026-08-06T02:00:00.000Z')]  // 东八区 8/6，晚于 NOW 的 8/4
    const out = aggregateCohortReturns(regs, [], NOW, 31)
    expect(out.days).toHaveLength(0)
    expect(out.emptyDays).toBe(31)
  })
})
