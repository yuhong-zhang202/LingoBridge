/**
 * @module   dashboard-shared
 * @desc     【仅服务端】看板路由的共享底座 —— 口径常量、行类型、纯工具函数。
 *           2026-08-04 从 `/api/dashboard/route.ts` 原样抽出（逐字未改，只是换了位置）：
 *           那个文件当时 943 行、逼近 ENGINEERING 的 1000 行红线，而它的前 300 行全是
 *           无副作用的常量与纯函数，与「聚合并返回看板数据」这件事本身无关，抽走后
 *           route.ts 只剩取数与聚合主线。
 *
 *   ⚠️ 这里的每个常量都是【口径定义】，不是随手可调的参数：
 *     · LATENCY_CUTOFF_TS / _LABEL —— 延迟口径断点，改它等于改「哪些历史数据算数」；
 *     · LATENCY_WARN_MS —— 决定耗时条何时转警示色；
 *     · DAILY_BUDGET_CNY —— 成本告警的参照线；
 *     · EXCLUDE_INTERNAL_BY_* —— 内部账户排除口径，改错会让自测流量混进经营数字。
 *   改动前先确认看板上依赖它的那一栏该不该跟着变，别只看编译过不过。
 *
 * @author   LingoBridge
 * @created  2026-08-04
 */
import 'server-only'
import { INTERNAL_ACCOUNT_IDS } from '@/lib/internal-accounts'
import { ERROR_KIND_USER_INPUT, ERROR_KIND_CAPACITY, ERROR_KIND_NETWORK } from '@/lib/constants'
import { classifyErrorKindFromLog } from '@/types/errors'

export const SERVICE_META: Record<string, { name: string; color: string }> = {
  doubao_asr:    { name: '豆包 ASR',      color: '#D4875A' },
  qwen_flash:    { name: '千问 Qwen',     color: '#7BA699' },
  qwen_plus:     { name: '千问 Plus',     color: '#6FA8C8' },
}

// 环节（phase）中文名：各 route 在 metadata.phase 打的标签。
// transcribe（最高频环节）自 2026-07-25 起补打 phase，其失败不再落 other 桶、可按环节归位；
// 2026-07-26 起再按客户端 scene 细分 transcribe_story（语料链路）/ transcribe_practice（练习对话轮次）；
// 裸 transcribe 保留 = 细分前的历史行 + 旧客户端缓存页面的兜底。
// matching 是 /api/matching catch 处无法判定挂在哪步时的兜底 phase，补此键避免前端显示生字符串 'matching'。
export const PHASE_META: Record<string, string> = {
  extraction:  '观察点萃取',
  ranking:     '题目重排',
  matching:    '匹配',
  analysis:    '侧重点分析',
  coach:       '教练对话',
  phrases:     '词组生成',
  pronounce:   '发音提示',
  restructure: '语料整理',
  polish:      '单句润色',
  transcribe:  '语音转写',
  transcribe_story:    '语料转写',
  transcribe_practice: '练习转写',
  other:       '其他',
}

// 部署形态：Zeabur + 腾讯云香港 VPS（next start 常驻进程）。DB 存 UTC，"今日"/日界/小时桶一律按东八区（UTC+8，无夏令时）折算，
// 否则香港用户看到的"今日"和"小时分布"会错位 8 小时。
export const HK_OFFSET_MS = 8 * 60 * 60 * 1000

// 预算目标线（内测占位常量，非告警阈值）：趋势图画一条日预算线、超了染红。
// 告警推送是上线前的事，本轮不做。内测阶段先按此值做视觉参照。
export const DAILY_BUDGET_CNY = 20

// ── 延迟口径断点（取 UTC 2026-07-20 19:00 = 香港 07-21 03:00） ──
// 此前 matching 的 extraction / ranking 两条日志的 latency_ms 【都】写请求总耗时（同一时长记两遍），
// fc0dbb8（提交于 UTC 2026-07-20 18:40）才改成各自分段实测。跨断点画线会看到"性能突然变好一半"——
// 那是口径修正、不是真变快。按小时看 ranking 延迟：18Z 之前仍是 20s+ 旧口径高值，19Z 那批降到 10.5s
// 新口径生效，故断点钉在 UTC 07-20 19:00（原先设的 07-19 16:00 早了整整一天，把 7/20 全天混口径都算进来了）。
// 故【按环节耗时】区块（分布 + 趋势两视图）一律只取断点之后的行；历史行不追溯改写，也不参与耗时统计。
// ⚠️ 顶部迷你条的 p50/p95 沿用全区间旧口径（那是既有指标，本轮不动），两者数字不一致属预期。
export const LATENCY_CUTOFF_TS = Date.parse('2026-07-20T19:00:00.000Z')

/** 断点日期的展示串（给前端标"数据窗口"小字用，避免前端再硬编码一遍日期）。
 *  取断点在香港墙上时钟的日期：UTC 07-20 19:00 = 香港 07-21 03:00，故首个有数据的日桶为 07-21。 */
export const LATENCY_CUTOFF_LABEL = '2026-07-21'

/** 环节耗时警示阈值：P90 超过 30 秒即视为"最坏体验已经很坏"，条色/文字转警示暖色。
 *  实测 ranking/extraction 的 P90 常态约 27s、最慢 58.5s，30s 阈值下正常波动不报警、真出问题才亮。 */
export const LATENCY_WARN_MS = 30_000

/** 耗时趋势只画最慢的前 N 个环节：环节有 9 个，全画成线团，看不出任何东西 */
export const TREND_PHASE_N = 3

/** 失败明细视图取前 N 条（区间内按时间倒序）：自带 limit、天然在分页上限内 */
export const FAILED_LOG_N = 100

// 假空率峰值阈值（0~1，对齐 useAudioRecorder 的 audioLevel = 频域均值/255 口径）：
// 空录音行里，录音峰值 ≥ 此阈值 = 采到了真实声音却转写为空 → 疑似采集/上传/ASR 问题（假空）；
// 峰值 < 此阈值 = 用户真没出声（真空、良性）。
// ⚠️ 待真实数据标定：现取 0.15 为初值（凭 audioLevel 经验：静音贴近 0、正常说话峰值可达 0.3+），
// 埋点铺开、攒够真实空录音样本后再据 peak 分布回调，不追求现在精准。
export const FAKE_EMPTY_PEAK_THRESHOLD = 0.15

// ── 内部账户从看板全部经营指标排除 ──
// 产品方自用测试账户（见 lib/internal-accounts）不该污染成本/活跃/故障/注册口径。逐查询套用。
// ⚠️ 用 `.or('<col>.is.null,<col>.not.in.(...)')` 而非直接 `.not(col,'in',...)`：PostgREST 的 not.in
//    生成 SQL `col NOT IN (...)`，而 `NULL NOT IN (...)` 求值为 NULL（非 TRUE）→ user_id 为 null 的行
//    （补归属列前的老行 / 无归属调用，属正常口径）会被一并滤掉，破坏「普通口径一字不变」。故显式 or 保留 null 行。
// INTERNAL_ACCOUNT_IDS 恒非空（至少一条产品方账户）；若将来清空，下面两个串会退化为无意义过滤，
// 但绝不会误删普通数据（is.null 分支恒保留、not.in 空集恒 TRUE），看板仍可用。
export const INTERNAL_ID_LIST = [...INTERNAL_ACCOUNT_IDS].join(',')
/** api_usage_logs / practice_sessions 等含可空 user_id 列：排除内部账户、保留 null 行。 */
export const EXCLUDE_INTERNAL_BY_USER = `user_id.is.null,user_id.not.in.(${INTERNAL_ID_LIST})`
/** profiles 表主键列名为 id（非空 PK，无 null 顾虑，但沿用 or 形式保持一致、防空集边界）。 */
export const EXCLUDE_INTERNAL_BY_ID = `id.is.null,id.not.in.(${INTERNAL_ID_LIST})`

// ── QA 自测流量从成本口径排除（迁移 0059 起）──
// 与内部账户排除【同一档】：都在查询侧逐条套用、都只作用于成本口径，不进任何业务判定。
// 为什么必须有它：内部账户名册只认产品方的【注册】账号，而产品方用无痕模式自测时每次都是一个全新的
// 匿名 user_id，一个都进不了名册 —— 只靠 EXCLUDE_INTERNAL_BY_USER，自测成本永远剔不掉。
/**
 * 排除 QA 自测流量的过滤参数，供 `.not(...EXCLUDE_QA_TRAFFIC)` 展开使用（生成 `is_qa=not.is.true`，
 * 即 SQL `is_qa IS NOT TRUE`）。与内部账户那条是不同的 query 参数键，PostgREST 以 AND 同时生效。
 *
 * ⚠️ 刻意【不写】 `.eq('is_qa', false)`：迁移 0059 生效前的历史行、以及任何 NULL 值，在 `= false` 下
 *    求值为 NULL（非 TRUE）→ 会被连同真 QA 行一起滤掉。那等于把「不知道是不是自测」当成「就是自测」，
 *    历史成本凭空缩水。`IS NOT TRUE` 对 NULL 求值为 TRUE，NULL 行原样保留 —— 宁可少剔，绝不错剔。
 *    这与上面 EXCLUDE_INTERNAL_BY_USER 刻意用 or(is.null, not.in) 保住 null 行是同一条纪律。
 *
 * ⚠️ 迁移未应用时本过滤会让查询报「列不存在」→ 看板整页 500。这是刻意的响亮失败：
 *    宁可看板打不开（一眼可见、CI 跑完迁移即自愈），也不要它照常显示一个混着自测流量的数字。
 */
export const EXCLUDE_QA_TRAFFIC = ['is_qa', 'is', true] as const

/**
 * 成本口径「剔除自测流量」的起算日（东八区，展示用）：= 迁移 0059 由 CI 应用之日。
 * 此日之前的 api_usage_logs 行【无法回溯标记】——谁在什么时候用无痕窗口自测过，事后没有依据可判；
 * 加列时 PG 把已有行一律填成 false（= 当作「不是自测」），那是默认值、不是判断结果。
 * 故看板必须把这个日子标出来，提醒【别拿起算日前后的成本做同比】。范式同漏斗侧的 FLOW_BASELINE_START。
 * ⚠️ CI 实际应用日若与此不符，改这一处（它是唯一真源，前端口径小字直接读它）。
 */
export const COST_QA_BASELINE_START = '2026-08-08'

/** 保留两位小数 */
export function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 计算一组数值的第 p 百分位（线性插值，nearest-rank 的连续版）。
 * 用于成功调用延迟 p95：均值会被长尾拉平，p95 才暴露"偶发慢请求"。
 * @param values  数值数组（无需预排序）
 * @param p       百分位（0–100）
 * @returns       该百分位值；空数组返回 0，四舍五入到整数毫秒
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return Math.round(sorted[0])
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  const frac = rank - lo
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * frac)
}

// ── 分页拉取（绕开 PostgREST max-rows=1000 截断） ──
// PostgREST 对任何不带 range 的 select 强制只返回前 1000 行，且【不报错、不提示】。
// 本看板此前 5 条聚合查询全部裸查，撞上限后是【静默少报】：实测 1237 行 / ¥13.7828 被算成
// 1000 次 / ¥12.01（少 12.9%），且行数越涨少报越多、永不回正 —— 对唯一的花费仪表这是致命的。
// 修法：按 range() 逐页拉全量，Node 侧汇总口径一字不动（见 fetchAllRows）。
//
// 每页行数。【必须严格小于 PostgREST 的 db-max-rows（默认 1000）】——这是判停不变式的护栏，
// 不是随手取的数：fetchAllRows 靠「batch.length < PAGE_SIZE = 已到表尾」判停，而带 range 的请求
// 同样被 db-max-rows 封顶。一旦 PAGE_SIZE ≥ db-max-rows，满页会被 cap 削成"不满页" → 误判到底、
// 提前收工，且 dataTruncated 仍为 false —— 静默少报（正是 b56ee61 修掉那个 bug）就此无声复活。
// 取 500 而非贴着上限的 1000：留足余量，使判停不再依赖运维把 db-max-rows 恰好留在 1000
//（把 db-max-rows 调低到 500 防慢查询是常见运维动作，那会让 =1000 的旧值当场失真）。
// 代价：页数翻倍（1237 行 2 页 → 3 页），每页多一次往返；看板仅管理员低频打开，此量级无感。
export const PAGE_SIZE = 500

// 分页上限（= 20 万行）：宁可截断也不让看板无限翻页把请求挂死。
// ⚠️ 触顶时【绝不静默】——置 dataTruncated 并打错误日志，因为"静默少报"正是本次修的 bug 本身。
// 触顶即意味着该换方案（把汇总下推成 DB 端 RPC / 物化日汇总表），不要简单调大这个数。
export const MAX_PAGES = 200

/** 分页查询的最小响应形状（只取本文件用到的两键，避免耦合 supabase-js 内部类型） */
export type QueryResponse<T> = { data: T[] | null; error: { message: string } | null }

/** 汇总结果：data 为全量行；truncated 表示撞到 MAX_PAGES 上限、数据不完整 */
export type PagedResult<T> = { data: T[]; error: { message: string } | null; truncated: boolean }

/**
 * 逐页拉取一条查询的全部结果行，绕开 PostgREST 的 1000 行默认上限。
 *
 * 入参是【工厂函数】而非查询对象：PostgrestBuilder 每次 await 即发请求且不可重复使用，
 * 每页必须重新构造一条查询。调用方在工厂里务必带上稳定排序（created_at asc, id asc），
 * 否则无序分页在 OFFSET 下会漏行/重行；按 created_at 升序还能保证分页期间新写入的行
 * 一律追加在尾部，不会挤动已翻过的页。
 *
 * @param makeQuery  每次调用返回一条【新的】待执行查询（须已带 select/过滤/排序）
 * @returns          全量行 + 首个错误 + 是否因触顶而截断
 */
export async function fetchAllRows<T>(
  makeQuery: () => { range: (from: number, to: number) => PromiseLike<QueryResponse<T>> },
): Promise<PagedResult<T>> {
  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1)
    if (error) return { data: [], error, truncated: false }
    const batch = data ?? []
    for (const row of batch) rows.push(row)
    // 不满一页 = 已到表尾。满页则可能还有，继续翻。
    if (batch.length < PAGE_SIZE) return { data: rows, error: null, truncated: false }
  }
  return { data: rows, error: null, truncated: true }
}

/** 最贵调用视图取前 N 条 */
export const TOP_COST_N = 20

/** 按用户成本视图取前 N 名（谁烧最多在最前）：内测 200 陌生人下抓"某用户刷爆钱"的核心。 */
export const TOP_USER_N = 20

/**
 * 解析 range 查询参数为天数
 * @param raw  URL 参数原始值
 * @returns    7 | 14 | 30
 */
export function parseRange(raw: string | null): number {
  if (raw === '14d') return 14
  if (raw === '30d') return 30
  return 7
}

// api_usage_logs 行的最小读取形状（metadata 为 jsonb，只取本看板用到的键）。
// error_code/error_message/logId 三键自 2026-07-25 起由各 route 失败记账补写（全部取自供应商响应、无 PII），
// 失败明细表据此一眼区分「并发超限 / 真故障」；无需改 select——它们随已 select 的整块 metadata jsonb 一并返回。
export type LogMeta = {
  phase?: string; cost_source?: string; error_kind?: string
  error_code?: string; error_message?: string; logId?: string
  // 空录音采集信号（假空率原料）：仅 transcribe 空录音失败行、且客户端上报时才有；
  // 口径生效（2026-07-28）前的历史空录音行无此键，看板据此排除、不误判真空/假空。
  audio?: { peak?: number; durMs?: number; bytes?: number } | null
} | null
// 全时段归因行：累计总花费卡与「按用户成本 Top-N」共用这一次全量查询，避免再开一条查询。
// user_id 是 UUID（0021 迁移补的归属列），补字段前的老行 / 无归属调用为 null。
export type AttribRow = { estimated_cost_cny: number; user_id: string | null; is_anonymous: boolean | null }
/** 纯金额行：月/上月费用卡只需成本一列 */
export type CostRow = { estimated_cost_cny: number }
// 今日行：既算今日费用卡，又供「今日活跃/匿名会话」（按 user_id 去重分类）与「今日故障按环节」，
// 故一并取归属列 + status + metadata + service（无 phase 时按 service 兜底成环节名）。
export type TodayRow = {
  estimated_cost_cny: number; user_id: string | null; is_anonymous: boolean | null
  status: string; service: string; metadata: LogMeta
}
// 练习场次行：今日新练/复练拆分（今日子集）+ 每日趋势场次序列共用这一次区间查询。
export type PracticeRow = { is_review: boolean; created_at: string }
/** 注册档行：今日新增注册按 created_at 过滤后计数（只取 id，绝不 join 任何个人信息） */
export type ProfileRow = { id: string }
export type RangeRow = {
  service: string; estimated_cost_cny: number; latency_ms: number
  status: string; created_at: string; metadata: LogMeta
  // 每日趋势的「活跃人数」按 user_id 去重需要归属列（只用于去重计数，不返回明细）
  user_id: string | null; is_anonymous: boolean | null
}
export type RecentRow = {
  id: string; created_at: string; service: string; endpoint: string
  usage_amount: number; usage_unit: string; estimated_cost_cny: number
  latency_ms: number; status: string; metadata: LogMeta
}
// 失败明细行（多取归属两列，供「影响者」列；user_id 在返回前被截前 8 位替换，完整 id 不出接口）
export type FailedRow = RecentRow & { user_id: string | null; is_anonymous: boolean | null }

/**
 * 这条失败是不是「系统故障」（用于错误率口径）。
 *
 * status='error' 里混着两类东西，混在一起算错误率会让真实故障被噪音淹没：
 *   （注：早先注释称「历史 62.75% 几乎全是空录音」——2026-07-20 实测证伪。全表 1168 行里
 *    error 仅 66 条、全时段错误率 5.65%；62.75% 是「other」分桶数，因 error 行不写 phase、
 *    全部落进只装失败的 other 桶所致。转写失败只占 error 的 9/66，摘除空录音仅值约 2 个百分点。）
 *   · 系统故障 —— 模型报错、上游超时、我方 bug。这是错误率要盯的信号。
 *   · 用户输入问题 —— metadata.error_kind='user_input'（如没有人声的空录音）。服务本身是好的。
 *   · 容量繁忙 —— metadata.error_kind='capacity'（豆包并发超限 45000292，对用户返回 503 ASR_BUSY）。
 *     「人多稍等」不是故障；高峰期排队本会大量产生，混进错误率会把真实故障信号淹成一片红。
 *   · 网络中断 —— metadata.error_kind='network'（ECONNRESET / aborted 等客户端网络重置/请求中断）。
 *     连接被掐断不是后端故障；用户关页/切网本会产生，混进错误率同样污染真实故障信号。
 * 只有【错误率】这一个口径按此过滤；失败成本 / 按环节 errorCost 一律照旧全量统计 error 行
 * （钱确实花了，产品方拍板：从错误率摘出、留在失败成本里）。
 * 归因取【有效kind】而非只看 error_kind 键（见 effectiveErrorKind）：error_kind 只对分类上线后的
 * 新失败生效，分类上线前的老失败行有 error_code/error_message 但无 error_kind，只看键会全掉进「系统故障」
 * 兜底被错标（老 ECONNRESET 本是网络中断、老 20000003 本是空录音）；重算把它们摘回正确类、故障数变准。
 * 只有既无 kind 又无 code/message 的更老数据才真落系统故障（诚实兜底），口径变化不追溯改写历史数据。
 * @param row  日志行（用到 status、metadata.error_kind、以及重算所需的 error_code/error_message）
 */
export function isSystemError(row: { status: string; metadata: LogMeta }): boolean {
  const kind = effectiveErrorKind(row.metadata)
  return row.status === 'error'
    && kind !== ERROR_KIND_USER_INPUT && kind !== ERROR_KIND_CAPACITY && kind !== ERROR_KIND_NETWORK
}

/**
 * 一行失败的【有效归因 kind】：存了 metadata.error_kind 就用存的（新失败记账时已定），没存则按落库的
 * error_code/error_message 用 classifyErrorKindFromLog 重算（老失败行归对类，见 isSystemError 说明）。
 * 既无 kind 又重算不出（无 code/message 的更老数据）时返回 null → 调用处按「系统故障 / 未记录」兜底。
 * 与 RecentCallsTable 失败明细表的展示口径同源，保证「看板计数」与「明细逐行分类」永远一致。
 * @param meta  日志行 metadata（用到 error_kind / error_code / error_message）
 * @returns     有效四分类之一（string kind | null）
 */
export function effectiveErrorKind(meta: LogMeta): string | null {
  return meta?.error_kind ?? classifyErrorKindFromLog(meta?.error_code, meta?.error_message)
}

/** 豆包 ASR 是唯一「只做语音转写」的 service：无 phase 的豆包行 100% 是埋点前的转写调用（非某个未知环节）。 */
export function isDoubaoAsr(row: { service: string }): boolean {
  return row.service === 'doubao_asr'
}

/**
 * 解析一行的环节 key：优先 metadata.phase；缺失时若为豆包 ASR（唯一只做转写的 service）确定性兜底为
 * 'transcribe'，据此消灭「其他/未标注」桶（那 100% 是埋点前缺 phase 的转写行，非未知环节）。
 * 非豆包又无 phase 的行返回 undefined（千问各环节成功/失败都带 phase，正常不该有这种行）。
 * @param row  日志行（用到 metadata.phase 与 service）
 */
export function resolvePhase(row: { metadata: LogMeta; service: string }): string | undefined {
  return row.metadata?.phase ?? (isDoubaoAsr(row) ? 'transcribe' : undefined)
}

/** 把某一 UTC 时刻按东八区折算，返回该日 0 点对应的 UTC 时刻（供日界/月界计算） */
export function hkDayStartUtc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d) - HK_OFFSET_MS)
}

/** 取某 ISO 时刻在东八区的「年-月-日」桶键（月为 0-based，只用于分桶不展示） */
export function hkDayKey(iso: string): string {
  const hk = new Date(new Date(iso).getTime() + HK_OFFSET_MS)
  return `${hk.getUTCFullYear()}-${hk.getUTCMonth()}-${hk.getUTCDate()}`
}

/**
 * 今日故障归属的「环节中文名」：先走 resolvePhase 取环节 key，再经 PHASE_META 映射中文名；
 * 连 resolvePhase 都给不出环节时（非豆包、且无 metadata.phase）才用 service 兜底成可读桶名，
 * 绝不落进无意义的生 key。仅用于「今日故障按环节」分组展示。
 *
 * ⚠️【2026-08-15 修：此前与 resolvePhase 兜底不一致，同一批行在看板两处显示成两个名字】
 *   旧实现直接读 `row.metadata?.phase`，不认 resolvePhase 里那条「豆包 ASR 行缺 phase 即
 *   视为 transcribe」的规则。后果：一条缺 phase 的豆包失败行，在「今日故障按环节」显示成
 *   **「豆包 ASR」**（service 兜底），而在走 resolvePhase 的其它统计里算作 **「语音转写」**
 *   —— 同一批行、两个桶名，对不上账时没人查得出是哪一侧错。
 *   改为复用 resolvePhase 后两侧同源：豆包缺 phase 的行两处都算「语音转写」。
 *   ⚠️ 这只改**展示名归属**，不改任何计数口径与阈值。
 *
 * @param row  今日日志行（用到 metadata.phase 与 service）
 */
export function todayPhaseName(row: { metadata: LogMeta; service: string }): string {
  const phase = resolvePhase(row)
  if (phase) return PHASE_META[phase] ?? phase
  return SERVICE_META[row.service]?.name ?? row.service
}
