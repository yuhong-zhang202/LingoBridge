/**
 * @module   api/events
 * @desc     POST 接口：客户端埋点事件上报的唯一入口（match.* 与 flow.* 共 8 个客户端事件）。
 *           客户端不能直连 flow_events（RLS 无 insert 策略），必须经此端点由服务端 service_role 落库。
 *           props 服务端按白名单收敛为「枚举串 + 整数 + 布尔」，防客户端塞进任何原文——隐私铁律。
 *
 *   ⚠️ migration 0053 把 DB 的 event CHECK 由枚举白名单放宽成了前缀正则，
 *   故【本文件的 EVENT_SPECS 分发表是事件名唯一的真闸】：查表未命中一律 400，绝不许放行落库。
 *   同理，绝不许写「所有整数字段一律放行」的通用 sanitize —— 那等于把 props 变成客户端可控的自由 key 空间。
 *
 *   ⚠️ 各字段的取值域白名单一律【从 lib/event-schema.ts import】，本文件不再手抄一份 ——
 *   抄错一个值 = 客户端发得好好的、服务端静默丢弃该字段，本地测不出来。
 *   但校验【只在服务端做】：客户端类型再严也只是编译期约束，请求体永远当作不可信输入逐字段收敛。
 *
 * @author   LingoBridge
 * @created  2026-07-17
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { logEvent, type FlowEventName } from '@/lib/events'
import { isQaRequest } from '@/lib/qa-traffic'
import {
  STORY_ENTRY, STORY_MODE, MIC_RESULT, MIC_SURFACE, CAPTURE_MODE, CAPTURE_OUTCOME,
  CAPTURE_EXIT, AI_STAGE, AI_RESULT,
  VIEW_RENDERED_NUMERIC, VIEW_RENDERED_BOOL, QUESTION_OPENED_NUMERIC,
} from '@/lib/event-schema'

/**
 * 从客户端 props 里只挑白名单字段并强制类型：数字字段取有限数、布尔字段取布尔，其余一律丢弃。
 * 这样即便客户端塞了原文/多余字段也进不了库。
 * @param raw  客户端上报的 props（unknown）
 * @returns    收敛后的安全 props
 */
function sanitizeViewRendered(raw: unknown): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {}
  if (typeof raw !== 'object' || raw === null) return out
  const o = raw as Record<string, unknown>
  for (const k of VIEW_RENDERED_NUMERIC) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  for (const k of VIEW_RENDERED_BOOL) {
    const v = o[k]
    if (typeof v === 'boolean') out[k] = v
  }
  return out
}

/** dwellMs 上限 = 30 分钟（毫秒）。超过即视作离散脏数据（开着标签页离开等），丢弃。 */
const DWELL_MS_MAX = 30 * 60 * 1000
/** questionId 白名单校验：标准 UUID v1-v5 格式（题目主键），非此形态一律丢弃——只是内部 id 引用、无原文。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * algoVersion 白名单校验：短枚举串（形如 'v1-2026-07-17'）。收敛为「首字母数字 + 仅 [a-z0-9._-]、≤32 字符」，
 * 杜绝任何自由文本/原文经此字段混入。只放行这一固定形态，不放开通用字符串字段（隐私铁律）。
 */
const ALGO_VERSION_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/i

/**
 * 从客户端 props 里只挑白名单字段并强制类型（沿用 sanitizeViewRendered 同款「挑白名单 + 丢非法」风格）：
 *   · rank / candidateCount：有限正整数 1..10000；
 *   · dwellMs：用户在匹配页的【活跃浏览时长】(ms)，有限整数 0..30min（0 允许=一眼即点；口径见客户端）；
 *   · questionId：题目 UUID（严格 UUID 格式，仅内部 id 引用，无原文）；
 *   · algoVersion：排序算法版本短枚举串（≤32 字符、仅 [a-z0-9._-]，无原文）。
 * 非法值（负数 / 非整数 / 非数字 / 超大值 / 非 UUID / 非枚举形态）一律丢弃、不抛错。
 * @param raw  客户端上报的 props（unknown）
 * @returns    收敛后的安全 props（数字字段 + questionId/algoVersion 字符串字段）
 */
function sanitizeQuestionOpened(raw: unknown): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  if (typeof raw !== 'object' || raw === null) return out
  const o = raw as Record<string, unknown>
  for (const k of QUESTION_OPENED_NUMERIC) {
    const v = o[k]
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10000) out[k] = v
  }
  const dwell = o.dwellMs
  if (typeof dwell === 'number' && Number.isInteger(dwell) && dwell >= 0 && dwell <= DWELL_MS_MAX) out.dwellMs = dwell
  const qid = o.questionId
  if (typeof qid === 'string' && UUID_RE.test(qid)) out.questionId = qid
  const algo = o.algoVersion
  if (typeof algo === 'string' && ALGO_VERSION_RE.test(algo)) out.algoVersion = algo
  return out
}

// ── 通用取值原语（P0/P1 六个新事件共用；只有这三种形态，不存在「通用放行」）──────────────

/** 把 unknown 收敛成可按 key 取值的对象；非对象一律当空对象（后续每个字段都取不到 → 全丢）。 */
function asObject(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
}

/**
 * 取枚举字段：必须是字符串且【全等】命中白名单之一。
 * 刻意不 trim、不转小写：'Proceed' / 'proceed ' 一律丢弃 —— 容错会让口径悄悄多出几个变体值，
 * 事后分组统计时才发现，比直接丢更难查。
 * @param  o        props 对象
 * @param  key      字段名
 * @param  allowed  允许值白名单
 * @returns         命中的枚举值，否则 undefined
 */
function pickEnum<T extends string>(o: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined {
  const v = o[key]
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

/**
 * 取整数字段：必须是有限整数且落在 [min, max] 闭区间。负数/小数/字符串数字/NaN/Infinity/超界一律丢弃。
 * @param  o    props 对象
 * @param  key  字段名
 * @param  min  下界（含）
 * @param  max  上界（含）
 * @returns     合法整数，否则 undefined
 */
function pickInt(o: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  const v = o[key]
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined
}

// ── P0/P1 六个新客户端事件的 sanitize（一事件一函数，字段逐个显式列出）───────────────────

// 各事件的枚举白名单（STORY_ENTRY / MIC_SURFACE / CAPTURE_OUTCOME / AI_RESULT 等）已上移至
// lib/event-schema.ts 并在文件顶部 import —— 服务端校验用的就是客户端类型所依据的那一份，不存在抄错。

/** 采集时长上限 = 1 小时（秒）；字数上限 10 万字。超界即脏数据，丢弃。 */
const DURATION_SEC_MAX = 3600
const CHAR_COUNT_MAX = 100000
/** AI 调用耗时上限 = 10 分钟（毫秒）；httpStatus 上界取 599（网络/超时等无状态码的场景不带此字段）。 */
const LATENCY_MS_MAX = 600000
const HTTP_STATUS_MAX = 599

/** 收敛后的安全 props（三种标量，无自由文本字段） */
type SafeProps = Record<string, number | boolean | string>

/**
 * flow.story_entry：用户从哪个入口开始一次故事。
 * @param  raw  客户端上报的 props
 * @returns     entry(枚举) + mode(枚举)
 */
function sanitizeStoryEntry(raw: unknown): SafeProps {
  const o = asObject(raw)
  const out: SafeProps = {}
  const entry = pickEnum(o, 'entry', STORY_ENTRY)
  if (entry !== undefined) out.entry = entry
  const mode = pickEnum(o, 'mode', STORY_MODE)
  if (mode !== undefined) out.mode = mode
  return out
}

/**
 * flow.mic_permission：麦克风授权结果 + 发生在哪个界面。
 * @param  raw  客户端上报的 props
 * @returns     result(枚举) + surface(枚举)
 */
function sanitizeMicPermission(raw: unknown): SafeProps {
  const o = asObject(raw)
  const out: SafeProps = {}
  const result = pickEnum(o, 'result', MIC_RESULT)
  if (result !== undefined) out.result = result
  const surface = pickEnum(o, 'surface', MIC_SURFACE)
  if (surface !== undefined) out.surface = surface
  return out
}

/**
 * flow.capture_started：开始采集（按下录音 / 进入文字输入）。
 * @param  raw  客户端上报的 props
 * @returns     mode(枚举)
 */
function sanitizeCaptureStarted(raw: unknown): SafeProps {
  const o = asObject(raw)
  const out: SafeProps = {}
  const mode = pickEnum(o, 'mode', CAPTURE_MODE)
  if (mode !== undefined) out.mode = mode
  return out
}

/**
 * flow.capture_submitted：采集提交及其结局（放行 / 被各类闸挡下）。
 * @param  raw  客户端上报的 props
 * @returns     mode + outcome(枚举) + durationSec/charCount(整数)
 */
function sanitizeCaptureSubmitted(raw: unknown): SafeProps {
  const o = asObject(raw)
  const out: SafeProps = {}
  const mode = pickEnum(o, 'mode', CAPTURE_MODE)
  if (mode !== undefined) out.mode = mode
  const outcome = pickEnum(o, 'outcome', CAPTURE_OUTCOME)
  if (outcome !== undefined) out.outcome = outcome
  const durationSec = pickInt(o, 'durationSec', 0, DURATION_SEC_MAX)
  if (durationSec !== undefined) out.durationSec = durationSec
  const charCount = pickInt(o, 'charCount', 0, CHAR_COUNT_MAX)
  if (charCount !== undefined) out.charCount = charCount
  return out
}

/**
 * flow.capture_abandoned：采集中途放弃（导航离开 / 页面卸载）。
 * @param  raw  客户端上报的 props
 * @returns     mode + exit(枚举) + durationSec/charCount(整数)
 */
function sanitizeCaptureAbandoned(raw: unknown): SafeProps {
  const o = asObject(raw)
  const out: SafeProps = {}
  const mode = pickEnum(o, 'mode', CAPTURE_MODE)
  if (mode !== undefined) out.mode = mode
  const exit = pickEnum(o, 'exit', CAPTURE_EXIT)
  if (exit !== undefined) out.exit = exit
  const durationSec = pickInt(o, 'durationSec', 0, DURATION_SEC_MAX)
  if (durationSec !== undefined) out.durationSec = durationSec
  const charCount = pickInt(o, 'charCount', 0, CHAR_COUNT_MAX)
  if (charCount !== undefined) out.charCount = charCount
  return out
}

/**
 * flow.ai_call：一次 AI 调用的阶段 / 结局 / HTTP 状态 / 耗时。
 * @param  raw  客户端上报的 props
 * @returns     stage + result + mode(枚举) + httpStatus/latencyMs(整数)
 */
function sanitizeAiCall(raw: unknown): SafeProps {
  const o = asObject(raw)
  const out: SafeProps = {}
  const stage = pickEnum(o, 'stage', AI_STAGE)
  if (stage !== undefined) out.stage = stage
  const result = pickEnum(o, 'result', AI_RESULT)
  if (result !== undefined) out.result = result
  const httpStatus = pickInt(o, 'httpStatus', 0, HTTP_STATUS_MAX)
  if (httpStatus !== undefined) out.httpStatus = httpStatus
  const latencyMs = pickInt(o, 'latencyMs', 0, LATENCY_MS_MAX)
  if (latencyMs !== undefined) out.latencyMs = latencyMs
  const mode = pickEnum(o, 'mode', CAPTURE_MODE)
  if (mode !== undefined) out.mode = mode
  return out
}

/**
 * 客户端可上报事件的分发表 —— 事件名唯一的真闸（0053 起 DB CHECK 已放宽为前缀正则，不再兜底）。
 * key = 客户端传来的事件名字符串；value = 已收窄的 FlowEventName + 该事件专属 sanitize。
 * 服务端自发事件（match.result / flow.corpus_bound / flow.consent_granted）不在表中，不接受客户端上报。
 */
interface EventSpec {
  event: FlowEventName
  sanitize: (raw: unknown) => SafeProps
}
const EVENT_SPECS: ReadonlyMap<string, EventSpec> = new Map<string, EventSpec>([
  ['match.view_rendered',    { event: 'match.view_rendered',    sanitize: sanitizeViewRendered }],
  ['match.question_opened',  { event: 'match.question_opened',  sanitize: sanitizeQuestionOpened }],
  ['flow.story_entry',       { event: 'flow.story_entry',       sanitize: sanitizeStoryEntry }],
  ['flow.mic_permission',    { event: 'flow.mic_permission',    sanitize: sanitizeMicPermission }],
  ['flow.capture_started',   { event: 'flow.capture_started',   sanitize: sanitizeCaptureStarted }],
  ['flow.capture_submitted', { event: 'flow.capture_submitted', sanitize: sanitizeCaptureSubmitted }],
  ['flow.capture_abandoned', { event: 'flow.capture_abandoned', sanitize: sanitizeCaptureAbandoned }],
  ['flow.ai_call',           { event: 'flow.ai_call',           sanitize: sanitizeAiCall }],
])

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireUserAllowAnon(req)
    // body 解析【单独】try：本端点任意客户端可调，非法 JSON / 空 body / body:null 是【客户端错误】，
    // 落进外层 catch 会记成 logErr + 500 —— 既污染服务端错误告警，也给了「随便发脏包刷错误日志」的口子。
    // 解析失败一律 400 且不写 logErr；其余错误路径（鉴权 / 落库失败）保持原样走外层 catch。
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
    }
    // JSON 合法但不是对象（body 为 null / 数字 / 字符串）同样是客户端错误，走同一条 400。
    if (typeof raw !== 'object' || raw === null) {
      return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
    }
    const body = raw as { event?: unknown; storyId?: unknown; props?: unknown }
    // 查表分发：未注册的事件名立即 400、不落库。这是唯一的事件名闸门，绝不可改成「未知事件也放行」。
    const spec = typeof body.event === 'string' ? EVENT_SPECS.get(body.event) : undefined
    if (!spec) {
      return NextResponse.json({ error: '不支持的事件' }, { status: 400 })
    }
    const props = spec.sanitize(body.props)
    const storyId = typeof body.storyId === 'string' && body.storyId.trim() ? body.storyId.trim() : null
    const flowId = req.headers.get('x-flow-id')
    await logEvent({
      event: spec.event,
      flowId,
      storyId,
      userId,
      props,
      isQa: isQaRequest(req, userId),
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[events API]', e)
    return NextResponse.json({ error: '上报失败' }, { status: 500 })
  }
}
