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

function appError(code: string, message: string, cause?: unknown): AppError {
  return { code, message, cause }
}

/** 脱敏邮箱 — 首字符 + *** + @域名；无 @ 原样返回。 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return email
  return `${email[0]}***${email.slice(at)}`
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

/** 读取当前账号信息（avatarUrl 来自 user_metadata.avatar_url，由头像上传写入）。 */
export async function getAccount(): Promise<{ email: string | null; isAnonymous: boolean; avatarUrl: string | null } | null> {
  const { data } = await getSupabase().auth.getUser()
  if (!data.user) return null
  const rawAvatar = data.user.user_metadata?.avatar_url as unknown
  return {
    email: data.user.email ?? null,
    isAnonymous: data.user.is_anonymous ?? false,
    avatarUrl: typeof rawAvatar === 'string' && rawAvatar !== '' ? rawAvatar : null,
  }
}

/** 退出登录。 */
export async function logout(): Promise<void> {
  await getSupabase().auth.signOut()
}
