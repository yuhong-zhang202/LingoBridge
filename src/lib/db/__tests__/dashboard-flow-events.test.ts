/**
 * @module   db/dashboard-flow-events.test
 * @desc     「客户端链路观测」聚合的行为守卫。钉死三件最容易被后人"顺手优化"掉、
 *           而一旦丢掉这块就失去全部价值的性质：
 *             ① 归属分类（用户侧 / 我方侧 / 网络）不能错位，aborted 不进成功率分母；
 *             ② 零计数的事件、零次出现的枚举值【必须留一行/一格】—— 过滤掉它们等于把
 *                「埋点坏了」和「值拼错了」这两个唯一可见信号一起删掉；
 *             ③ QA 流量不进主计数，但要单列（不能直接在查询里 where is_qa=false 丢掉）；
 *             ④ 内部账户（产品方自测账号）与 ③ 同档：不进主计数、单列在自测格。
 *                单靠 is_qa 挡不住它——那一列 2026-08-02（迁移 0053）才有，此前的行一律 false
 *                且无法回溯标记，实测占了近 60 天 match.result 主口径的 24%。
 * @author   LingoBridge
 * @created  2026-08-03
 */
jest.mock('server-only', () => ({}))

import {
  aggregateAiCall, aggregateEventCounts, aggregateEnumCoverage, aggregateFlowHealth,
  applyEverSeen, latestOursFailure, flowWindowStart, FLOW_EVENT_NAMES, MISSING_VALUE,
  type FlowEventRow,
} from '@/lib/db/dashboard-flow-events'
import { INTERNAL_ACCOUNT_IDS } from '@/lib/internal-accounts'

/** 名册里的真实内部账户 id（刻意不手抄常量：抄了就会与名册漂移） */
const INTERNAL_ID = [...INTERNAL_ACCOUNT_IDS][0]

/** 造一行埋点事件（默认真实用户、created_at 落在起算日之后） */
function row(
  event: string,
  props: Record<string, unknown> | null = {},
  isQa = false,
  createdAt = '2026-08-02T10:00:00.000Z',
  userId: string | null = 'real-user',
): FlowEventRow {
  return { event, props, is_qa: isQa, user_id: userId, created_at: createdAt }
}

/**
 * 造一行【内部账户】埋点（is_qa 刻意留 false —— 这正是 0053 之前那批行的真实形态）。
 * @param event      事件名
 * @param props      事件属性
 * @param createdAt  时刻（ISO）
 * @returns          一行内部账户事件
 */
function internalRow(
  event: string,
  props: Record<string, unknown> | null = {},
  createdAt = '2026-08-02T10:00:00.000Z',
): FlowEventRow {
  return { event, props, is_qa: false, user_id: INTERNAL_ID, created_at: createdAt }
}

describe('aggregateAiCall · 结局归属与成功率', () => {
  it('六类失败按「用户侧 / 我方侧 / 网络」归位，aborted 不入成功率分母', () => {
    const rows: FlowEventRow[] = [
      row('flow.ai_call', { stage: 'transcribe', result: 'ok' }),
      row('flow.ai_call', { stage: 'transcribe', result: 'ok' }),
      row('flow.ai_call', { stage: 'transcribe', result: 'consent_403' }),
      row('flow.ai_call', { stage: 'transcribe', result: 'quota_402' }),
      row('flow.ai_call', { stage: 'transcribe', result: 'rate_429' }),
      row('flow.ai_call', { stage: 'transcribe', result: 'busy_503' }),
      row('flow.ai_call', { stage: 'transcribe', result: 'server_5xx' }),
      row('flow.ai_call', { stage: 'transcribe', result: 'network' }),
      row('flow.ai_call', { stage: 'transcribe', result: 'aborted' }),
      // 非 ai_call 的行不该被算进来
      row('match.result', { noMatch: false }),
    ]
    const t = aggregateAiCall(rows).find(s => s.stage === 'transcribe')
    expect(t).toBeDefined()
    expect(t?.ok).toBe(2)
    expect(t?.userSide).toBe(3)     // consent_403 + quota_402 + rate_429
    expect(t?.ourSide).toBe(2)      // busy_503 + server_5xx
    expect(t?.networkSide).toBe(1)  // network
    expect(t?.aborted).toBe(1)
    // 分母 = 2+3+2+1 = 8（不含 aborted）；2/8 = 25%
    expect(t?.attempts).toBe(8)
    expect(t?.successRate).toBe(25)
  })

  it('契约里的三个阶段恒占一行（零数据也在）—— 某阶段归零必须看得见', () => {
    const stats = aggregateAiCall([row('flow.ai_call', { stage: 'polish', result: 'ok' })])
    const stages = stats.map(s => s.stage)
    expect(stages).toEqual(expect.arrayContaining(['transcribe', 'restructure', 'polish']))
    const t = stats.find(s => s.stage === 'transcribe')
    expect(t?.attempts).toBe(0)
    expect(t?.successRate).toBeNull()   // 无尝试时不显示 0%（那是误导）
  })

  it('没带 result 的调用单列为「未上报」、不进成功率分母', () => {
    const stats = aggregateAiCall([
      row('flow.ai_call', { stage: 'polish', result: 'ok' }),
      row('flow.ai_call', { stage: 'polish' }),
    ])
    const p = stats.find(s => s.stage === 'polish')
    expect(p?.missingResult).toBe(1)
    expect(p?.attempts).toBe(1)
    expect(p?.successRate).toBe(100)
    expect(p?.results.some(r => r.result === MISSING_VALUE && r.bucket === 'missing')).toBe(true)
  })

  it('QA 流量不进主计数、但单列出来（不能在查询里直接丢掉）', () => {
    const stats = aggregateAiCall([
      row('flow.ai_call', { stage: 'restructure', result: 'ok' }, false),
      row('flow.ai_call', { stage: 'restructure', result: 'server_5xx' }, true),
    ])
    const r = stats.find(s => s.stage === 'restructure')
    expect(r?.ourSide).toBe(0)          // 自测的失败不计入我方侧主数字
    expect(r?.qaRows).toBe(1)
    expect(r?.results.find(x => x.result === 'server_5xx')?.qaCount).toBe(1)
  })

  it('清单外的 result 值不被吞掉，归入 other 桶并照常展示', () => {
    const stats = aggregateAiCall([row('flow.ai_call', { stage: 'polish', result: 'brand_new_code' })])
    const p = stats.find(s => s.stage === 'polish')
    const extra = p?.results.find(r => r.result === 'brand_new_code')
    expect(extra).toBeDefined()
    expect(extra?.bucket).toBe('other')
    expect(p?.otherSide).toBe(1)
  })
})

describe('aggregateEventCounts · 零计数必须留一行', () => {
  it('清单内事件全部占一行，没数据的计 0', () => {
    const stats = aggregateEventCounts([row('flow.ai_call', { stage: 'polish' })])
    expect(stats.filter(s => s.known)).toHaveLength(FLOW_EVENT_NAMES.length)
    expect(stats.find(s => s.event === 'flow.ai_call')?.count).toBe(1)
    // 「某事件归零」是发现埋点坏了的唯一信号 —— 绝不能因为没数据就不显示
    expect(stats.find(s => s.event === 'match.question_opened')?.count).toBe(0)
  })

  it('库里出现清单外的事件名时标 known=false（提示看板侧副本该同步了）', () => {
    const stats = aggregateEventCounts([row('flow.brand_new_event')])
    const extra = stats.find(s => s.event === 'flow.brand_new_event')
    expect(extra?.known).toBe(false)
    expect(extra?.count).toBe(1)
  })

  it('QA 行不进主计数、单列 qaCount', () => {
    const stats = aggregateEventCounts([
      row('flow.story_entry', {}, true),
      row('flow.story_entry', {}, false),
    ])
    const e = stats.find(s => s.event === 'flow.story_entry')
    expect(e?.count).toBe(1)
    expect(e?.qaCount).toBe(1)
  })
})

describe('everSeen · 「窗口内归零」两档判定（历史有过=红 / 从未出现=灰）', () => {
  it('情形①窗口有量：真实或自测出现过的事件 everSeen=true，不需要全库回填', () => {
    const stats = aggregateEventCounts([
      row('flow.story_entry'),
      row('quota.reached', {}, true),   // 仅自测也算「出现过」
    ])
    expect(stats.find(s => s.event === 'flow.story_entry')?.everSeen).toBe(true)
    expect(stats.find(s => s.event === 'quota.reached')?.everSeen).toBe(true)
    // 窗口内 0 的事件在纯窗口聚合阶段先记 false，等全库存在性查询回填
    expect(stats.find(s => s.event === 'quota.cta')?.everSeen).toBe(false)
  })

  it('情形②窗口 0 但全库出现过：回填后 everSeen=true —— 红档「可能坏了」，维持告警', () => {
    const stats = applyEverSeen(aggregateEventCounts([]), new Set(['page.view']))
    expect(stats.find(s => s.event === 'page.view')?.everSeen).toBe(true)
  })

  it('情形③全库从未出现：回填后 everSeen=false —— 灰档「待首次触发」，不该染红', () => {
    const stats = applyEverSeen(aggregateEventCounts([]), new Set(['page.view']))
    expect(stats.find(s => s.event === 'quota.cta')?.everSeen).toBe(false)
  })

  it('窗口内有量的行不被回填改写（全库查询只覆盖窗口 0 的候选，缺席≠全库没有）', () => {
    // flow.story_entry 窗口内有量但不在 seenInDb 集合里 —— 若被改写成 false 即判定被破坏
    const stats = applyEverSeen(aggregateEventCounts([row('flow.story_entry')]), new Set())
    expect(stats.find(s => s.event === 'flow.story_entry')?.everSeen).toBe(true)
  })
})

describe('aggregateEnumCoverage · 恒缺的值要看得见', () => {
  it('契约里的取值全部占一格，一次没出现的计 0（不做自动判定、只摆分布）', () => {
    const cov = aggregateEnumCoverage([
      row('flow.mic_permission', { result: 'granted', surface: 'home' }),
    ])
    const surface = cov.find(c => c.key === 'flow.mic_permission.surface')
    expect(surface?.values.map(v => v.value)).toEqual(['home', 'recording', 'practice'])
    expect(surface?.values.find(v => v.value === 'home')?.count).toBe(1)
    // 'practice' 恒缺 —— 正是 2026-08-02 「surface 写死」那个 bug 的形态，必须留格
    expect(surface?.values.find(v => v.value === 'practice')?.count).toBe(0)
  })

  it('字段缺失（被 sanitize 静默丢弃）单独计数，不混进任何取值', () => {
    const cov = aggregateEnumCoverage([
      row('flow.story_entry', { entry: 'record', mode: 'story' }),
      row('flow.story_entry', { mode: 'story' }),
      row('flow.story_entry', { mode: 'story' }, true),
    ])
    const entry = cov.find(c => c.key === 'flow.story_entry.entry')
    expect(entry?.eventRows).toBe(2)
    expect(entry?.eventRowsQa).toBe(1)
    expect(entry?.missing).toBe(1)
    expect(entry?.missingQa).toBe(1)
    expect(entry?.values.reduce((s, v) => s + v.count, 0)).toBe(1)
  })

  it('清单外的取值照常展示并标 expected=false', () => {
    const cov = aggregateEnumCoverage([row('flow.capture_submitted', { outcome: 'weird_value' })])
    const outcome = cov.find(c => c.key === 'flow.capture_submitted.outcome')
    expect(outcome?.values.find(v => v.value === 'weird_value')?.expected).toBe(false)
  })
})

describe('aggregateFlowHealth · 窗口元信息', () => {
  it('统计 QA 行数与早于起算日的行数（后者混有无法回溯标记的自测流量）', () => {
    const res = aggregateFlowHealth([
      row('flow.ai_call', { stage: 'polish', result: 'ok' }, false, '2026-07-30T10:00:00.000Z'),
      row('flow.ai_call', { stage: 'polish', result: 'ok' }, true,  '2026-08-02T10:00:00.000Z'),
      row('flow.ai_call', { stage: 'polish', result: 'ok' }, false, '2026-08-03T10:00:00.000Z'),
    ], 7, '2026-07-28T16:00:00.000Z', false)
    expect(res.totalRows).toBe(3)
    expect(res.qaRows).toBe(1)
    expect(res.preBaselineRows).toBe(1)
    expect(res.baselineStart).toBe('2026-08-02')
  })
})

describe('flowWindowStart · 东八区日界', () => {
  it('7 天窗口的起点 = 东八区今日 0 点往前推 6 天（与主看板同口径）', () => {
    // 东八区 2026-08-03 07:00（= UTC 08-02 23:00）→ 起点应为东八区 07-28 00:00 = UTC 07-27 16:00
    expect(flowWindowStart(new Date('2026-08-02T23:00:00.000Z'), 7).toISOString())
      .toBe('2026-07-27T16:00:00.000Z')
  })
})

describe('latestOursFailure · 「该我们修」格下钻', () => {
  it('取最近一条 ours 桶失败；用户侧/网络/QA/非 ai_call 行都不算', () => {
    const rows: FlowEventRow[] = [
      row('flow.ai_call', { stage: 'transcribe', result: 'busy_503' }, false, '2026-08-02T10:00:00.000Z'),
      row('flow.ai_call', { stage: 'matching', result: 'server_5xx' }, false, '2026-08-03T10:00:00.000Z'),
      row('flow.ai_call', { stage: 'coach', result: 'consent_403' }, false, '2026-08-03T12:00:00.000Z'),   // 用户侧
      row('flow.ai_call', { stage: 'coach', result: 'network' }, false, '2026-08-03T12:00:00.000Z'),       // 网络
      row('flow.ai_call', { stage: 'coach', result: 'server_5xx' }, true, '2026-08-03T13:00:00.000Z'),     // QA
      row('match.result', { result: 'server_5xx' }, false, '2026-08-03T14:00:00.000Z'),                    // 非 ai_call
    ]
    expect(latestOursFailure(rows)).toEqual({
      stageName: '题目匹配', result: 'server_5xx', createdAt: '2026-08-03T10:00:00.000Z',
    })
  })

  it('stage 未上报显「未知阶段」；窗口内无 ours 失败返回 null', () => {
    expect(latestOursFailure([row('flow.ai_call', { result: 'parse_fail' })])?.stageName).toBe('未知阶段')
    expect(latestOursFailure([row('flow.ai_call', { stage: 'coach', result: 'ok' })])).toBeNull()
  })
})

describe('内部账户（产品方自测号）与 QA 同档：不进主口径、单列在自测格', () => {
  // 这一组的每一行都是 is_qa=false —— 0053 之前那批自测流量的真实形态。
  // 只按 is_qa 过滤时它们会全部混进主口径（实测占近 60 天 match.result 主口径的 24%）。

  it('AI 结局：内部账户的失败不计入「我方侧」，落进自测格', () => {
    const stats = aggregateAiCall([
      row('flow.ai_call', { stage: 'matching', result: 'ok' }),
      internalRow('flow.ai_call', { stage: 'matching', result: 'server_5xx' }),
    ])
    const m = stats.find(s => s.stage === 'matching')
    expect(m?.ourSide).toBe(0)
    expect(m?.attempts).toBe(1)
    expect(m?.successRate).toBe(100)
    expect(m?.qaRows).toBe(1)
    expect(m?.results.find(r => r.result === 'server_5xx')?.qaCount).toBe(1)
  })

  it('事件计数：内部账户行不进 count、进 qaCount，且 everSeen 仍为真（埋点确实被触发过）', () => {
    const stats = aggregateEventCounts([
      row('match.result'),
      internalRow('match.result'),
      internalRow('quota.cta'),
    ])
    const m = stats.find(s => s.event === 'match.result')
    expect(m?.count).toBe(1)
    expect(m?.qaCount).toBe(1)
    // 只有内部账户触发过的事件：主口径 0，但「这条埋点是通的」这个信号不能丢
    const q = stats.find(s => s.event === 'quota.cta')
    expect(q?.count).toBe(0)
    expect(q?.qaCount).toBe(1)
    expect(q?.everSeen).toBe(true)
  })

  it('枚举覆盖：内部账户行计进 eventRowsQa / missingQa，不污染真实分布', () => {
    const cov = aggregateEnumCoverage([
      row('flow.story_entry', { entry: 'record' }),
      internalRow('flow.story_entry', { entry: 'text' }),
      internalRow('flow.story_entry', {}),
    ])
    const entry = cov.find(c => c.key === 'flow.story_entry.entry')
    expect(entry?.eventRows).toBe(1)
    expect(entry?.eventRowsQa).toBe(2)
    expect(entry?.missing).toBe(0)
    expect(entry?.missingQa).toBe(1)
    expect(entry?.values.find(v => v.value === 'record')?.count).toBe(1)
    // 内部账户打出来的 'text' 不进主计数（否则「真实用户用过文字入口」是假的）
    expect(entry?.values.find(v => v.value === 'text')?.count).toBe(0)
    expect(entry?.values.find(v => v.value === 'text')?.qaCount).toBe(1)
  })

  it('「该我们修」下钻：不拿内部账户撞出来的故障报警', () => {
    const latest = latestOursFailure([
      row('flow.ai_call', { stage: 'matching', result: 'busy_503' }, false, '2026-08-03T10:00:00.000Z'),
      internalRow('flow.ai_call', { stage: 'coach', result: 'server_5xx' }, '2026-08-04T10:00:00.000Z'),
    ])
    // 时间更新的那条是内部账户的，必须被跳过
    expect(latest).toEqual({ stageName: '题目匹配', result: 'busy_503', createdAt: '2026-08-03T10:00:00.000Z' })
    expect(latestOursFailure([internalRow('flow.ai_call', { stage: 'coach', result: 'server_5xx' })])).toBeNull()
  })

  it('窗口元信息：qaRows 把内部账户行也算作自测（它不等于库里 is_qa=true 的行数）', () => {
    const res = aggregateFlowHealth([
      row('flow.ai_call', { stage: 'polish', result: 'ok' }),
      row('flow.ai_call', { stage: 'polish', result: 'ok' }, true),
      internalRow('flow.ai_call', { stage: 'polish', result: 'ok' }),
    ], 7, '2026-07-28T16:00:00.000Z', false)
    expect(res.totalRows).toBe(3)
    expect(res.qaRows).toBe(2)
    expect(res.aiCall.find(s => s.stage === 'polish')?.ok).toBe(1)
  })

  it('匿名行（user_id=null）不被误剔 —— 未登录用户是真实用户，不是自测', () => {
    const stats = aggregateEventCounts([row('page.view', {}, false, '2026-08-02T10:00:00.000Z', null)])
    const p = stats.find(s => s.event === 'page.view')
    expect(p?.count).toBe(1)
    expect(p?.qaCount).toBe(0)
  })
})
