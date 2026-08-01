/**
 * @module   api/events
 * @desc     POST 接口：客户端埋点事件上报的唯一入口（当前只收 match.view_rendered）。
 *           客户端不能直连 flow_events（RLS 无 insert 策略），必须经此端点由服务端 service_role 落库。
 *           props 服务端按白名单收敛为「计数 + 布尔」，防客户端塞进任何原文——隐私铁律。
 * @author   LingoBridge
 * @created  2026-07-17
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { logEvent } from '@/lib/events'

/** view_rendered 允许上报的字段白名单（全为计数/布尔，无原文）。服务端据此重建 props，丢弃其余一切。 */
const VIEW_RENDERED_NUMERIC = ['candidateCount', 'highCount', 'midCount', 'visibleCount', 'unscoredCount'] as const
const VIEW_RENDERED_BOOL = ['noMatch', 'globalNoneVisible'] as const

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

/** question_opened 白名单·正整数 1..10000：rank 1-based 排位 / candidateCount 列表总数（均无原文）。 */
const QUESTION_OPENED_NUMERIC = ['rank', 'candidateCount'] as const
/** dwellMs 上限 = 30 分钟（毫秒）。超过即视作离散脏数据（开着标签页离开等），丢弃。 */
const DWELL_MS_MAX = 30 * 60 * 1000

/**
 * 从客户端 props 里只挑白名单字段并强制类型（沿用 sanitizeViewRendered 同款「挑白名单 + 丢非法」风格）：
 *   · rank / candidateCount：有限正整数 1..10000；
 *   · dwellMs：用户在匹配页的【活跃浏览时长】(ms)，有限整数 0..30min（0 允许=一眼即点；口径见客户端）。
 * 非法值（负数 / 非整数 / 非数字 / 超大值）一律丢弃、不抛错。
 * @param raw  客户端上报的 props（unknown）
 * @returns    收敛后的安全 props
 */
function sanitizeQuestionOpened(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (typeof raw !== 'object' || raw === null) return out
  const o = raw as Record<string, unknown>
  for (const k of QUESTION_OPENED_NUMERIC) {
    const v = o[k]
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10000) out[k] = v
  }
  const dwell = o.dwellMs
  if (typeof dwell === 'number' && Number.isInteger(dwell) && dwell >= 0 && dwell <= DWELL_MS_MAX) out.dwellMs = dwell
  return out
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireUserAllowAnon(req)
    const body = (await req.json()) as { event?: unknown; storyId?: unknown; props?: unknown }
    // 只接受两个客户端事件：match.view_rendered（所见计数）/ match.question_opened（选题排位）。
    // 服务端事件（match.result / flow.corpus_bound）不经此端点。各事件走各自 sanitize，只放行白名单字段。
    const event = body.event
    if (event !== 'match.view_rendered' && event !== 'match.question_opened') {
      return NextResponse.json({ error: '不支持的事件' }, { status: 400 })
    }
    const props = event === 'match.view_rendered'
      ? sanitizeViewRendered(body.props)
      : sanitizeQuestionOpened(body.props)
    const storyId = typeof body.storyId === 'string' && body.storyId.trim() ? body.storyId.trim() : null
    const flowId = req.headers.get('x-flow-id')
    // event 已收窄为两个字面量，均属 FlowEventName（0050 已把 match.question_opened 补进该联合），无需 cast。
    await logEvent({
      event,
      flowId,
      storyId,
      userId,
      props,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[events API]', e)
    return NextResponse.json({ error: '上报失败' }, { status: 500 })
  }
}
