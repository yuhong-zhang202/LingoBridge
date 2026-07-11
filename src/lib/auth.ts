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
  const { error } = await getSupabase().auth.updateUser({ email: e, password })
  if (!error) return

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

/** 退出登录。 */
export async function logout(): Promise<void> {
  await getSupabase().auth.signOut()
}
