/**
 * @module   auth
 * @desc     手机号验证码登录（Supabase phone OTP，短信走 Twilio Verify 后台配置）—
 *           匿名账号升级（updateUser({ phone })，user_id 不变保住试用数据）/
 *           已注册走 signInWithOtp + verifyOtp。所有日志严禁出现手机号/验证码。
 * @author   LingoBridge
 * @created  2026-06-17
 */
import type { AppError } from '@/types/errors'
import { getSupabase, ensureSession } from '@/lib/supabase'

const E164_RE = /^\+[1-9]\d{6,14}$/

function appError(code: string, message: string, cause?: unknown): AppError {
  return { code, message, cause }
}

/**
 * 脱敏手机号 — E.164 输入，中间四位替换为 ****，如 +8613812345678 → +86 138****5678。
 * 国家码默认匹配前 1–3 位（中国大陆 +86 为最常见 case）；不规则输入原样返回。
 */
export function maskPhone(phone: string): string {
  if (!E164_RE.test(phone)) return phone
  // 简单切分：去掉首位 '+'，按 国家码(2–3) + 余下 拆
  const body = phone.slice(1)
  // 中国大陆 +86 13 位（86 + 11），其它默认前 1 位为国家码、剩余按尾 4 位脱敏
  let cc: string
  let rest: string
  if (body.startsWith('86') && body.length === 13) {
    cc = '86'
    rest = body.slice(2)
  } else {
    // 通用：取前 1 位作国家码；剩余至少 4 位才脱敏，否则原样
    cc = body.slice(0, 1)
    rest = body.slice(1)
  }
  if (rest.length < 8) return phone
  const head = rest.slice(0, rest.length - 8)
  const tail = rest.slice(-4)
  return `+${cc} ${head}****${tail}`
}

/**
 * 发送短信验证码。
 * 先尝试 updateUser 把手机号绑到当前匿名账号（user_id 不变保住试用数据）；
 * 若手机号已被注册，自动改走 signInWithOtp 登录原账号。
 * @returns convert = 首次绑定（匿名→手机号）；login = 老用户登录原账号
 * @throws AppError INVALID_PHONE / SEND_FAILED
 */
export async function sendPhoneCode(phone: string): Promise<{ mode: 'convert' | 'login' }> {
  const normalized = phone.trim()
  if (!E164_RE.test(normalized)) {
    throw appError('INVALID_PHONE', '请输入正确的手机号')
  }
  await ensureSession()
  const supabase = getSupabase()
  const { error } = await supabase.auth.updateUser({ phone: normalized })
  if (!error) return { mode: 'convert' }

  // 手机号已注册识别：v2 OTP 流程下 status 422、或 message 含 already/registered/exists
  const msg = error.message?.toLowerCase() ?? ''
  const status = (error as { status?: number }).status
  const alreadyRegistered = status === 422 || msg.includes('already') || msg.includes('registered') || msg.includes('exists')
  if (!alreadyRegistered) {
    throw appError('SEND_FAILED', '发送失败，请稍后再试', error)
  }
  const { error: otpErr } = await supabase.auth.signInWithOtp({
    phone: normalized,
    options: { shouldCreateUser: false },
  })
  if (otpErr) {
    throw appError('SEND_FAILED', '发送失败，请稍后再试', otpErr)
  }
  return { mode: 'login' }
}

/**
 * 校验验证码并完成登录。
 * mode='convert' 走 phone_change（确认匿名账号升级）；mode='login' 走 sms（老用户登录）。
 * @throws AppError INVALID_CODE
 */
export async function verifyPhoneCode(phone: string, code: string, mode: 'convert' | 'login'): Promise<void> {
  if (!/^\d{6}$/.test(code)) {
    throw appError('INVALID_CODE', '请输入 6 位数字验证码')
  }
  const type = mode === 'login' ? 'sms' : 'phone_change'
  const { error } = await getSupabase().auth.verifyOtp({
    phone: phone.trim(),
    token: code,
    type,
  })
  if (error) {
    throw appError('INVALID_CODE', '验证码错误或已过期', error)
  }
}

/**
 * 读取当前账号信息。
 * @returns { phone, isAnonymous } 或 null（无 user）
 */
export async function getAccount(): Promise<{ phone: string | null; isAnonymous: boolean } | null> {
  const { data } = await getSupabase().auth.getUser()
  if (!data.user) return null
  return {
    phone: data.user.phone ?? null,
    isAnonymous: data.user.is_anonymous ?? false,
  }
}

/**
 * 退出登录。
 */
export async function logout(): Promise<void> {
  await getSupabase().auth.signOut()
}
