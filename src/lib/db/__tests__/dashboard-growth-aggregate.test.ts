/**
 * @module   db/dashboard-growth-aggregate.test
 * @desc     产品增长指标批次【表级纯聚合】的口径守卫：
 *           · aggregateFunnelQuality —— 剔 QA / 剔内部账户、noMatch 计数与占比、candidateCount 求和、
 *             dwellMs【中位数】（含 dwellMs=0 是合法值）、反馈卡人均与「0 卡人数」的按人合计口径、
 *             无归属行计次不计人；
 *           · aggregateFailureImpact —— 只数系统故障（与既有错误率同判据）、按环节分组、
 *             去重影响用户数、跨环节去重的总人数 ≠ 各环节相加、无归属失败进 unattributed；
 *           · 两个 fetcher 的取数边界 —— 东八区窗口起点（跨时区边界差整整一天）、
 *             两个排除过滤逐条套上、查询失败降级返 null。
 *           纯函数直测 + 假查询构建器，【不碰真实 DB】。三档必测覆盖：空数据 / 单用户 / 跨时区边界。
 * @author   LingoBridge
 * @created  2026-08-14
 */
jest.mock('server-only', () => ({}))

import {
  aggregateFunnelQuality, fetchFunnelQuality, QUALITY_EVENTS, type QualityEventRow,
} from '@/lib/db/dashboard-growth-funnel'
import {
  aggregateFailureImpact, fetchFailureImpact, type FailureImpactRow,
} from '@/lib/db/dashboard-growth-usage'
import { INTERNAL_ACCOUNT_IDS } from '@/lib/internal-accounts'

/** 名册里真实存在的内部账户 id（口径测试必须用真名册，不 mock —— 防名册与判定脱钩） */
const INTERNAL_ID = [...INTERNAL_ACCOUNT_IDS][0]
const U1 = 'user-1'
const U2 = 'user-2'

/** 造一行匹配渲染事件 */
function rendered(props: Record<string, unknown>, userId: string | null = U1, isQa = false): QualityEventRow {
  return { event: 'match.view_rendered', props, is_qa: isQa, user_id: userId }
}
/** 造一行点开题目事件 */
function openedRow(props: Record<string, unknown>, userId: string | null = U1, isQa = false): QualityEventRow {
  return { event: 'match.question_opened', props, is_qa: isQa, user_id: userId }
}
/** 造一行练习结束事件 */
function ended(polishedCount: number | undefined, userId: string | null = U1, isQa = false): QualityEventRow {
  return {
    event: 'flow.practice_ended',
    props: polishedCount === undefined ? {} : { polishedCount },
    is_qa: isQa,
    user_id: userId,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// B · 漏斗质量注脚
// ══════════════════════════════════════════════════════════════════════════════

describe('aggregateFunnelQuality', () => {
  it('空数据：全 0，且三个比率/中位数一律 null（0% 与"没有样本"含义相反，绝不混）', () => {
    expect(aggregateFunnelQuality([])).toEqual({
      match: { rendered: 0, noMatch: 0, noMatchRate: null },
      question: { candidateTotal: 0, opened: 0, dwellMedianMs: null },
      feedback: { endedUsers: 0, cardTotal: 0, cardsPerUser: null, zeroCardUsers: 0 },
    })
  })

  it('单用户走一遍：匹配 1 次出 3 道题、点开 1 道停留 5s、练完攒 2 张卡', () => {
    const out = aggregateFunnelQuality([
      rendered({ candidateCount: 3 }),
      openedRow({ dwellMs: 5000 }),
      ended(2),
    ])
    expect(out.match).toEqual({ rendered: 1, noMatch: 0, noMatchRate: 0 })
    expect(out.question).toEqual({ candidateTotal: 3, opened: 1, dwellMedianMs: 5000 })
    expect(out.feedback).toEqual({ endedUsers: 1, cardTotal: 2, cardsPerUser: 2, zeroCardUsers: 0 })
  })

  it('noMatch 口径：props 里没带 noMatch 的行算"匹配上了"（与 SQL 的 is distinct from 同义）', () => {
    const out = aggregateFunnelQuality([
      rendered({ candidateCount: 2 }),               // 没带 noMatch ⇒ 匹配上了
      rendered({ noMatch: false, candidateCount: 1 }),
      rendered({ noMatch: true }),                   // 真的没匹配上
      rendered({ noMatch: true }),
    ])
    expect(out.match).toEqual({ rendered: 4, noMatch: 2, noMatchRate: 50 })
    // noMatch 的行没有 candidateCount，求和时按 0 计（不是丢掉整行）
    expect(out.question.candidateTotal).toBe(3)
  })

  it('剔 QA 与内部账户：两类行完全不进任何计数', () => {
    const out = aggregateFunnelQuality([
      rendered({ candidateCount: 5 }, U1, true),          // QA
      rendered({ candidateCount: 7 }, INTERNAL_ID),       // 内部账户
      openedRow({ dwellMs: 1 }, U1, true),
      ended(9, INTERNAL_ID),
      rendered({ candidateCount: 2 }, U1),                // 唯一该被算进去的行
    ])
    expect(out.match.rendered).toBe(1)
    expect(out.question).toEqual({ candidateTotal: 2, opened: 0, dwellMedianMs: null })
    expect(out.feedback.endedUsers).toBe(0)
  })

  it('停留时长用【中位数】不用均值：一个 30 分钟的离群样本不该把它拉走', () => {
    const out = aggregateFunnelQuality([
      openedRow({ dwellMs: 1000 }), openedRow({ dwellMs: 2000 }), openedRow({ dwellMs: 1800000 }),
    ])
    expect(out.question.dwellMedianMs).toBe(2000)
  })

  it('偶数个样本取中间两个的均值；dwellMs=0 是合法值（一眼即点），不可当缺失丢掉', () => {
    const out = aggregateFunnelQuality([
      openedRow({ dwellMs: 0 }), openedRow({ dwellMs: 1000 }),
      openedRow({ dwellMs: 3000 }), openedRow({ dwellMs: 5000 }),
    ])
    expect(out.question.opened).toBe(4)
    expect(out.question.dwellMedianMs).toBe(2000)
  })

  it('没带 dwellMs 的点开行照常计次数，只是不进中位数样本', () => {
    const out = aggregateFunnelQuality([openedRow({}), openedRow({ dwellMs: 700 })])
    expect(out.question.opened).toBe(2)
    expect(out.question.dwellMedianMs).toBe(700)
  })

  it('0 卡人数按【人】合计，不是按场次：一场 0 卡、另一场 2 卡的人不算 0 卡', () => {
    const out = aggregateFunnelQuality([
      ended(0, U1), ended(2, U1),   // U1 合计 2 张 ⇒ 不是 0 卡
      ended(0, U2), ended(0, U2),   // U2 合计 0 张 ⇒ 0 卡
    ])
    expect(out.feedback).toEqual({ endedUsers: 2, cardTotal: 2, cardsPerUser: 1, zeroCardUsers: 1 })
  })

  it('缺 polishedCount 的行按 0 卡计（字段静默消失时不能假装用户攒到了卡）', () => {
    const out = aggregateFunnelQuality([ended(undefined, U1)])
    expect(out.feedback).toEqual({ endedUsers: 1, cardTotal: 0, cardsPerUser: 0, zeroCardUsers: 1 })
  })

  it('无归属行：卡数计入总量（卡确实产生了），但不进人均的分母', () => {
    const out = aggregateFunnelQuality([ended(4, null), ended(2, U1)])
    expect(out.feedback.cardTotal).toBe(6)
    expect(out.feedback.endedUsers).toBe(1)
    expect(out.feedback.cardsPerUser).toBe(6)   // 方向已知：偏高
  })

  it('清单外的事件不参与任何计数（防将来加事件时被静默灌进某一格）', () => {
    const rows = [{ event: 'page.view', props: { route: 'home' }, is_qa: false, user_id: U1 }]
    expect(aggregateFunnelQuality(rows)).toEqual(aggregateFunnelQuality([]))
  })
})

// ── 取数边界（跨时区 + 过滤条件）────────────────────────────────────────────────

/** 假查询构建器：记下 select / in / gte / or / not / eq 的实参，range 返回固定行 */
function makeCapture(rows: unknown[], forceError: { message: string } | null = null) {
  const seen = {
    table: '', select: '', inEvents: [] as string[], gte: '', or: '', notArgs: [] as unknown[], eq: [] as string[],
  }
  const b: Record<string, unknown> = {}
  const self = () => b
  b.select = (cols: string) => { seen.select = cols; return b }
  b.in = (_c: string, v: string[]) => { seen.inEvents = v; return b }
  b.gte = (_c: string, v: string) => { seen.gte = v; return b }
  b.or = (v: string) => { seen.or = v; return b }
  b.not = (...args: unknown[]) => { seen.notArgs = args; return b }
  b.eq = (_c: string, v: string) => { seen.eq.push(v); return b }
  b.order = self
  b.range = (from: number, to: number) => ({
    then: (res: (r: { data: unknown[]; error: { message: string } | null }) => void) =>
      res({ data: forceError ? [] : rows.slice(from, to + 1), error: forceError }),
  })
  const client = { from: (t: string) => { seen.table = t; return b } } as never
  return { client, seen }
}

describe('fetchFunnelQuality · 取数边界', () => {
  it('跨时区边界：UTC 15:59:59 与 16:00:00 只差一秒，窗口起点差整整一天', async () => {
    const a = makeCapture([])
    await fetchFunnelQuality(a.client, 7, new Date('2026-08-14T15:59:59.000Z'))
    const b = makeCapture([])
    await fetchFunnelQuality(b.client, 7, new Date('2026-08-14T16:00:00.000Z'))
    expect(a.seen.gte).toBe('2026-08-06T16:00:00.000Z')
    expect(b.seen.gte).toBe('2026-08-07T16:00:00.000Z')
  })

  it('只取三类事件、只 select 四列（绝不 select *），表是 flow_events', async () => {
    const { client, seen } = makeCapture([])
    await fetchFunnelQuality(client, 7, new Date('2026-08-14T02:00:00.000Z'))
    expect(seen.table).toBe('flow_events')
    expect(seen.select).toBe('event, props, is_qa, user_id')
    expect(seen.inEvents).toEqual([...QUALITY_EVENTS])
  })

  it('查询报错 → null（route 据此置 qualityPending、前端标「降级中」）', async () => {
    const { client } = makeCapture([], { message: 'boom' })
    expect(await fetchFunnelQuality(client, 7, new Date('2026-08-14T02:00:00.000Z'))).toBeNull()
  })

  it('happy path：聚合结果透传，并带上 truncated=false', async () => {
    const { client } = makeCapture([rendered({ candidateCount: 2 }), ended(1)])
    const out = await fetchFunnelQuality(client, 7, new Date('2026-08-14T02:00:00.000Z'))
    expect(out?.match.rendered).toBe(1)
    expect(out?.feedback.cardTotal).toBe(1)
    expect(out?.truncated).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// H · 每类故障的去重影响用户数
// ══════════════════════════════════════════════════════════════════════════════

/** 造一行失败日志 */
function fail(
  phase: string | undefined,
  userId: string | null,
  extraMeta: Record<string, unknown> = {},
  service = 'qwen_plus',
): FailureImpactRow {
  return {
    status: 'error',
    service,
    metadata: { ...(phase ? { phase } : {}), ...extraMeta } as FailureImpactRow['metadata'],
    user_id: userId,
  }
}

describe('aggregateFailureImpact', () => {
  it('空数据：空表、两个总数都是 0', () => {
    expect(aggregateFailureImpact([])).toEqual({ byPhase: [], totalFailures: 0, totalAffectedUsers: 0 })
  })

  it('单用户：一个人在一个环节踩了 2 次故障 ⇒ 2 次 / 1 人', () => {
    const out = aggregateFailureImpact([fail('coach', U1), fail('coach', U1)])
    expect(out.byPhase).toEqual([{ phase: '教练对话', failures: 2, affectedUsers: 1, unattributed: 0 }])
    expect(out.totalFailures).toBe(2)
    expect(out.totalAffectedUsers).toBe(1)
  })

  it('只数系统故障：用户输入 / 容量繁忙 / 网络中断三类被摘出（与既有错误率同判据）', () => {
    const out = aggregateFailureImpact([
      fail('transcribe', U1, { error_kind: 'user_input' }),
      fail('transcribe', U1, { error_kind: 'capacity' }),
      fail('transcribe', U1, { error_kind: 'network' }),
      fail('transcribe', U1),   // 无 kind、无 code ⇒ 真·系统故障
    ])
    expect(out.totalFailures).toBe(1)
    expect(out.byPhase).toEqual([{ phase: '语音转写', failures: 1, affectedUsers: 1, unattributed: 0 }])
  })

  it('老失败行按 error_code 重算 kind（ECONNRESET 是网络中断，不算系统故障）', () => {
    const out = aggregateFailureImpact([fail('coach', U1, { error_code: 'ECONNRESET' })])
    expect(out.totalFailures).toBe(0)
  })

  it('status 非 error 的行一律不计（成功行混进来也不会污染）', () => {
    const rows: FailureImpactRow[] = [{ status: 'success', service: 'qwen_plus', metadata: { phase: 'coach' }, user_id: U1 }]
    expect(aggregateFailureImpact(rows).totalFailures).toBe(0)
  })

  it('跨环节去重：同一人在两个环节各踩一次 ⇒ 各环节 1 人，总影响人数仍是 1（列相加≠总数）', () => {
    const out = aggregateFailureImpact([fail('coach', U1), fail('analysis', U1)])
    expect(out.byPhase.map(p => p.affectedUsers)).toEqual([1, 1])
    expect(out.totalAffectedUsers).toBe(1)
    expect(out.totalFailures).toBe(2)
  })

  it('无归属失败进 unattributed：计次数、不计人数（affectedUsers 因此系统性偏低）', () => {
    const out = aggregateFailureImpact([fail('coach', null), fail('coach', null), fail('coach', U1)])
    expect(out.byPhase).toEqual([{ phase: '教练对话', failures: 3, affectedUsers: 1, unattributed: 2 }])
    expect(out.totalAffectedUsers).toBe(1)
  })

  it('缺 phase 的豆包行归「语音转写」——与 resolvePhase 同源（2026-08-15 修正后的口径）', () => {
    // 【本断言的历史，别改回去】原实现里 todayPhaseName 直接读 metadata.phase，不认 resolvePhase
    // 那条「豆包 ASR 行缺 phase 即视为 transcribe」的规则，于是同一批行在看板两处显示成两个桶名：
    // 这里是 '豆包 ASR'（SERVICE_META 服务名兜底），别处是 '语音转写'。
    // 写本用例的人当时按红线只报不改，注释原话是「此处断言的是【既有行为】，不是我认为它该有的
    // 行为」——本次（2026-08-15）把 todayPhaseName 改为复用 resolvePhase，两侧就此同源，
    // 故断言随之更新为 '语音转写'。**这是兑现那条记下的债，不是放宽守卫让改动通过。**
    // ⚠️ 只改展示名归属，计数口径与阈值一字未动。
    const out = aggregateFailureImpact([fail(undefined, U1, {}, 'doubao_asr')])
    expect(out.byPhase[0].phase).toBe('语音转写')
  })

  it('非豆包且缺 phase 的行仍按 service 名兜底（不落进生 key 的保底没被改掉）', () => {
    const out = aggregateFailureImpact([fail(undefined, U1, {}, 'qwen_plus')])
    expect(out.byPhase[0].phase).not.toBe('')
    expect(out.byPhase[0].phase).not.toBe('qwen_plus')
  })

  it('排序：影响用户数降序 → 失败次数降序 → 环节名字典序（顺序稳定，打开看板位置不跳）', () => {
    const out = aggregateFailureImpact([
      fail('coach', U1), fail('coach', U2),                     // 2 人 2 次
      fail('analysis', U1), fail('analysis', U1), fail('analysis', U1), // 1 人 3 次
      fail('phrases', U2),                                      // 1 人 1 次
    ])
    expect(out.byPhase.map(p => p.phase)).toEqual(['教练对话', '侧重点分析', '词组生成'])
    expect(out.totalAffectedUsers).toBe(2)
  })
})

describe('fetchFailureImpact · 取数边界', () => {
  it('跨时区边界：UTC 15:59:59 与 16:00:00 只差一秒，窗口起点差整整一天', async () => {
    const a = makeCapture([])
    await fetchFailureImpact(a.client, 7, new Date('2026-08-14T15:59:59.000Z'))
    const b = makeCapture([])
    await fetchFailureImpact(b.client, 7, new Date('2026-08-14T16:00:00.000Z'))
    expect(a.seen.gte).toBe('2026-08-06T16:00:00.000Z')
    expect(b.seen.gte).toBe('2026-08-07T16:00:00.000Z')
  })

  it('两个排除过滤逐条套上：内部账户（保留 null 行）+ QA 自测流量（is_qa IS NOT TRUE）', async () => {
    const { client, seen } = makeCapture([])
    await fetchFailureImpact(client, 7, new Date('2026-08-14T02:00:00.000Z'))
    expect(seen.table).toBe('api_usage_logs')
    // 内部账户过滤必须保留 user_id 为 null 的行（NULL NOT IN 求值为 NULL 会误删正常行）
    expect(seen.or).toContain('user_id.is.null')
    expect(seen.or).toContain('user_id.not.in.')
    // QA 过滤走 not(is_qa, is, true) ⇒ SQL `is_qa IS NOT TRUE`，NULL 行保留
    expect(seen.notArgs).toEqual(['is_qa', 'is', true])
    // status 下推：与 isSystemError 的第一个条件逐字等价，只为少拉成功行
    expect(seen.eq).toEqual(['error'])
    expect(seen.select).toBe('status, service, metadata, user_id')
  })

  it('查询报错 → null（route 据此置 failureImpactPending、前端标「降级中」）', async () => {
    const { client } = makeCapture([], { message: 'boom' })
    expect(await fetchFailureImpact(client, 7, new Date('2026-08-14T02:00:00.000Z'))).toBeNull()
  })

  it('happy path：聚合结果透传，并带上 truncated=false', async () => {
    const { client } = makeCapture([fail('coach', U1)])
    const out = await fetchFailureImpact(client, 7, new Date('2026-08-14T02:00:00.000Z'))
    expect(out?.totalFailures).toBe(1)
    expect(out?.truncated).toBe(false)
  })
})
