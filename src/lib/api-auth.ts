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

/** 从 Authorization: Bearer 头取 token 并反查用户（token 缺失/无效抛 401）。内部复用，不导出。 */
async function authUser(req: Request): Promise<{ id: string; email: string | null; isAnonymous: boolean }> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw authError(401, 'UNAUTHORIZED', '未授权')
  const { data, error } = await getSupabaseServer().auth.getUser(token)
  if (error || !data.user) throw authError(401, 'UNAUTHORIZED', '未授权', error)
  return { id: data.user.id, email: data.user.email ?? null, isAnonymous: data.user.is_anonymous ?? false }
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
 * 校验调用者是「已注册」用户（非匿名会话）。用于付费 AI 接口：anon key 公开 + signInAnonymously
 * 可用，匿名 token 也能通过 requireUser，故须在此额外挡掉匿名会话，防脚本化无限调用烧钱。
 * @param req  进入的请求（读 Authorization 头）
 * @returns    { userId } 当前已注册用户 id
 * @throws     ApiAuthError(401) —— 缺 token 或 token 无效
 * @throws     ApiAuthError(403) —— 会话为匿名（尚未注册账号）
 * @sideEffect 调 admin.auth.getUser(token) 校验 token 并读 is_anonymous（service_role client）
 */
export async function requireRegisteredUser(req: Request): Promise<{ userId: string }> {
  const user = await authUser(req)
  if (user.isAnonymous) throw authError(403, 'FORBIDDEN', '请先注册账号后使用')
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
