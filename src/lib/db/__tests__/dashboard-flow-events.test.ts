/**
 * @module   db/dashboard-flow-events.test
 * @desc     「客户端链路观测」聚合的行为守卫。钉死三件最容易被后人"顺手优化"掉、
 *           而一旦丢掉这块就失去全部价值的性质：
 *             ① 归属分类（用户侧 / 我方侧 / 网络）不能错位，aborted 不进成功率分母；
 *             ② 零计数的事件、零次出现的枚举值【必须留一行/一格】—— 过滤掉它们等于把
 *                「埋点坏了」和「值拼错了」这两个唯一可见信号一起删掉；
 *             ③ QA 流量不进主计数，但要单列（不能直接在查询里 where is_qa=false 丢掉）。
 * @author   LingoBridge
 * @created  2026-08-03
 */
jest.mock('server-only', () => ({}))

import {
  aggregateAiCall, aggregateEventCounts, aggregateEnumCoverage, aggregateFlowHealth,
  latestOursFailure, flowWindowStart, FLOW_EVENT_NAMES, MISSING_VALUE,
  type FlowEventRow,
} from '@/lib/db/dashboard-flow-events'

/** 造一行埋点事件（created_at 默认落在起算日之后） */
function row(
  event: string,
  props: Record<string, unknown> | null = {},
  isQa = false,
  createdAt = '2026-08-02T10:00:00.000Z',
): FlowEventRow {
  return { event, props, is_qa: isQa, created_at: createdAt }
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
