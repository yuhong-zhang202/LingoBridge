/**
 * @module   auth
 * @desc     邮箱 + 密码登录（不发任何验证码）—
 *           注册 = updateUser({ email, password }) 升级当前匿名账号，user_id 不变保住试用数据；
 *           登录 = signInWithPassword；忘记密码 = resetPasswordForEmail + updatePassword。
 *           日志严禁出现邮箱/密码。
 * @author   LingoBridge
 * @created  2026-06-17
 */
import type { AppError } from '@/types/errors'
import { getSupabase, ensureSession } from '@/lib/supabase'
import { clearConsentCache } from '@/lib/consent'
import { clearFlowId } from '@/lib/flow-id'
import { clearAuthCache, track } from '@/lib/client-events'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN = 6
/** 昵称最长字符数（超出截断）；空串保存视为清除昵称、回退打码邮箱 */
const DISPLAY_NAME_MAX = 20

function appError(code: string, message: string, cause?: unknown): AppError {
  return { code, message, cause }
}

/** 脱敏邮箱 — 首字符 + *** + @域名；无 @ 原样返回。 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return email
  return `${email[0]}***${email.slice(at)}`
}

/**
 * 无自定义昵称时的默认展示名：由 seed（打码邮箱等稳定串）派生的「用户」+ 六位数字。
 * 纯展示、不落库；同一账号每次渲染都得到相同结果（非真随机，避免刷新后跳变）。
 * @param seed 稳定标识串（如打码邮箱）；为空返回不带数字的「用户」
 * @returns    形如「用户482913」的默认昵称
 */
export function defaultNickname(seed: string | null): string {
  if (!seed) return '用户'
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  return `用户${String(h % 1_000_000).padStart(6, '0')}`
}

// ── 内测邮箱白名单文案映射【临时措施·内测结束后连同 0023 migration 一起删除】────────
//
// ⚠️ 历史方案已被实测证伪，勿回退：
//   0023_beta_allowlist.sql 的注释假设「raise exception 的消息里带稳定关键词 BETA_ALLOWLIST_DENIED，
//   供前端匹配」。qa-engineer 于 2026-07-19 在生产环境把真实错误对象整体打印后确认，
//   GoTrue 会把 DB 异常原文【整个吞掉】，前端拿到的只有：
//     { name:'AuthApiError', message:'Database error saving new user',
//       status:500, code:'unexpected_failure' }
//   自有属性仅 stack/message/__isAuthError/name/status/code —— 关键词在任何字段里都不存在。
//   注册（updateUser 绑邮箱）与登录两条路径皆如此。故关键词匹配恒为 false，被挡的人
//   只会看到「Database error saving new user」。
//
// 现方案（产品方 2026-07-19 拍板·方案 A）：改看 status + code，零后端改动。
//   白名单启用期间，注册/登录场景下的 500 + unexpected_failure 几乎必然就是白名单拒绝。
//
// ⚠️ 已知误伤 + 知情取舍：真正的数据库故障（连接池打满、磁盘满等）同样会命中 500/unexpected_failure，
//   被误判成「不在名单」。故文案刻意写成【兼容措辞】——同时给出「不在名单→联系我们」与
//   「确认已受邀→稍后重试」两条出路，任一真因下都不误导用户。这是明知而为的取舍，不是疏漏。
//
// ⚠️ 拆白名单时，本段整体删除（含 isAllowlistDenied 及其两处调用点），
//   不要只删 0023 而把这段映射留下——留下就等于把普通 DB 故障永久说成「不在内测名单」。

/** 触发器拒绝时 GoTrue 实际回给前端的 HTTP 状态（DB 异常一律包成 500）。 */
const ALLOWLIST_DENIED_STATUS = 500
/** 触发器拒绝时 GoTrue 实际回给前端的错误码（DB 异常一律包成 unexpected_failure）。 */
const ALLOWLIST_DENIED_CODE = 'unexpected_failure'
/** 注册场景被挡下的用户可见文案（login/page.tsx 直接渲染 err.message）。 */
const ALLOWLIST_DENIED_MSG_REGISTER =
  '注册失败。如果你不在内测名单内，请联系我们获取邀请；如果你确认已受邀，请稍后重试。'
/** 登录场景被挡下的用户可见文案（同一基调，措辞适配「登录」而非「注册」）。 */
const ALLOWLIST_DENIED_MSG_LOGIN =
  '登录失败。如果你不在内测名单内，请联系我们获取邀请；如果你确认已受邀，请稍后重试。'

/**
 * 判断 GoTrue 错误是否为内测白名单触发器拒绝。
 * 判定依据为 status + code（原关键词匹配方案已被生产实测证伪，见上方段落注释）。
 * @param error 任意 GoTrue / 网络错误对象
 * @returns     true 表示应回白名单兼容措辞文案
 */
function isAllowlistDenied(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const { status, code } = error as { status?: unknown; code?: unknown }
  return status === ALLOWLIST_DENIED_STATUS && code === ALLOWLIST_DENIED_CODE
}

function validateEmail(email: string): string {
  const e = email.trim()
  if (!EMAIL_RE.test(e)) throw appError('INVALID_EMAIL', '请输入正确的邮箱')
  return e
}

function validatePassword(pwd: string): void {
  if (typeof pwd !== 'string' || pwd.length < PASSWORD_MIN) {
    throw appError('WEAK_PASSWORD', `密码至少 ${PASSWORD_MIN} 位`)
  }
}

/**
 * 注册：把邮箱+密码绑到当前匿名账号（user_id 不变，试用数据保留）。
 * @throws INVALID_EMAIL / WEAK_PASSWORD / EMAIL_EXISTS / REGISTER_FAILED
 */
export async function registerWithPassword(email: string, password: string): Promise<void> {
  const e = validateEmail(email)
  validatePassword(password)
  await ensureSession()
  // ⚠️ 必须在 updateUser【之前】读：绑邮箱成功后 session 里 is_anonymous 就变成 false，
  // 事后再读恒为 false ——「有多少注册是从匿名试用转化来的」这一格会永远为空。
  // try/catch + ?? false：这一句纯为埋点服务，读不到/读出错一律按 false 记，
  // 【绝不允许因为一个埋点字段让注册失败】（埋点不得影响任何主流程分支，与 track 同纪律）。
  let fromAnonymous = false
  try {
    fromAnonymous = (await getAccount())?.isAnonymous ?? false
  } catch {
    /* 静默：埋点字段取不到就按 false 记，注册流程照常往下走 */
  }
  const { error } = await getSupabase().auth.updateUser({ email: e, password })
  if (!error) {
    // 注册成功埋点（P2 额度转化的终点格）。fire-and-forget：不 await、不进条件、不影响下方任何分支。
    track('auth.registered', { fromAnonymous })
    // 绑邮箱成功即强制重签 access token：updateUser 不换发新 token，旧 token 里 is_anonymous 仍为 true、
    // email 仍为 null，会让服务端按额度判身份时误判为匿名（阻断级 bug，见 api-auth loadIdentity）。
    // refreshSession 让后续请求带上 is_anonymous=false / email 有值的新 token，把主误判窗口关到近乎零。
    // 失败静默吞掉、绝不阻断注册：服务端 loadIdentity 查权威源已能兜底，重签只是把窗口从 ~1h 缩到 ~0。
    try {
      await getSupabase().auth.refreshSession()
    } catch {
      /* 静默：B（服务端权威查询）已兜底，重签失败最多让识别延迟到缓存 TTL / token 过期 */
    }
    return
  }

  // 内测白名单拒绝优先判：触发器抛的是 DB 异常（多为 500），若落到下面兜底分支
  // 用户只会看到「创建账号失败，请稍后再试」，完全不知道自己是被名单挡了。
  if (isAllowlistDenied(error)) {
    throw appError('NOT_ALLOWLISTED', ALLOWLIST_DENIED_MSG_REGISTER, error)
  }

  // 邮箱已注册启发式：status 422 / message 含 already/registered/exists
  const msg = error.message?.toLowerCase() ?? ''
  const status = (error as { status?: number }).status
  const exists = status === 422 || msg.includes('already') || msg.includes('registered') || msg.includes('exists')
  if (exists) {
    throw appError('EMAIL_EXISTS', '该邮箱已注册，请直接登录', error)
  }
  throw appError('REGISTER_FAILED', '创建账号失败，请稍后再试', error)
}

/**
 * 登录：邮箱 + 密码。
 * @throws INVALID_EMAIL / LOGIN_FAILED（邮箱或密码错误）
 */
export async function loginWithPassword(email: string, password: string): Promise<void> {
  const e = validateEmail(email)
  if (typeof password !== 'string' || password.length === 0) {
    throw appError('LOGIN_FAILED', '邮箱或密码错误')
  }
  const { error } = await getSupabase().auth.signInWithPassword({ email: e, password })
  if (error) {
    // 登录本身不触发白名单触发器（不写 email 列），此分支仅为万一被间接命中时不回误导性的「密码错误」。
    // 凭据错误 GoTrue 回 400 invalid_credentials，不会命中 500/unexpected_failure，故不会抢掉「密码错误」文案。
    if (isAllowlistDenied(error)) {
      throw appError('NOT_ALLOWLISTED', ALLOWLIST_DENIED_MSG_LOGIN, error)
    }
    throw appError('LOGIN_FAILED', '邮箱或密码错误', error)
  }
}

/**
 * 发送密码重置邮件，链接指向 /reset-password。
 * @throws INVALID_EMAIL / SEND_FAILED
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const e = validateEmail(email)
  if (typeof window === 'undefined') {
    throw appError('SEND_FAILED', '请在浏览器中操作')
  }
  const { error } = await getSupabase().auth.resetPasswordForEmail(e, {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) {
    throw appError('SEND_FAILED', '发送失败，请稍后再试', error)
  }
}

/**
 * 设置新密码（用于 /reset-password：用户已通过重置链接建立 recovery 会话）。
 * @throws WEAK_PASSWORD / UPDATE_FAILED
 */
export async function updatePassword(newPassword: string): Promise<void> {
  validatePassword(newPassword)
  const { error } = await getSupabase().auth.updateUser({ password: newPassword })
  if (error) {
    throw appError('UPDATE_FAILED', '设置新密码失败，请重新打开重置链接', error)
  }
}

/**
 * 读取当前账号信息（avatarUrl 来自 user_metadata.avatar_url，由头像上传写入）。
 *
 * 走 getSession()（读本地 session）而非 getUser()（每次发网络请求校验 token）：
 * 本函数只服务于「显示自己的信息」，冷刷新时不该为渲染头像/邮箱等一个往返。
 * supabase-js 会在 updateUser / 登录 / 登出后即时更新本地 session，故上传头像后立刻可读到新 avatar_url。
 * 服务端与安全校验路径（如删号）仍各自验证 token，不受此影响。
 */
export async function getAccount(): Promise<{
  id: string
  email: string | null
  isAnonymous: boolean
  avatarUrl: string | null
  displayName: string | null
  targetBand: number | null
  examDate: string | null
} | null> {
  const { data } = await getSupabase().auth.getSession()
  const user = data.session?.user
  if (!user) return null
  const meta = user.user_metadata ?? {}
  const rawAvatar = meta.avatar_url as unknown
  const rawName   = meta.display_name as unknown
  const rawBand   = meta.target_band as unknown
  const rawDate   = meta.exam_date as unknown
  return {
    // user.id 供「内部账户豁免」在客户端判定（额度卡显示「不限」）；会话内不可变。
    id: user.id,
    email: user.email ?? null,
    isAnonymous: user.is_anonymous ?? false,
    avatarUrl:   typeof rawAvatar === 'string' && rawAvatar !== '' ? rawAvatar : null,
    displayName: typeof rawName === 'string' && rawName !== '' ? rawName : null,
    targetBand:  typeof rawBand === 'number' && Number.isFinite(rawBand) ? rawBand : null,
    examDate:    typeof rawDate === 'string' && rawDate !== '' ? rawDate : null,
  }
}

/**
 * 保存备考目标（写 user_metadata；updateUser 会即时更新本地 session 并广播 USER_UPDATED，
 * useAccount 各实例随之自动刷新，无需手动通知）。
 * @param targetBand 目标分数（4.0–9.0，步进 0.5）；null 表示未设置
 * @param examDate   考试日期 'YYYY-MM-DD'；null 表示未设置
 * @throws SAVE_FAILED
 * @sideEffect       写 Supabase user_metadata.target_band / exam_date
 */
export async function saveExamGoal(
  { targetBand, examDate }: { targetBand: number | null; examDate: string | null },
): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({
    data: { target_band: targetBand, exam_date: examDate },
  })
  if (error) {
    throw appError('SAVE_FAILED', '保存失败，请稍后再试', error)
  }
}

/**
 * 保存自定义昵称（写 user_metadata.display_name；updateUser 即时更新本地 session 并广播 USER_UPDATED，
 * useAccount 各实例随之自动刷新，无需手动通知）。
 * @param name 用户输入的昵称；先 trim 再截断到 DISPLAY_NAME_MAX，结果为空串则写 null（清除昵称）
 * @returns    Promise<void>
 * @throws     SAVE_FAILED
 * @sideEffect 写 Supabase user_metadata.display_name
 */
export async function saveDisplayName(name: string): Promise<void> {
  const trimmed = name.trim().slice(0, DISPLAY_NAME_MAX)
  const { error } = await getSupabase().auth.updateUser({
    data: { display_name: trimmed === '' ? null : trimmed },
  })
  if (error) {
    throw appError('SAVE_FAILED', '保存失败，请稍后再试', error)
  }
}

/**
 * 退出登录。
 * 清同意缓存（key 不含 uid，残留会致同机换号弹窗死循环，见 clearConsentCache）；
 * 清 flow_id（sessionStorage 按 tab 存、不随登出自动清，否则同 tab 内 B 登录后会一直带着 A 的
 * flow_id，把两个人的埋点串成一条链，见 clearFlowId）。
 * 清埋点的 Authorization 缓存（signOut 后已签发的 JWT 到 exp 前仍验得过、不会自然失效，
 * 不清的话卸载路径会带着上一个账号的 token 继续发事件，把「放弃」记到他头上，见 clearAuthCache）。
 */
export async function logout(): Promise<void> {
  await getSupabase().auth.signOut()
  clearConsentCache()
  clearFlowId()
  clearAuthCache()
}
