/**
 * @module   db/dashboard-growth-derive.test
 * @desc     产品增长指标批次（迁移 0064/0065）【RPC 派生层】的口径守卫：
 *           · growthWindowStart —— 东八区日界（跨界前后差整整一天）+「闭区间 N+1 天」这条口径本身；
 *           · deriveFunnel      —— 相邻转化率、掉幅最大一级（按人数、并列取靠前）、缺行按 0 补、负流失不参评；
 *           · deriveQuotaWall   —— 转化率/沉默率，分母为 0 时给 null 而不是 0；
 *           · deriveRetentionSeries / deriveStickiness —— 分子分母、除零、排序、date 串截取；
 *           · deriveUserSegments —— 长表按 kind 拆三块、占比分母、缺行按 0 补齐（某层为 0 必须占一行）；
 *           · deriveFeatureUsage —— 10 行恒在、人均次数、page.tab_view 起算日与偏差说明随响应下发；
 *           · 各 fetcher 的降级路径 —— RPC 报错/抛异常一律返 null（route 据此标「降级中」）。
 *           纯函数直测 + mock 掉 supabase.rpc，【不碰真实 DB】。
 *           三档必测覆盖：空数据 / 单用户 / 跨时区边界。
 * @author   LingoBridge
 * @created  2026-08-14
 */
jest.mock('server-only', () => ({}))

import { growthWindowStart, ratePct, ratio2, toCount, GROWTH_EXCLUDE_IDS, TAB_VIEW_BASELINE_START } from '@/lib/db/dashboard-growth-shared'
import {
  deriveFunnel, deriveQuotaWall, fetchGrowthFunnel, fetchBrowseOnly, fetchQuotaWall,
  type FunnelStepRow, type QuotaWallRow,
} from '@/lib/db/dashboard-growth-funnel'
import {
  deriveRetentionSeries, deriveStickiness, deriveUserSegments,
  fetchRetentionSeries, fetchStickiness, fetchUserSegments,
  type RetentionSeriesRow, type StickinessRow, type UserSegmentRow,
} from '@/lib/db/dashboard-growth-cohorts'
import {
  deriveFeatureUsage, fetchFeatureUsage, TAB_VIEW_CAVEAT, type FeatureUsageRow,
} from '@/lib/db/dashboard-growth-usage'
import { INTERNAL_ACCOUNT_IDS } from '@/lib/internal-accounts'

/** 造一个只实现 rpc 的假 supabase（本文件只测 RPC 路径，不碰表查询） */
function rpcClient(impl: (name: string) => { data: unknown; error: { message: string } | null }) {
  return { rpc: (name: string) => Promise.resolve(impl(name)) } as never
}

// ══════════════════════════════════════════════════════════════════════════════
// 窗口口径（跨时区边界）
// ══════════════════════════════════════════════════════════════════════════════

describe('growthWindowStart · 东八区日界与「闭区间 N+1 天」口径', () => {
  it('跨时区边界：UTC 15:59:59 与 16:00:00 只差一秒，窗口起点差整整一天', () => {
    // UTC 2026-08-14T15:59:59Z = 东八区 08-14 23:59:59（还是 14 号）
    const before = growthWindowStart(new Date('2026-08-14T15:59:59.000Z'), 7)
    // UTC 2026-08-14T16:00:00Z = 东八区 08-15 00:00:00（已经是 15 号）
    const after = growthWindowStart(new Date('2026-08-14T16:00:00.000Z'), 7)
    expect(before.toISOString()).toBe('2026-08-06T16:00:00.000Z')
    expect(after.toISOString()).toBe('2026-08-07T16:00:00.000Z')
    expect(after.getTime() - before.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('窗口是闭区间 [今日-N, 今日]，实际覆盖 N+1 个东八区日历日（与主看板差一天，刻意如此）', () => {
    // 东八区 2026-08-15 10:00 = UTC 08-15T02:00Z
    const now = new Date('2026-08-15T02:00:00.000Z')
    const start = growthWindowStart(now, 7)
    // 起点应是东八区 08-08 00:00 = UTC 08-07T16:00Z ⇒ 覆盖 08-08 … 08-15 共 8 天 = 7+1
    expect(start.toISOString()).toBe('2026-08-07T16:00:00.000Z')
    const hkStartDay = new Date(start.getTime() + 8 * 3600 * 1000).getUTCDate()
    const hkToday = new Date(now.getTime() + 8 * 3600 * 1000).getUTCDate()
    expect(hkToday - hkStartDay).toBe(7)
  })

  it('30 天窗口同口径（不是 29 天）', () => {
    const start = growthWindowStart(new Date('2026-08-15T02:00:00.000Z'), 30)
    expect(start.toISOString()).toBe('2026-07-15T16:00:00.000Z')
  })
})

describe('比率工具 · 分母为 0 一律 null（诚实占位，绝不返回 0）', () => {
  it('ratePct / ratio2 在分母为 0 时返回 null，正常时按位数四舍五入', () => {
    expect(ratePct(1, 0)).toBeNull()
    expect(ratio2(1, 0)).toBeNull()
    expect(ratePct(1, 3)).toBe(33.3)
    expect(ratio2(1, 3)).toBe(0.33)
  })

  it('toCount 兜住 PostgREST 的字符串数值与非法值', () => {
    expect(toCount('12')).toBe(12)
    expect(toCount(null)).toBe(0)
    expect(toCount('abc')).toBe(0)
  })

  it('内部账户名册直接来自唯一真源，不在本批次另抄一份', () => {
    expect(GROWTH_EXCLUDE_IDS).toEqual([...INTERNAL_ACCOUNT_IDS])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// A · 七步主线漏斗
// ══════════════════════════════════════════════════════════════════════════════

/** 造一行 RPC 漏斗返回 */
function step(i: number, key: string, users: number): FunnelStepRow {
  return { step_index: i, step_key: key, users }
}

const FULL_KEYS = ['signup', 'story_told', 'corpus_built', 'matched', 'question_opened', 'practice_started', 'feedback_card']

describe('deriveFunnel', () => {
  it('空数据：RPC 返回 0 行也给满 7 步、全 0、转化率全 null、掉幅最大为 null', () => {
    const out = deriveFunnel([])
    expect(out.steps).toHaveLength(7)
    expect(out.steps.map(s => s.key)).toEqual(FULL_KEYS)
    expect(out.steps.every(s => s.users === 0)).toBe(true)
    // 第 1 步没有上一步；其余步上一步是 0 人 ⇒ 转化率 null（不是 0%，两者含义相反）
    expect(out.steps.map(s => s.convFromPrev)).toEqual([null, null, null, null, null, null, null])
    expect(out.biggestDropIndex).toBeNull()
  })

  it('单用户走完全程：每步 1 人、相邻转化率恒 100%、没有任何一级在掉 ⇒ 掉幅最大为 null', () => {
    const out = deriveFunnel(FULL_KEYS.map((k, i) => step(i + 1, k, 1)))
    expect(out.steps.map(s => s.users)).toEqual([1, 1, 1, 1, 1, 1, 1])
    expect(out.steps.slice(1).every(s => s.convFromPrev === 100)).toBe(true)
    expect(out.steps.slice(1).every(s => s.lostFromPrev === 0)).toBe(true)
    expect(out.biggestDropIndex).toBeNull()
  })

  it('掉幅最大按【人数】而不是百分比：10→2（掉 8 人、80%）胜过 3→0（掉 3 人、100%）', () => {
    const out = deriveFunnel([
      step(1, 'signup', 20), step(2, 'story_told', 10), step(3, 'corpus_built', 2),
      step(4, 'matched', 2), step(5, 'question_opened', 2), step(6, 'practice_started', 3),
      step(7, 'feedback_card', 0),
    ])
    // 各级流失：10 / 8 / 0 / 0 / -1 / 3 ⇒ 最大是第 2 步那一级（掉 10 人）
    expect(out.biggestDropIndex).toBe(2)
    expect(out.steps[1].lostFromPrev).toBe(10)
    expect(out.steps[1].convFromPrev).toBe(50)
  })

  it('并列时取靠前那一级（越靠前的漏损影响后面所有步）', () => {
    const out = deriveFunnel([
      step(1, 'signup', 10), step(2, 'story_told', 5), step(3, 'corpus_built', 5),
      step(4, 'matched', 0), step(5, 'question_opened', 0), step(6, 'practice_started', 0),
      step(7, 'feedback_card', 0),
    ])
    // 第 2 步掉 5、第 4 步也掉 5 ⇒ 取靠前的 2
    expect(out.biggestDropIndex).toBe(2)
  })

  it('本步人数反超上一步（负流失）不参与掉幅评选，也不被"修正"成 0', () => {
    const out = deriveFunnel([
      step(1, 'signup', 1), step(2, 'story_told', 5), step(3, 'corpus_built', 5),
      step(4, 'matched', 5), step(5, 'question_opened', 5), step(6, 'practice_started', 5),
      step(7, 'feedback_card', 5),
    ])
    expect(out.steps[1].lostFromPrev).toBe(-4)
    expect(out.steps[1].convFromPrev).toBe(500)
    expect(out.biggestDropIndex).toBeNull()
  })

  it('缺行按 0 补齐且不错位：RPC 只回第 1、7 步时，中间五步仍在原位', () => {
    const out = deriveFunnel([step(7, 'feedback_card', 3), step(1, 'signup', 9)])
    expect(out.steps.map(s => s.users)).toEqual([9, 0, 0, 0, 0, 0, 3])
    expect(out.steps.map(s => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(out.steps[0].label).toBe('建号')
  })

  it('PostgREST 把计数回成字符串时照常算（numeric/bigint 保精度的常见形态）', () => {
    const out = deriveFunnel([{ step_index: '1', step_key: 'signup', users: '4' }])
    expect(out.steps[0].users).toBe(4)
  })
})

describe('fetchGrowthFunnel · 降级路径', () => {
  it('RPC 报错 → null（route 据此置 funnelPending、前端标「降级中」）', async () => {
    expect(await fetchGrowthFunnel(rpcClient(() => ({ data: null, error: { message: 'x' } })), 7)).toBeNull()
  })

  it('RPC 抛异常（迁移未跑等）→ null，绝不冒泡拖垮整条 route', async () => {
    const boom = { rpc: () => { throw new Error('function does not exist') } } as never
    expect(await fetchGrowthFunnel(boom, 7)).toBeNull()
  })

  it('happy path：按名传参（窗口天数 + 内部账户名册），并派生出七步', async () => {
    let seen: unknown = null
    const client = {
      rpc: (_n: string, args: unknown) => { seen = args; return Promise.resolve({ data: [step(1, 'signup', 2)], error: null }) },
    } as never
    const out = await fetchGrowthFunnel(client, 14)
    expect(seen).toEqual({ p_window_days: 14, p_exclude_user_ids: GROWTH_EXCLUDE_IDS })
    expect(out?.steps[0].users).toBe(2)
  })
})

describe('fetchBrowseOnly · 三个数一起给（集合差不是两个人数相减）', () => {
  it('happy path：三个字段逐一映射', async () => {
    const client = rpcClient(() => ({
      data: [{ page_view_users: 9, core_active_users: 4, browse_only_users: 6 }], error: null,
    }))
    // 6 ≠ 9-4：真集合差可以不等于两数之差（有人核心活跃却没发出 page.view），这正是必须三个都给的理由
    expect(await fetchBrowseOnly(client, 7)).toEqual({
      pageViewUsers: 9, coreActiveUsers: 4, browseOnlyUsers: 6,
    })
  })

  it('RPC 报错 → null', async () => {
    expect(await fetchBrowseOnly(rpcClient(() => ({ data: null, error: { message: 'x' } })), 7)).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// C · 额度墙
// ══════════════════════════════════════════════════════════════════════════════

describe('deriveQuotaWall', () => {
  it('空数据：撞墙 0 人时两个率都是 null（不是 0% —— 0% 会被读成"一个都没转化"）', () => {
    const row: QuotaWallRow = { wall_users: 0, converted_users: 0, silent_users: 0, mature_users: 0 }
    expect(deriveQuotaWall(row)).toEqual({
      wallUsers: 0, convertedUsers: 0, silentUsers: 0, matureUsers: 0,
      conversionRate: null, silentRate: null,
    })
  })

  it('单用户：1 人撞墙且转化 ⇒ 转化率 100%、沉默率 0%（0 在这里是真的 0，有分母）', () => {
    const out = deriveQuotaWall({ wall_users: 1, converted_users: 1, silent_users: 0, mature_users: 1 })
    expect(out.conversionRate).toBe(100)
    expect(out.silentRate).toBe(0)
  })

  it('观察期未满的人照样进分母（口径锁死），matureUsers 单独给出来供前端提示', () => {
    const out = deriveQuotaWall({ wall_users: 10, converted_users: 2, silent_users: 5, mature_users: 3 })
    expect(out.conversionRate).toBe(20)
    expect(out.silentRate).toBe(50)
    // 10 个人里只有 3 个走完了 7×24h 观察期 ⇒ 上面两个率都还没定型
    expect(out.matureUsers).toBe(3)
  })
})

describe('fetchQuotaWall · 撞墙窗口锁死 30 天、不接受 range', () => {
  it('只传内部账户名册，不传窗口参数（传了就是改口径）', async () => {
    let seen: unknown = null
    const client = {
      rpc: (_n: string, args: unknown) => {
        seen = args
        return Promise.resolve({ data: [{ wall_users: 2, converted_users: 1, silent_users: 1, mature_users: 2 }], error: null })
      },
    } as never
    await fetchQuotaWall(client)
    expect(seen).toEqual({ p_exclude_user_ids: GROWTH_EXCLUDE_IDS })
  })

  it('RPC 报错 → null', async () => {
    expect(await fetchQuotaWall(rpcClient(() => ({ data: null, error: { message: 'x' } })))).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// D · W1 留存曲线
// ══════════════════════════════════════════════════════════════════════════════

describe('deriveRetentionSeries', () => {
  it('空数据：0 行返回空数组（≠ 降级，前端必须与"读不到数"分开显示）', () => {
    expect(deriveRetentionSeries([])).toEqual([])
  })

  it('单用户群组：分子分母都给出来（1/1 = 100%，但 n=1 时百分比是假精度，故 n 必须可见）', () => {
    const rows: RetentionSeriesRow[] = [{ week_start: '2026-08-03', cohort_n: 1, returned_n: 1 }]
    expect(deriveRetentionSeries(rows)).toEqual([
      { weekStart: '2026-08-03', cohortN: 1, returnedN: 1, rate: 100 },
    ])
  })

  it('分母为 0 的周给 null 而不是 0%，并按周升序排序、date 串截前 10 位', () => {
    const rows: RetentionSeriesRow[] = [
      { week_start: '2026-08-10T00:00:00', cohort_n: 4, returned_n: 1 },
      { week_start: '2026-08-03', cohort_n: 0, returned_n: 0 },
    ]
    expect(deriveRetentionSeries(rows)).toEqual([
      { weekStart: '2026-08-03', cohortN: 0, returnedN: 0, rate: null },
      { weekStart: '2026-08-10', cohortN: 4, returnedN: 1, rate: 25 },
    ])
  })
})

describe('fetchRetentionSeries · 降级路径', () => {
  it('RPC 报错 → null；返回 0 行 → 空数组（两者语义不同，绝不合并）', async () => {
    expect(await fetchRetentionSeries(rpcClient(() => ({ data: null, error: { message: 'x' } })), 7)).toBeNull()
    expect(await fetchRetentionSeries(rpcClient(() => ({ data: [], error: null })), 7)).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// E · 粘性比 DAU/MAU
// ══════════════════════════════════════════════════════════════════════════════

describe('deriveStickiness', () => {
  it('空数据：空数组', () => {
    expect(deriveStickiness([])).toEqual([])
  })

  it('单用户：DAU=1 / MAU=1 ⇒ 比值 1；MAU=0 的那天比值给 null 而不是 0', () => {
    const rows: StickinessRow[] = [
      { day: '2026-08-14', dau: 1, mau: 1 },
      { day: '2026-08-13', dau: 0, mau: 0 },
    ]
    expect(deriveStickiness(rows)).toEqual([
      { day: '2026-08-13', dau: 0, mau: 0, ratio: null },
      { day: '2026-08-14', dau: 1, mau: 1, ratio: 1 },
    ])
  })

  it('比值保留 2 位小数（3/7 → 0.43）', () => {
    expect(deriveStickiness([{ day: '2026-08-14', dau: 3, mau: 7 }])[0].ratio).toBe(0.43)
  })
})

describe('fetchStickiness · 降级路径', () => {
  it('RPC 报错 → null', async () => {
    expect(await fetchStickiness(rpcClient(() => ({ data: null, error: { message: 'x' } })), 7)).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// F · 用户分层
// ══════════════════════════════════════════════════════════════════════════════

/** 造一行分层长表 */
function seg(kind: string, segment: string, users: number, w1n: number | null = null, w1r: number | null = null): UserSegmentRow {
  return { kind, segment, users, w1_n: w1n, w1_ret: w1r }
}

describe('deriveUserSegments', () => {
  it('空数据：四层与三档拆分恒在、全 0、占比全 null（某层为 0 必须占一行才谈得上被看见）', () => {
    const out = deriveUserSegments([])
    expect(out.segments.map(s => s.key)).toEqual(['qbank_only', 'ai_only', 'both', 'high_freq'])
    expect(out.coreSplit.map(s => s.key)).toEqual(['mainline', 'review_only', 'both_signals'])
    expect(out.segmentBase).toBe(0)
    expect(out.coreActive).toBe(0)
    expect(out.segments.every(s => s.users === 0 && s.share === null && s.w1Rate === null)).toBe(true)
  })

  it('单用户：一个只讲故事的人 ⇒ ai_only 1 人、占比 100%、W1 分母 1 分子 0', () => {
    const out = deriveUserSegments([
      seg('total', 'segment_base', 1), seg('total', 'core_active', 1),
      seg('segment', 'ai_only', 1, 1, 0),
      seg('core_split', 'mainline', 1),
    ])
    const aiOnly = out.segments.find(s => s.key === 'ai_only')
    expect(aiOnly).toEqual({
      key: 'ai_only', label: '仅 AI 主线', users: 1, share: 100, w1N: 1, w1Ret: 0, w1Rate: 0,
    })
    expect(out.coreSplit.find(s => s.key === 'mainline')?.share).toBe(100)
  })

  it('高频层与前三层正交：四层人数之和可以大于分母，占比之和可以超过 100%（不是 bug）', () => {
    const out = deriveUserSegments([
      seg('total', 'segment_base', 10), seg('total', 'core_active', 10),
      seg('segment', 'qbank_only', 3, 3, 1),
      seg('segment', 'ai_only', 5, 4, 2),
      seg('segment', 'both', 2, 2, 2),
      seg('segment', 'high_freq', 6, 5, 3),
    ])
    const sum = out.segments.reduce((s, x) => s + x.users, 0)
    expect(sum).toBe(16)
    expect(out.segmentBase).toBe(10)
    expect(out.segments.find(s => s.key === 'high_freq')?.share).toBe(60)
    // 每层 W1 的分母必然 ≤ 该层人数（未满 7 天观察期的人不进分母），分子分母都要给
    expect(out.segments.find(s => s.key === 'ai_only')).toMatchObject({ users: 5, w1N: 4, w1Ret: 2, w1Rate: 50 })
  })

  it('核心活跃拆分三档互斥、其和等于 coreActive，占比按 coreActive 算', () => {
    const out = deriveUserSegments([
      seg('total', 'segment_base', 8), seg('total', 'core_active', 4),
      seg('core_split', 'mainline', 1),
      seg('core_split', 'review_only', 2),
      seg('core_split', 'both_signals', 1),
    ])
    expect(out.coreSplit.reduce((s, x) => s + x.users, 0)).toBe(out.coreActive)
    expect(out.coreSplit.map(s => s.share)).toEqual([25, 50, 25])
  })
})

describe('fetchUserSegments · 降级路径', () => {
  it('RPC 报错 / 返回 0 行 → null（分层表恒有分母行，0 行只可能是没读到）', async () => {
    expect(await fetchUserSegments(rpcClient(() => ({ data: null, error: { message: 'x' } })), 7)).toBeNull()
    expect(await fetchUserSegments(rpcClient(() => ({ data: [], error: null })), 7)).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// G · 功能使用矩阵
// ══════════════════════════════════════════════════════════════════════════════

describe('deriveFeatureUsage', () => {
  it('空数据：10 行恒在、全 0、人均 null，且起算日与偏差说明随响应下发', () => {
    const out = deriveFeatureUsage([])
    expect(out.rows).toHaveLength(10)
    expect(out.rows.map(r => r.key)).toEqual([
      'story', 'match', 'analysis', 'practice',
      'lib_stories', 'lib_cards', 'lib_words', 'lib_pron', 'review', 'qbank',
    ])
    expect(out.rows.every(r => r.users === 0 && r.uses === 0 && r.perUser === null)).toBe(true)
    expect(out.tabViewBaselineStart).toBe(TAB_VIEW_BASELINE_START)
    expect(out.tabViewCaveat).toBe(TAB_VIEW_CAVEAT)
  })

  it('依赖 page.tab_view 的五行被标出来（上线前必然为 0，不是"没人用"）', () => {
    const out = deriveFeatureUsage([])
    expect(out.rows.filter(r => r.tabViewBased).map(r => r.key))
      .toEqual(['lib_stories', 'lib_cards', 'lib_words', 'lib_pron', 'qbank'])
  })

  it('单用户：1 人用了 3 次 ⇒ 人均 3；分组与中文名正确', () => {
    const rows: FeatureUsageRow[] = [{ feature_key: 'story', users: 1, uses: 3 }]
    const story = deriveFeatureUsage(rows).rows.find(r => r.key === 'story')
    expect(story).toEqual({
      key: 'story', label: '讲故事', group: '主线', users: 1, uses: 3, perUser: 3, tabViewBased: false,
    })
  })

  it('人均次数保留 2 位小数，users=0 而 uses>0 时给 null（无归属行只计次数、不计人）', () => {
    const out = deriveFeatureUsage([
      { feature_key: 'match', users: 3, uses: 10 },
      { feature_key: 'qbank', users: 0, uses: 2 },
    ])
    expect(out.rows.find(r => r.key === 'match')?.perUser).toBe(3.33)
    expect(out.rows.find(r => r.key === 'qbank')?.perUser).toBeNull()
  })
})

describe('fetchFeatureUsage · 降级路径', () => {
  it('RPC 报错 / 返回 0 行 → null（矩阵恒有 10 行，0 行只可能是没读到）', async () => {
    expect(await fetchFeatureUsage(rpcClient(() => ({ data: null, error: { message: 'x' } })), 7)).toBeNull()
    expect(await fetchFeatureUsage(rpcClient(() => ({ data: [], error: null })), 7)).toBeNull()
  })
})
