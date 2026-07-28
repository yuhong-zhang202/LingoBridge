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

// ── 令牌吊销名单 ──────────────────────────────────────────────────────────────
// 本地验签(jwt-verify)不查即时吊销，封号/删号后用户手里的 access token 靠验签仍会通过、最长活到 exp(默认1h)。
// 本层补「≤60s 吊销」：验签通过后再查 sub 是否在 revoked_users（60s 进程内缓存，几乎零开销）。

/** 吊销名单缓存 TTL：60 秒。副作用——封号/删号最多 60 秒后对所有实例生效（与白名单删人同一量级）。 */
const REVOKED_TTL_MS = 60_000

/** 进程内吊销名单快照 */
let revokedCache: { at: number; ids: Set<string> } | null = null

/**
 * 读吊销名单快照（60 秒进程内缓存）。service_role 读 revoked_users（该表 RLS 无 policy，仅 service_role 可读）。
 * fail-open：读表失败时返回空集（不吊销任何人）——瞬时 DB 故障不该让全站 401，与 loadAllowlist 同语义；
 * 吊销名单是兜底安全网，短暂失效窗口可接受（token 本身仍受 exp 限）。
 */
async function loadRevoked(): Promise<Set<string>> {
  const now = Date.now()
  if (revokedCache && now - revokedCache.at < REVOKED_TTL_MS) return revokedCache.ids
  try {
    const { data, error } = await getSupabaseServer().from('revoked_users').select('user_id')
    if (error) throw error
    const ids = new Set(((data as Array<{ user_id: string }> | null) ?? []).map((r) => r.user_id))
    revokedCache = { at: now, ids }
    return ids
  } catch (e) {
    logErr('[revoked] load failed, fail-open', e)
    return new Set<string>()
  }
}

/** 该 userId 是否已被吊销（封号/删号）。 */
async function isRevoked(userId: string): Promise<boolean> {
  return (await loadRevoked()).has(userId)
}

// ── 身份权威快照（分额度 / 白名单所依赖的 is_anonymous / email）────────────────
// 【为什么不能信 JWT 的 is_anonymous / email】这两个 claim 是【签发时快照】：匿名→注册升级
// (auth.ts updateUser 绑邮箱) 后 GoTrue 不立即换发新 token，旧 token 最长活到 exp(≈1h) 才带新值。
// 窗口内注册用户带旧 token 请求 → 服务端读到 is_anonymous:true → 误走匿名闸(ANON_CORPUS_LIMIT=1)
// → 讲完第 1 个故事、建第 2 个即 402（阻断级 bug）。故【按额度区分身份 / 白名单判邮箱】所依赖的
// is_anonymous / email 必须查权威实时源(auth.admin.getUserById 读 auth.users)，不取 payload 的陈旧 claim。
// 【陷阱】不能改用 JWT 的 email claim 判注册——旧 token 里 email 同为 null、同源陈旧、同样误判。
// 沿用 revoked / allowlist 的进程内短 TTL 缓存范式，避免每请求一次「香港→新加坡」GoTrue 往返。
// ⚠️ 本层只改「is_anonymous / email 的取值来源」，不碰吊销、越权、requireRegistered 拒匿名等其它判定。

/** 身份快照缓存 TTL：30 秒。副作用——匿名→注册升级最多 30 秒后被服务端识别（配 auth.ts 重签近乎即时）。 */
const IDENTITY_TTL_MS = 30_000
/** 进程内身份快照上限：超过则清理过期项，防单实例长跑内存无界增长（内测量级远够不到，仅护栏）。 */
const IDENTITY_CACHE_MAX = 5_000

/** 进程内身份快照：userId → { at, email, isAnonymous } */
const identityCache = new Map<string, { at: number; email: string | null; isAnonymous: boolean }>()

/**
 * 读某 userId 的权威身份（is_anonymous / email），带 30 秒进程内缓存。
 * 用 service_role 调 auth.admin.getUserById 读 auth.users 实时状态，取代 JWT 里可能陈旧的同名 claim。
 * @param userId    验签得到的 sub
 * @param fallback  取库失败时的兜底值（传入 JWT 的 claim）——fail-back 到 token claim = 回退到本改动前的
 *                  行为，【不放大任何权限】（吊销/越权/白名单各闸仍独立生效）；瞬时 GoTrue 故障不该让全站不可用。
 * @returns         { email, isAnonymous } 权威值（失败时为 fallback）
 * @sideEffect      service_role 调 GoTrue admin API 读 auth.users
 */
async function loadIdentity(
  userId: string,
  fallback: { email: string | null; isAnonymous: boolean },
): Promise<{ email: string | null; isAnonymous: boolean }> {
  const now = Date.now()
  const cached = identityCache.get(userId)
  if (cached && now - cached.at < IDENTITY_TTL_MS) {
    // 单向短路（关「注册后 ≤TTL 误判窗口」）：缓存说「匿名」但新 token 的 claim 已是「注册」——
    // 匿名→注册单调不可逆、claim 经 ES256 验签不可伪造，说明升级刚完成、缓存是旧快照 → 绕过缓存
    // 走下方权威查询刷新。反方向（缓存注册、claim 匿名）不短路：旧匿名 token 不该把人降级。
    const staleAnon = cached.isAnonymous && !fallback.isAnonymous
    if (!staleAnon) {
      return { email: cached.email, isAnonymous: cached.isAnonymous }
    }
  }
  try {
    const { data, error } = await getSupabaseServer().auth.admin.getUserById(userId)
    if (error) throw error
    const u = data.user
    if (!u) throw new Error('getUserById 未返回用户')
    // is_anonymous 字段缺失（某些 GoTrue 版本可能不返回）时【回退 token claim】而非默认 false：
    // 默认 false 会把全体判成注册 → 真匿名者绕过注册专属闸（反向洞，security-auditor Q2）。
    // 回退 claim：真匿名的 claim 恒 true → 仍判匿名、不放权；正常情况字段存在时照用权威值。
    const identity = {
      email: u.email ?? null,
      isAnonymous: u.is_anonymous ?? fallback.isAnonymous,
    }
    if (identityCache.size >= IDENTITY_CACHE_MAX) {
      for (const [k, v] of identityCache) if (now - v.at >= IDENTITY_TTL_MS) identityCache.delete(k)
    }
    identityCache.set(userId, { at: now, ...identity })
    return identity
  } catch (e) {
    logErr('[identity] getUserById failed, fall back to token claims', e)
    return fallback
  }
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
  // 分额度 / 白名单所依赖的 is_anonymous / email 取权威实时源（见 loadIdentity 注释）：JWT 同名 claim 是
  // 签发快照，匿名→注册升级后约 1h 才刷新，窗口内会把注册用户误判为匿名、错走匿名闸。取库失败 fail-back
  // 到 token claim（= 本改动前行为）。其余判定（吊销 / 越权 / requireRegistered 拒匿名）一律不变。
  const { email, isAnonymous } = await loadIdentity(payload.sub, {
    email: payload.email ?? null,
    isAnonymous: payload.is_anonymous ?? false,
  })
  const user = { id: payload.sub, email, isAnonymous }
  // 即时吊销兜底：验签只证 token 未伪造/未过期，查不到「封号/删号」；这里补查吊销名单（≤60s 生效）。
  if (await isRevoked(user.id)) throw authError(401, 'UNAUTHORIZED', '会话已失效')
  await assertAllowlisted(user.email, user.isAnonymous)
  return user
}

/**
 * 从 Authorization: Bearer 头取用户 access token 并反查 userId。
 * @param req  进入的请求（读 Authorization 头）
 * @returns    { userId } 当前登录用户 id
 * @throws     ApiAuthError(401) —— 缺 token 或 token 无效
 * @sideEffect 本地验签 access token（verifyAccessToken，ES256+JWKS），再用 service_role 查权威身份（getUserById）/ 吊销名单 / 内测白名单
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
 * @sideEffect 本地验签 access token（verifyAccessToken），再用 service_role 查权威身份（getUserById 读 is_anonymous）/ 吊销名单 / 白名单
 */
export async function requireUserAllowAnon(req: Request): Promise<{ userId: string; isAnonymous: boolean }> {
  const user = await authUser(req)
  return { userId: user.id, isAnonymous: user.isAnonymous }
}

/**
 * 「注册专属」端点鉴权：在 requireUser 基础上【显式拒绝匿名会话】。
 * 为什么单独一个 helper 而非改 requireUser：requireUser 目前对匿名放行是【全站默认】，别的付费接口
 * 靠它保留「未注册免费试用一遍」（匿名放行 + 服务端额度约束）。Anki 卡是跨天 SRS 资产、档位依赖用户
 * 目标分，产品方拍板「注册专属」，故只在 Anki 端点用本 helper 强制拒匿名，绝不改动全站 requireUser 行为。
 * @param req  进入的请求（读 Authorization 头）
 * @returns    { userId } 当前【注册】用户 id
 * @throws     ApiAuthError(401) —— 缺 token / token 无效 / 匿名会话（注册专属，匿名不适用）
 * @sideEffect 调 authUser 校验 token 并读 is_anonymous（service_role client）
 */
export async function requireRegistered(req: Request): Promise<{ userId: string }> {
  const user = await authUser(req)
  if (user.isAnonymous) throw authError(401, 'REGISTRATION_REQUIRED', '该功能仅限注册用户')
  return { userId: user.id }
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
 * @sideEffect 本地验签 access token（verifyAccessToken），再用 service_role 查权威身份（getUserById 读 email）/ 吊销名单 / 内测白名单
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
