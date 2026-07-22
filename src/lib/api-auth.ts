/**
 * @module   api-auth
 * @desc     【仅服务端】API 路由统一鉴权 —— 从 Authorization: Bearer 头反查调用者 userId、
 *           校验 corpus 资源归属、校验管理员白名单。service_role client 完全绕过 RLS，
 *           故越权防护必须在应用层显式做。抛出的 ApiAuthError 由各路由用 authErrorResponse() 映射为 401/403。
 * @author   LingoBridge
 * @created  2026-07-11
 */
import 'server-only'
import { NextResponse } from 'next/server'
import type { AppError } from '@/types/errors'
import { env } from '@/lib/env-server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { verifyAccessToken } from '@/lib/jwt-verify'
import { logErr } from '@/lib/log'

/** 带 HTTP 状态的鉴权错误：authErrorResponse 据此映射响应；其余异常仍交回各路由原有 500 分支。 */
export type ApiAuthError = AppError & { status: 401 | 403 }

function authError(status: 401 | 403, code: string, message: string, cause?: unknown): ApiAuthError {
  return { status, code, message, cause }
}

/** 类型守卫：区分鉴权错误与业务/AI 调用错误 */
function isApiAuthError(e: unknown): e is ApiAuthError {
  if (typeof e !== 'object' || e === null) return false
  const status = (e as { status?: unknown }).status
  return (status === 401 || status === 403) && 'code' in e && 'message' in e
}

// ── 内测邮箱白名单兜底闸【临时措施·内测结束后整段删除】────────────────────────
// 主闸是 DB 触发器 enforce_beta_allowlist_trg（0023_beta_allowlist.sql），在 auth.users 写入源头硬挡；
// 本层只是兜底（挡住触发器上线前已注册、或将来触发器被误删的漏网账号），故设计上一律从宽。

/** 白名单快照缓存 TTL：60 秒。副作用——从名单【删人】最多 60 秒后生效（加人走触发器那条路、即时生效）。 */
const ALLOWLIST_TTL_MS = 60_000

/** 进程内白名单快照；enabled=false 表示「未启用」（表为空 / 含 '*' 哨兵 / 查表失败），此时全放行。 */
let allowlistCache: { at: number; enabled: boolean; emails: Set<string> } | null = null

/**
 * 读白名单快照（带 60 秒进程内缓存）。
 * @returns    { enabled, emails } enabled=false 时调用方应无条件放行
 * @sideEffect 用 service_role 读 beta_allowlist（该表 RLS 无 policy，仅 service_role 可读）
 */
async function loadAllowlist(): Promise<{ enabled: boolean; emails: Set<string> }> {
  const now = Date.now()
  if (allowlistCache && now - allowlistCache.at < ALLOWLIST_TTL_MS) return allowlistCache
  try {
    const { data, error } = await getSupabaseServer().from('beta_allowlist').select('email')
    if (error) throw error
    const rows = (data as Array<{ email: string | null }> | null) ?? []
    const emails = new Set(rows.map((r) => (r.email ?? '').trim().toLowerCase()).filter((s) => s !== ''))
    // 表为空 → 防呆兜底视为未启用；含 '*' 哨兵 → 拆除开关，视为未启用。
    const enabled = emails.size > 0 && !emails.has('*')
    allowlistCache = { at: now, enabled, emails }
    return allowlistCache
  } catch (e) {
    // ⚠️ fail-open（放行）是刻意选择，勿改成 fail-close：
    // 本层只是兜底、主闸在 DB 触发器；白名单是内测便利而非合规硬要求，
    // 兜底层故障不该让全站 403 不可用。（与 consent-server 的 fail-close 语义不同——那是合规闸。）
    // 顺带效果：「先部署代码、后跑 migration」期间表不存在也不会炸站。
    logErr('[allowlist] load failed, fail-open', e)
    return { enabled: false, emails: new Set<string>() }
  }
}

/**
 * 兜底校验邮箱在内测白名单内（匿名 / 无邮箱 / 白名单未启用 / 查表失败 一律放行）。
 * @param email        当前用户邮箱（可为 null）
 * @param isAnonymous  是否匿名会话
 * @throws             ApiAuthError(403) —— 白名单已启用且该邮箱不在名单内
 */
async function assertAllowlisted(email: string | null, isAnonymous: boolean): Promise<void> {
  if (isAnonymous) return
  const e = (email ?? '').trim().toLowerCase()
  if (e === '') return
  const { enabled, emails } = await loadAllowlist()
  if (!enabled) return
  if (!emails.has(e)) throw authError(403, 'NOT_ALLOWLISTED', '该邮箱不在内测名单')
}

/** 从 Authorization: Bearer 头取 token 并反查用户（token 缺失/无效抛 401）。内部复用，不导出。 */
async function authUser(req: Request): Promise<{ id: string; email: string | null; isAnonymous: boolean }> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw authError(401, 'UNAUTHORIZED', '未授权')
  // 本地验签（非对称 ES256 + JWKS），不再调 auth.getUser(token)——省每个登录后接口一次 香港→新加坡
  // GoTrue 往返。安全边界（不查即时吊销、靠 token 1h 过期 + 白名单兜底）见 jwt-verify.ts 顶注。
  let payload
  try {
    payload = await verifyAccessToken(token)
  } catch (e) {
    throw authError(401, 'UNAUTHORIZED', '未授权', e)
  }
  const user = { id: payload.sub, email: payload.email ?? null, isAnonymous: payload.is_anonymous ?? false }
  await assertAllowlisted(user.email, user.isAnonymous)
  return user
}

/**
 * 从 Authorization: Bearer 头取用户 access token 并反查 userId。
 * @param req  进入的请求（读 Authorization 头）
 * @returns    { userId } 当前登录用户 id
 * @throws     ApiAuthError(401) —— 缺 token 或 token 无效
 * @sideEffect 调 admin.auth.getUser(token) 校验 token（service_role client）
 */
export async function requireUser(req: Request): Promise<{ userId: string }> {
  const user = await authUser(req)
  return { userId: user.id }
}

/**
 * 放行匿名与注册用户（只挡无效 token），并把是否匿名一并返回供调用方按额度区分处理。
 * 用于保留「未注册免费试用一遍」的付费 AI 接口：匿名放行但由服务端额度约束，防脚本无限白嫖。
 * @param req  进入的请求（读 Authorization 头）
 * @returns    { userId, isAnonymous } 当前用户 id 与是否匿名会话
 * @throws     ApiAuthError(401) —— 缺 token 或 token 无效
 * @sideEffect 调 admin.auth.getUser(token) 校验 token 并读 is_anonymous（service_role client）
 */
export async function requireUserAllowAnon(req: Request): Promise<{ userId: string; isAnonymous: boolean }> {
  const user = await authUser(req)
  return { userId: user.id, isAnonymous: user.isAnonymous }
}

/**
 * 校验某 corpus（语料 / 故事）归属于 userId，杜绝越权读写他人私密日记。
 * @param userId    requireUser 反查出的当前用户 id
 * @param corpusId  待访问的 corpus id
 * @returns         Promise<void>（校验通过即返回）
 * @throws          ApiAuthError(403) —— corpus 不存在、查询出错或不属于该用户
 * @sideEffect      用 service_role 读 corpus.user_id（绕 RLS，故须在此显式比对归属）
 */
export async function assertCorpusOwner(userId: string, corpusId: string): Promise<void> {
  const { data, error } = await getSupabaseServer()
    .from('corpus')
    .select('user_id')
    .eq('id', corpusId)
    .maybeSingle()
  if (error) throw authError(403, 'FORBIDDEN', '无权访问该语料', error)
  const ownerId = (data as { user_id: string } | null)?.user_id
  if (!ownerId || ownerId !== userId) throw authError(403, 'FORBIDDEN', '无权访问该语料')
}

/**
 * 校验调用者是管理员（邮箱在 ADMIN_EMAILS 白名单内）。用于成本看板等敏感聚合接口。
 * @param req  进入的请求
 * @returns    { userId, email } 管理员账号信息
 * @throws     ApiAuthError(401) token 无效 / ApiAuthError(403) 非白名单邮箱
 * @sideEffect 调 admin.auth.getUser(token) 校验 token（service_role client）
 */
export async function requireAdmin(req: Request): Promise<{ userId: string; email: string }> {
  const user = await authUser(req)
  const email = (user.email ?? '').toLowerCase()
  const allow = env.adminEmails
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '')
  if (!email || !allow.includes(email)) throw authError(403, 'FORBIDDEN', '需要管理员权限')
  return { userId: user.id, email }
}

/**
 * 把鉴权错误映射为标准 JSON 响应；非鉴权错误返回 null（交回各路由原有 500 分支处理）。
 * @param e  catch 到的异常
 * @returns  ApiAuthError → NextResponse(401/403)；否则 null
 */
export function authErrorResponse(e: unknown): NextResponse | null {
  if (!isApiAuthError(e)) return null
  return NextResponse.json({ error: e.message }, { status: e.status })
}
