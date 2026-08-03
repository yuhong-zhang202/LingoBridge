/**
 * @module   db/dashboard-flow-events
 * @desc     经营看板「客户端链路观测」的数据层 —— 读 flow_events（埋点表）并聚合成三块：
 *           ① AI 调用结局分布（stage × result，按归属分「用户侧 / 我方侧 / 网络」）；
 *           ② 埋点健康（各事件类型计数，重点是标出计数为 0 的事件）；
 *           ③ 关键枚举字段的实际取值分布（标出「一次都没出现过」的值）。
 *
 *   【为什么要单独有这一块】现有看板的失败观测全部基于 api_usage_logs（服务端记账），
 *   而服务端的早退分支【根本不记账】：403 未同意 / 402 额度 / 429 日限 / 400 输入 / 503 并发满
 *   全是裸 return，网络失败更是结构性无痕。2026-08-02 生产实测的六类 ai_call 失败里，
 *   只有 server_5xx 一类在旧看板上看得见，其余五类完全不可见。
 *
 *   ⚠️【口径与 api_usage_logs 不同，且不该对得上】api_usage_logs = 真实产生费用的调用；
 *   flow_events = 用户视角的尝试与结局（含压根没走到供应商的早退）。两个数对不上是预期，
 *   UI 必须写明，别让人以为哪边算错了。
 *
 *   ⚠️【事件名 / 枚举值在本文件手工重列了一份】刻意的重复，理由见 FLOW_EVENT_NAMES 注释。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
import 'server-only'
import type { getSupabaseServer } from '@/lib/supabase-server'

/** service_role 客户端类型（route 传入；flow_events 无 select 策略，只有 service_role 读得到） */
type SupabaseServer = ReturnType<typeof getSupabaseServer>

// ── 事件名 / 枚举值的看板侧副本 ─────────────────────────────────────────────────────────
// ⚠️⚠️ 以下常量是【与 src/lib/event-schema.ts 手工对齐的一份副本】，不是真源。
//   为什么不 import：本模块是纯观测面，而契约文件正在被另一条改动线重写；直接依赖会让
//   「看板」与「被观测对象」互相锁死——观测面本就该允许与被观测对象短暂不一致，那种不一致
//   恰恰是本模块要暴露的信号（下方 known=false / expected=false 两个标记即为此设计）。
//   【加新事件 / 新枚举值时要同步改这里】；漏改不会 tsc 报错，但看板会把新值显示成
//   「清单外的值」（known/expected=false），一眼可见——所以漏改是可发现的，不是静默的。
//   待办：等契约文件收敛后，评估改为从真源 import（届时本注释一并删除）。

/**
 * 埋点事件名全集（= FlowEventName 联合类型的手工副本）。
 * 顺序即 UI 展示顺序：按用户走的链路先后排（入口 → 采集 → AI → 匹配 → 结果消费 → 服务端自发）。
 */
export const FLOW_EVENT_NAMES = [
  'flow.story_entry',
  'flow.mic_permission',
  'flow.capture_started',
  'flow.capture_submitted',
  'flow.capture_abandoned',
  'flow.ai_call',
  'flow.corpus_bound',
  'flow.consent_granted',
  'match.result',
  'match.view_rendered',
  'match.question_opened',
  'quota.reached',
  'quota.cta',
  'auth.registered',
] as const

/** 事件名的中文说明（看板只给 admin 看，仍写人话，免得每次都要回去翻代码） */
const EVENT_LABEL: Record<string, string> = {
  'flow.story_entry':       '进入故事采集',
  'flow.mic_permission':    '麦克风授权',
  'flow.capture_started':   '开始采集',
  'flow.capture_submitted': '采集提交',
  'flow.capture_abandoned': '采集中途放弃',
  'flow.ai_call':           'AI 调用',
  'flow.corpus_bound':      '语料建成',
  'flow.consent_granted':   '同意隐私条款',
  'match.result':           '匹配结果（服务端）',
  'match.view_rendered':    '匹配页渲染',
  'match.question_opened':  '点开题目',
  'quota.reached':          '额度弹层显示',
  'quota.cta':              '额度弹层内点击',
  'auth.registered':        '注册成功',
}

/** AI 调用的管线阶段（AI_STAGE 副本） */
const AI_STAGES = ['transcribe', 'restructure', 'polish'] as const
/** 阶段中文名 */
const STAGE_LABEL: Record<string, string> = {
  transcribe:  '语音转写',
  restructure: '语料整理',
  polish:      '单句润色',
}

/** 一次 AI 调用结局的归属分类（决定「该找谁」） */
export type AiResultBucket = 'ok' | 'user' | 'ours' | 'network' | 'aborted' | 'other' | 'missing'

/**
 * result 值 → 归属桶。分类依据 = 「谁能让这个数变好」：
 *   user    用户侧（没同意 / 额度用完 / 触日限 / 输入不合格 / 说了等于没说）—— 产品与文案的事，不是故障
 *   ours    我方侧（鉴权配错 / 并发满 / 服务端 5xx / 返回解析不了）—— 该修代码或扩容
 *   network 网络（请求根本没到 / 超时）—— 端侧网络或链路，服务端一定无痕
 *   aborted 用户主动跳页打断，【不计失败】，单列
 *   other   契约里的兜底值 'other'（归不了类的结局，出现即说明该细分了）
 */
const AI_RESULT_BUCKET: Record<string, AiResultBucket> = {
  ok:            'ok',
  consent_403:   'user',
  quota_402:     'user',
  rate_429:      'user',
  bad_input_400: 'user',
  empty_422:     'user',
  auth_401:      'ours',
  busy_503:      'ours',
  server_5xx:    'ours',
  parse_fail:    'ours',
  network:       'network',
  timeout:       'network',
  aborted:       'aborted',
  other:         'other',
}

/** AI_RESULT 枚举全集（副本，顺序即展示顺序；来源同 AI_RESULT_BUCKET 的 key） */
const AI_RESULTS = Object.keys(AI_RESULT_BUCKET)

/** result 的中文说明 */
const RESULT_LABEL: Record<string, string> = {
  ok:            '成功',
  consent_403:   '未同意隐私条款',
  quota_402:     '额度用完',
  rate_429:      '触日限',
  bad_input_400: '输入不合格',
  empty_422:     '内容为空',
  auth_401:      '鉴权失败',
  busy_503:      '并发满',
  server_5xx:    '服务端错误',
  parse_fail:    '返回解析失败',
  network:       '网络失败',
  timeout:       '超时',
  aborted:       '用户跳页打断',
  other:         '其他（未细分）',
}

/** props 里字段缺失时的占位显示值（不是真枚举值，UI 单独染色） */
export const MISSING_VALUE = '(未上报)'

/** 需要做取值覆盖检查的关键枚举字段 */
interface EnumFieldSpec {
  /** 唯一 key，形如 'flow.ai_call.result' */
  key: string
  event: string
  field: string
  label: string
  /** 契约里应当出现的取值全集（手工副本，见文件头 ⚠️） */
  expected: readonly string[]
}

const ENUM_FIELDS: readonly EnumFieldSpec[] = [
  { key: 'flow.ai_call.result', event: 'flow.ai_call', field: 'result',
    label: 'AI 调用结局', expected: AI_RESULTS },
  { key: 'flow.ai_call.stage', event: 'flow.ai_call', field: 'stage',
    label: 'AI 调用阶段', expected: AI_STAGES },
  { key: 'flow.capture_submitted.outcome', event: 'flow.capture_submitted', field: 'outcome',
    label: '采集提交结局', expected: [
      'proceed', 'too_short', 'quota_blocked', 'no_audio', 'too_large', 'garbage',
      'text_too_short', 'consent_blocked', 'ai_failed', 'aborted',
    ] },
  { key: 'flow.mic_permission.surface', event: 'flow.mic_permission', field: 'surface',
    label: '麦克风授权界面', expected: ['home', 'recording', 'practice'] },
  { key: 'flow.story_entry.entry', event: 'flow.story_entry', field: 'entry',
    label: '故事采集入口', expected: ['record', 'text', 'write', 'record_from_write'] },
  { key: 'quota.reached.variant', event: 'quota.reached', field: 'variant',
    label: '额度弹层变体', expected: ['trial', 'story', 'ielts'] },
  // matching 页的调用点尚未传 surface（见 QuotaReached 的 Props 注释）→ 那批行会落进 missing，
  // 正是本块设计要看见的信号：补上之后 missing 应归零。
  { key: 'quota.reached.surface', event: 'quota.reached', field: 'surface',
    label: '额度弹层界面', expected: [
      'home', 'write', 'recording', 'restructure', 'analysis',
      'practice', 'practice_question', 'question_bank', 'matching',
    ] },
  { key: 'quota.cta.cta', event: 'quota.cta', field: 'cta',
    label: '额度弹层点击出口', expected: ['register', 'practice_ielts', 'new_story', 'profile', 'close'] },
]

/**
 * 真实用户数据的起算日（东八区 2026-08-02 00:00 = UTC 08-01 16:00）。
 * 此日之前的 flow_events 混着产品方自测流量，且【无法回溯标记】（谁在什么时候自测过，事后无据可判，
 * 见 migration 0053 顶注）。窗口跨过这一天时，UI 必须标出「早于起算日的 N 条仅供参考」。
 */
export const FLOW_BASELINE_START = '2026-08-02'
const FLOW_BASELINE_TS = Date.parse('2026-08-01T16:00:00.000Z')

// ── 分页拉取 ──────────────────────────────────────────────────────────────────────
// PostgREST 对不带 range 的 select 强制只返回前 1000 行且【不报错】，聚合类查询裸查 = 静默少报
// （api/dashboard/route.ts 已因此吃过一次亏）。此处同样逐页拉全量。
// 刻意不复用 route.ts 里的 fetchAllRows：那是 route 文件内的私有帮手，导出它会让 route 变成
// 事实上的公共模块（Next 的 route 文件只该导出 HTTP handler）。
/** 每页行数：必须严格小于 PostgREST 的 db-max-rows（默认 1000），否则「不满页=到底」的判停会失真。 */
const PAGE_SIZE = 500
/** 分页上限（= 5 万行）。触顶不静默：置 truncated 让 UI 明说「数据不完整」。 */
const MAX_PAGES = 100

/** flow_events 的最小读取形状（只取聚合用得上的四列，绝不 select *） */
export interface FlowEventRow {
  event: string
  props: Record<string, unknown> | null
  is_qa: boolean | null
  created_at: string
}

// ── 聚合结果类型（前端 FlowHealthPanel 直接消费）────────────────────────────────────

/** 某个 stage 下某个 result 的计数 */
export interface AiResultStat {
  result: string
  label: string
  bucket: AiResultBucket
  count: number
  /** QA 自测流量的计数（不计入主口径，只用于确认 QA 标记在工作 / 判断某分支到底有没有被触发过） */
  qaCount: number
}

/** 单个 AI 阶段的结局分布与成功率 */
export interface AiStageStat {
  stage: string
  name: string
  /** 成功率分母 = ok + 用户侧 + 我方侧 + 网络 + other（刻意不含 aborted / 未上报 result 的行） */
  attempts: number
  ok: number
  userSide: number
  ourSide: number
  networkSide: number
  otherSide: number
  /** 用户主动跳页打断，不计失败、不入分母 */
  aborted: number
  /** 有 ai_call 事件但 props 里没带 result 的行数 —— 这批调用在结局分布里凭空消失，必须能看见 */
  missingResult: number
  /** ok / attempts × 100（1 位小数）；attempts=0 时 null（别显示 0% 误导） */
  successRate: number | null
  /** 该阶段的 QA 行数（含 aborted / 未上报） */
  qaRows: number
  results: AiResultStat[]
}

/** 单个事件名的计数 */
export interface EventCountStat {
  event: string
  label: string
  count: number
  qaCount: number
  /** false = 库里出现了本看板清单外的事件名（清单该同步了） */
  known: boolean
}

/** 单个枚举取值的计数 */
export interface EnumValueStat {
  value: string
  count: number
  qaCount: number
  /** false = 库里出现了契约副本之外的值（要么契约副本过期，要么服务端 sanitize 被绕过） */
  expected: boolean
}

/** 单个枚举字段的取值覆盖 */
export interface EnumFieldCoverage {
  key: string
  label: string
  event: string
  field: string
  /** 该事件在窗口内的总行数（真实，不含 QA）—— 0 行时「全部值恒缺」不代表拼错，只代表没数据 */
  eventRows: number
  eventRowsQa: number
  /** 该事件里这个字段【缺失】的行数（真实 / QA）—— 字段被静默丢弃时这里会涨 */
  missing: number
  missingQa: number
  values: EnumValueStat[]
}

/** 「客户端链路观测」整块的返回结构 */
export interface FlowHealthResult {
  windowDays: number
  /** 窗口起点（ISO，东八区日界折算后的 UTC 时刻） */
  windowStart: string
  /** 真实用户数据起算日（东八区日期串） */
  baselineStart: string
  /** 窗口内早于起算日的行数（含 QA）—— >0 时 UI 提示这批数据混有无法回溯标记的自测流量 */
  preBaselineRows: number
  /** 窗口内总行数（含 QA） */
  totalRows: number
  /** 其中 is_qa=true 的行数 */
  qaRows: number
  /** true = 分页触顶，以下所有计数偏低，不可当真实值看 */
  truncated: boolean
  aiCall: AiStageStat[]
  eventCounts: EventCountStat[]
  enumCoverage: EnumFieldCoverage[]
}

// ── 聚合（纯函数，可单测）─────────────────────────────────────────────────────────

/** 取 props 里的字符串字段；非字符串 / 缺失一律 undefined（与服务端 sanitize 同款「不容错」立场） */
function pickStr(props: Record<string, unknown> | null, key: string): string | undefined {
  const v = props?.[key]
  return typeof v === 'string' ? v : undefined
}

/** 计数器：key → [真实, QA] 两格 */
type Counter = Map<string, [number, number]>

/** 往计数器某个 key 上加一（按是否 QA 落到不同格） */
function bump(counter: Counter, key: string, isQa: boolean): void {
  const cur = counter.get(key) ?? [0, 0]
  cur[isQa ? 1 : 0] += 1
  counter.set(key, cur)
}

/**
 * 聚合 AI 调用结局分布：按 stage × result 分组，并按归属桶汇总 + 算成功率。
 * 只统计 event='flow.ai_call' 的行；stage 未上报的行归入一个显式的 '(未上报)' 阶段，不静默丢。
 * @param rows  窗口内全部 flow_events 行（含 QA，函数内部区分）
 * @returns     每个阶段一条，契约里的三个阶段恒在（零行也给一条，否则「某阶段归零」看不出来）
 */
export function aggregateAiCall(rows: readonly FlowEventRow[]): AiStageStat[] {
  // stage → (result → [真实, QA])。result 缺失用 MISSING_VALUE 占位。
  const byStage = new Map<string, Counter>()
  for (const stage of AI_STAGES) byStage.set(stage, new Map())
  for (const row of rows) {
    if (row.event !== 'flow.ai_call') continue
    const stage = pickStr(row.props, 'stage') ?? MISSING_VALUE
    const result = pickStr(row.props, 'result') ?? MISSING_VALUE
    let counter = byStage.get(stage)
    if (!counter) { counter = new Map(); byStage.set(stage, counter) }
    bump(counter, result, row.is_qa === true)
  }

  const stats: AiStageStat[] = []
  for (const [stage, counter] of byStage) {
    // 展示顺序：契约里的 result 顺序在前，清单外的值追加在后（后者本身就是要看见的异常）
    const seen = Array.from(counter.keys())
    const ordered = [
      ...AI_RESULTS.filter(r => counter.has(r)),
      ...seen.filter(r => !(r in AI_RESULT_BUCKET)),
    ]
    const results: AiResultStat[] = ordered.map(result => {
      const [count, qaCount] = counter.get(result) ?? [0, 0]
      const bucket: AiResultBucket = result === MISSING_VALUE
        ? 'missing'
        : (AI_RESULT_BUCKET[result] ?? 'other')
      return {
        result,
        label: result === MISSING_VALUE ? '未上报结局' : (RESULT_LABEL[result] ?? result),
        bucket,
        count,
        qaCount,
      }
    })
    const sum = (b: AiResultBucket): number =>
      results.filter(r => r.bucket === b).reduce((s, r) => s + r.count, 0)
    const ok = sum('ok')
    const userSide = sum('user')
    const ourSide = sum('ours')
    const networkSide = sum('network')
    const otherSide = sum('other')
    const attempts = ok + userSide + ourSide + networkSide + otherSide
    stats.push({
      stage,
      name: STAGE_LABEL[stage] ?? stage,
      attempts,
      ok,
      userSide,
      ourSide,
      networkSide,
      otherSide,
      aborted: sum('aborted'),
      missingResult: sum('missing'),
      successRate: attempts > 0 ? Math.round((ok / attempts) * 1000) / 10 : null,
      qaRows: results.reduce((s, r) => s + r.qaCount, 0),
      results,
    })
  }
  // 契约里的三阶段按管线先后固定在前（顺序稳定 = 每次打开看板位置不跳），清单外的阶段追加在后
  const order = (s: string): number => {
    const i = (AI_STAGES as readonly string[]).indexOf(s)
    return i === -1 ? AI_STAGES.length : i
  }
  return stats.sort((a, b) => order(a.stage) - order(b.stage) || a.stage.localeCompare(b.stage))
}

/**
 * 聚合各事件类型计数 —— 本块的重点【不是】哪个事件多，而是【哪个事件是 0】：
 * 埋点是 fire-and-forget、失败不报错（服务端 400 / DB CHECK 拒绝都被静默吞掉），
 * 某个事件突然归零是唯一能发现「埋点坏了」的信号，所以零计数的事件也必须占一行。
 * @param rows  窗口内全部 flow_events 行
 * @returns     清单内事件恒在（含 0），库里出现的清单外事件追加在后并标 known=false
 */
export function aggregateEventCounts(rows: readonly FlowEventRow[]): EventCountStat[] {
  const counter: Counter = new Map()
  for (const row of rows) bump(counter, row.event, row.is_qa === true)
  const known: EventCountStat[] = FLOW_EVENT_NAMES.map(event => {
    const [count, qaCount] = counter.get(event) ?? [0, 0]
    return { event, label: EVENT_LABEL[event] ?? event, count, qaCount, known: true }
  })
  const extras: EventCountStat[] = Array.from(counter.entries())
    .filter(([event]) => !(FLOW_EVENT_NAMES as readonly string[]).includes(event))
    .map(([event, [count, qaCount]]) => ({ event, label: event, count, qaCount, known: false }))
    .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event))
  return [...known, ...extras]
}

/**
 * 聚合关键枚举字段的实际取值分布 —— 用来发现「值拼错了被服务端 sanitize 静默丢弃」。
 * 刻意【不做自动判定】：分不清「该分支没触发」和「值拼错了」，把分布摆出来让人看即可
 * （2026-08-02 那批三个 bug 就是这个形态，当时没有任何东西能发现）。
 * @param rows  窗口内全部 flow_events 行
 * @returns     每个受检字段一条；契约副本里的值恒在（含 0 次），库里出现的额外值标 expected=false
 */
export function aggregateEnumCoverage(rows: readonly FlowEventRow[]): EnumFieldCoverage[] {
  return ENUM_FIELDS.map(spec => {
    const counter: Counter = new Map()
    let eventRows = 0
    let eventRowsQa = 0
    let missing = 0
    let missingQa = 0
    for (const row of rows) {
      if (row.event !== spec.event) continue
      const isQa = row.is_qa === true
      if (isQa) eventRowsQa += 1
      else eventRows += 1
      const v = pickStr(row.props, spec.field)
      if (v === undefined) {
        if (isQa) missingQa += 1
        else missing += 1
        continue
      }
      bump(counter, v, isQa)
    }
    const values: EnumValueStat[] = [
      ...spec.expected.map(value => {
        const [count, qaCount] = counter.get(value) ?? [0, 0]
        return { value, count, qaCount, expected: true }
      }),
      ...Array.from(counter.entries())
        .filter(([value]) => !spec.expected.includes(value))
        .map(([value, [count, qaCount]]) => ({ value, count, qaCount, expected: false }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    ]
    return {
      key: spec.key, label: spec.label, event: spec.event, field: spec.field,
      eventRows, eventRowsQa, missing, missingQa, values,
    }
  })
}

/**
 * 把窗口内的原始行聚合成整块「客户端链路观测」结果。
 * @param rows       窗口内全部 flow_events 行（含 QA）
 * @param windowDays 窗口天数（7/14/30）
 * @param windowStart 窗口起点（ISO）
 * @param truncated  分页是否触顶（true = 计数偏低）
 * @returns          三块聚合结果 + 窗口/QA/起算日元信息
 */
export function aggregateFlowHealth(
  rows: readonly FlowEventRow[],
  windowDays: number,
  windowStart: string,
  truncated: boolean,
): FlowHealthResult {
  return {
    windowDays,
    windowStart,
    baselineStart: FLOW_BASELINE_START,
    preBaselineRows: rows.filter(r => Date.parse(r.created_at) < FLOW_BASELINE_TS).length,
    totalRows: rows.length,
    qaRows: rows.filter(r => r.is_qa === true).length,
    truncated,
    aiCall: aggregateAiCall(rows),
    eventCounts: aggregateEventCounts(rows),
    enumCoverage: aggregateEnumCoverage(rows),
  }
}

// ── 取数 ──────────────────────────────────────────────────────────────────────────

/** 东八区偏移（无夏令时）；日界一律按东八区折算，与主看板同口径 */
const HK_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 窗口起点：东八区「今天 0 点往前推 (windowDays-1) 天」的 UTC 时刻（与主看板 rangeStartDate 同口径）。
 * @param now         当前时刻
 * @param windowDays  窗口天数
 * @returns           窗口起点
 */
export function flowWindowStart(now: Date, windowDays: number): Date {
  const hk = new Date(now.getTime() + HK_OFFSET_MS)
  const todayStartUtc = new Date(Date.UTC(hk.getUTCFullYear(), hk.getUTCMonth(), hk.getUTCDate()) - HK_OFFSET_MS)
  return new Date(todayStartUtc.getTime() - (windowDays - 1) * 24 * 60 * 60 * 1000)
}

/**
 * 拉取窗口内 flow_events 全量行并聚合。
 * 直接用 service_role 查表、【刻意不新增 RPC】——少一个 DB 对象就少一个攻击面，
 * 且 0043-0048 那批只写 grant 不写 revoke 已直接导致过一次生产越权读（0052 hotfix）。
 * 查询失败一律抛出，由 route 的 catch 转 500（本块是独立子路由，挂了不影响主看板）。
 * @param supabase    service_role 客户端（flow_events 无 select 策略，普通会话读不到）
 * @param windowDays  窗口天数（7/14/30）
 * @param now         当前时刻（可注入，便于测试）
 * @returns           整块聚合结果
 */
export async function fetchFlowHealth(
  supabase: SupabaseServer,
  windowDays: number,
  now: Date = new Date(),
): Promise<FlowHealthResult> {
  const start = flowWindowStart(now, windowDays)
  const rows: FlowEventRow[] = []
  let truncated = true
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE
    // 稳定排序（created_at asc, id asc）是分页正确性的前提：无序分页在 OFFSET 下会漏行/重行。
    const { data, error } = await supabase
      .from('flow_events')
      .select('event, props, is_qa, created_at')
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`flow_events 查询失败：${error.message}`)
    const batch = (data ?? []) as FlowEventRow[]
    for (const row of batch) rows.push(row)
    // 不满一页 = 已到表尾
    if (batch.length < PAGE_SIZE) { truncated = false; break }
  }
  return aggregateFlowHealth(rows, windowDays, start.toISOString(), truncated)
}
