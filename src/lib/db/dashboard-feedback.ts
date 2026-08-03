/**
 * @module   db/dashboard-feedback
 * @desc     【仅服务端】看板「有新反馈吗」待办清单的读取帮手 —— 与 dashboard-metrics 同范式，
 *           独立于 api/dashboard/route.ts 以守 <1000 行红线（ENGINEERING.md §1，route 已 900+ 行）。
 *           返回：未处理全量（handled_at is null，created_at 倒序）+ 已处理最近 20 条（handled_at 倒序）。
 *           迁移 0055 未跑（handled_at 列不存在，Postgres 42703）时优雅降级为「近 7 天全部反馈」；
 *           读表异常也只置 loadFailed，绝不 reject 拖垮主看板。
 *           ⚠️ context.email 是用户主动留的 PII：只进管理员接口返回体，本模块日志严禁输出任何行内容。
 *           完整 user_id 不出接口——服务端截前 8 位（userIdShort）后返回。
 * @author   LingoBridge
 * @created  2026-08-03
 */
import 'server-only'
import type { getSupabaseServer } from '@/lib/supabase-server'
import { logErr } from '@/lib/log'

/** service_role 客户端类型（route 传入；feedback 表无管理员 select 策略，只有 service_role 读得到） */
type SupabaseServer = ReturnType<typeof getSupabaseServer>

/** feedback 行的最小读取形状（context 为 jsonb，只取看板要展示的四键；handled_at 仅新 schema 有） */
type FeedbackRow = {
  id: string
  user_id: string
  kind: string
  message: string
  context: { category?: unknown; route?: unknown; email?: unknown; errorMessage?: unknown } | null
  created_at: string
  handled_at?: string | null
}

/** 看板消费的单条反馈：user_id 已被服务端截为前 8 位，完整 id 不出接口 */
export type DashboardFeedbackItem = {
  id: string
  kind: 'crash' | 'manual'
  message: string
  category: string | null
  route: string | null
  email: string | null
  errorMessage: string | null
  created_at: string
  handled_at: string | null
  userIdShort: string
}

/** 看板返回体的 feedback 字段结构 */
export type DashboardFeedback = {
  /** false = 迁移 0055 未跑（handled_at 列不存在）：unhandled 实为近 7 天全部反馈、handled 恒空，前端退化只读 */
  handledSupported: boolean
  unhandled: DashboardFeedbackItem[]
  handled: DashboardFeedbackItem[]
  /** 未处理条数（S2 结论条的备用字段，本轮前端直接用 unhandled.length 也一致） */
  unhandledCount: number
  /** 已处理总数（handled 只回最近 20 条，「历史 N 条」的 N 必须另数，不能拿截断后的 20 冒充） */
  handledCount: number
  /** true = 连降级查询也失败（读表异常）：前端显「加载失败」而非误导性的空态「还没有人提过反馈」 */
  loadFailed: boolean
}

/** 含 handled_at 的列清单（迁移 0055 之后的 schema） */
const COLS_WITH_HANDLED = 'id, user_id, kind, message, context, created_at, handled_at'
/** 不含 handled_at 的列清单（降级路径：迁移未跑时的旧 schema） */
const COLS_BASE = 'id, user_id, kind, message, context, created_at'

// 未处理列表按口径是「全量」：内测反馈量在个位数，但 PostgREST 对裸查静默截断到 1000 行（见
// dashboard route 顶注教训），这里给一个显式防御上限——触到它说明反馈积压已经离谱，该先去处理反馈。
const UNHANDLED_LIMIT = 500
/** 已处理只回最近 N 条（历史归档，看板不需要全量） */
const HANDLED_LIMIT = 20
/** 降级路径（迁移未跑）回近 7 天全部反馈 */
const LEGACY_WINDOW_DAYS = 7

/**
 * 该错误是否为「handled_at 列不存在」（迁移 0055 未跑）。
 * Postgres undefined_column 固定错误码 42703，PostgREST 会原样透传；再校验 message 提到 handled_at，
 * 避免把 select 里其它列名打错的 42703 也误判成「待迁移」。
 * @param err  supabase 查询返回的 error（形状不可信，按 unknown 收窄）
 * @returns    true = 列不存在，调用方应走降级 / 返回「待迁移」错误码
 */
export function isMissingHandledColumn(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { code, message } = err as { code?: unknown; message?: unknown }
  return code === '42703' && typeof message === 'string' && message.includes('handled_at')
}

/**
 * 一行 feedback → 看板条目：context 四键逐一收窄（jsonb 内容不可信），user_id 截前 8 位。
 * @param row  feedback 行
 */
function toItem(row: FeedbackRow): DashboardFeedbackItem {
  const ctx = row.context ?? {}
  return {
    id: row.id,
    kind: row.kind === 'crash' ? 'crash' : 'manual',
    message: row.message,
    category: typeof ctx.category === 'string' ? ctx.category : null,
    route: typeof ctx.route === 'string' ? ctx.route : null,
    email: typeof ctx.email === 'string' ? ctx.email : null,
    errorMessage: typeof ctx.errorMessage === 'string' ? ctx.errorMessage : null,
    created_at: row.created_at,
    handled_at: row.handled_at ?? null,
    userIdShort: row.user_id.slice(0, 8),
  }
}

/**
 * 降级路径（迁移 0055 未跑）：不碰 handled_at 列，回近 7 天全部反馈当未处理列表。
 * 出错直接抛给调用方外层 catch（那里统一置 loadFailed），不在此处吞。
 * @param supabase  service_role 客户端
 */
async function fetchWithoutHandledColumn(supabase: SupabaseServer): Promise<DashboardFeedback> {
  const since = new Date(Date.now() - LEGACY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('feedback')
    .select(COLS_BASE)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(UNHANDLED_LIMIT)
  if (error) throw error
  const unhandled = ((data ?? []) as FeedbackRow[]).map(toItem)
  return {
    handledSupported: false,
    unhandled,
    handled: [],
    unhandledCount: unhandled.length,
    handledCount: 0,
    loadFailed: false,
  }
}

/**
 * 取看板「有新反馈吗」区块的全部数据（未处理全量 + 已处理最近 20 条 + 已处理总数）。
 * 三态降级：正常 → 列不存在走近 7 天只读降级 → 读表异常置 loadFailed；任何一态都不让主看板 500。
 * @param supabase  service_role 客户端（feedback 表 RLS 仅本人可读，管理员聚合必须绕 RLS）
 * @returns         DashboardFeedback（见类型注释）
 * @sideEffect      service_role 读 feedback 表；失败时打错误日志（只记异常本身，不含任何反馈内容/PII）
 */
export async function fetchDashboardFeedback(supabase: SupabaseServer): Promise<DashboardFeedback> {
  try {
    const [unhandledRes, handledRes, countRes] = await Promise.all([
      supabase
        .from('feedback')
        .select(COLS_WITH_HANDLED)
        .is('handled_at', null)
        .order('created_at', { ascending: false })
        .limit(UNHANDLED_LIMIT),
      supabase
        .from('feedback')
        .select(COLS_WITH_HANDLED)
        .not('handled_at', 'is', null)
        .order('handled_at', { ascending: false })
        .limit(HANDLED_LIMIT),
      // 已处理总数：head:true 只要 count 不拉行，「历史 N 条」的 N 用它、不用被截断的 20
      supabase
        .from('feedback')
        .select('id', { count: 'exact', head: true })
        .not('handled_at', 'is', null),
    ])
    const err = unhandledRes.error ?? handledRes.error ?? countRes.error
    if (err) {
      if (isMissingHandledColumn(err)) return await fetchWithoutHandledColumn(supabase)
      throw err
    }
    const unhandled = ((unhandledRes.data ?? []) as FeedbackRow[]).map(toItem)
    const handled = ((handledRes.data ?? []) as FeedbackRow[]).map(toItem)
    return {
      handledSupported: true,
      unhandled,
      handled,
      unhandledCount: unhandled.length,
      handledCount: countRes.count ?? handled.length,
      loadFailed: false,
    }
  } catch (e) {
    // 只记异常本身：message/context/email 是用户内容与 PII，日志红线（见 db/feedback.ts 同款约定）
    logErr('[dashboard feedback] 读取失败（日志不含反馈内容）', e)
    return { handledSupported: false, unhandled: [], handled: [], unhandledCount: 0, handledCount: 0, loadFailed: true }
  }
}
