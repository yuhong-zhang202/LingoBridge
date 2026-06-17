/**
 * @module   auth
 * @desc     邮箱验证码登录 — 匿名账号升级（updateUser，user_id 不变保住试用数据）/
 *           已注册走 signInWithOtp + verifyOtp。所有日志严禁出现邮箱/验证码。
 * @author   LingoBridge
 * @created  2026-06-17
 */
import type { AppError } from '@/types/errors'
import { getSupabase, ensureSession } from '@/lib/supabase'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function appError(code: string, message: string, cause?: unknown): AppError {
  return { code, message, cause }
}

/**
 * 脱敏邮箱 — 本地名只留首字符，如 a***@gmail.com；无 @ 原样返回。
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return email
  return `${email[0]}***${email.slice(at)}`
}

/**
 * 发送邮箱验证码。
 * 先尝试 updateUser 把邮箱绑到当前匿名账号（user_id 不变保住试用数据）；
 * 若邮箱已被注册，自动改走 signInWithOtp 登录原账号。
 * @returns convert = 首次绑定（匿名→邮箱）；login = 老用户登录原账号
 * @throws AppError INVALID_EMAIL / SEND_FAILED
 */
export async function sendEmailCode(email: string): Promise<{ mode: 'convert' | 'login' }> {
  const normalized = email.trim()
  if (!EMAIL_RE.test(normalized)) {
    throw appError('INVALID_EMAIL', '请输入正确的邮箱')
  }
  await ensureSession()
  const supabase = getSupabase()
  const { error } = await supabase.auth.updateUser({ email: normalized })
  if (!error) return { mode: 'convert' }

  // 邮箱已注册识别：v2 OTP 流程下 status 422、或 message 含 already/registered/exists
  const msg = error.message?.toLowerCase() ?? ''
  const status = (error as { status?: number }).status
  const alreadyRegistered = status === 422 || msg.includes('already') || msg.includes('registered') || msg.includes('exists')
  if (!alreadyRegistered) {
    throw appError('SEND_FAILED', '发送失败，请稍后再试', error)
  }
  const { error: otpErr } = await supabase.auth.signInWithOtp({
    email: normalized,
    options: { shouldCreateUser: false },
  })
  if (otpErr) {
    throw appError('SEND_FAILED', '发送失败，请稍后再试', otpErr)
  }
  return { mode: 'login' }
}

/**
 * 校验验证码并完成登录。
 * mode='convert' 走 email_change（确认匿名账号升级）；mode='login' 走 email（老用户登录）。
 * @throws AppError INVALID_CODE
 */
export async function verifyEmailCode(email: string, code: string, mode: 'convert' | 'login'): Promise<void> {
  if (!/^\d{6}$/.test(code)) {
    throw appError('INVALID_CODE', '请输入 6 位数字验证码')
  }
  const type = mode === 'login' ? 'email' : 'email_change'
  const { error } = await getSupabase().auth.verifyOtp({
    email: email.trim(),
    token: code,
    type,
  })
  if (error) {
    throw appError('INVALID_CODE', '验证码错误或已过期', error)
  }
}

/**
 * 读取当前账号信息。
 * @returns { email, isAnonymous } 或 null（无 user）
 */
export async function getAccount(): Promise<{ email: string | null; isAnonymous: boolean } | null> {
  const { data } = await getSupabase().auth.getUser()
  if (!data.user) return null
  return {
    email: data.user.email ?? null,
    isAnonymous: data.user.is_anonymous ?? false,
  }
}

/**
 * 退出登录。
 */
export async function logout(): Promise<void> {
  await getSupabase().auth.signOut()
}
