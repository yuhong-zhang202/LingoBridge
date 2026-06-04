/**
 * @module   auth
 * @desc     UI 登录态管理 — 当前为 mock 实现，仅维护手机号（存 localStorage）；
 *           上架前替换为 Supabase phone OTP + 匿名账号升级（updateUser + verifyOtp），
 *           届时只改本文件，user_id 不变、数据自动保留。
 * @author   LingoBridge
 * @created  2026-06-03
 */
import type { AppError } from '@/types/errors'

const PHONE_KEY = 'lingobridge:phone'

/**
 * 发送验证码（mock：校验手机号格式通过后直接 resolve，不调任何后端）
 * @param phone  手机号（中国大陆 11 位，1 开头）
 * @throws       AppError { code: 'INVALID_PHONE' } — 格式不合法时
 */
export async function sendVerifyCode(phone: string): Promise<void> {
  if (typeof window === 'undefined') return
  if (!/^1\d{10}$/.test(phone)) {
    throw {
      code: 'INVALID_PHONE',
      message: '请输入正确的手机号（11 位数字，1 开头）',
    } satisfies AppError
  }
  if (process.env.NODE_ENV === 'development') {
    console.log(`[auth] mock 发送验证码 ${phone}，任意6位数字均可通过`)
  }
}

/**
 * 验证验证码（mock：6 位数字即通过，写手机号到 localStorage）
 * @param phone  手机号
 * @param code   验证码（6 位数字）
 * @throws       AppError { code: 'INVALID_CODE' } — 格式不合法时
 */
export async function verifyCode(phone: string, code: string): Promise<void> {
  if (typeof window === 'undefined') return
  if (!/^\d{6}$/.test(code)) {
    throw {
      code: 'INVALID_CODE',
      message: '请输入 6 位数字验证码',
    } satisfies AppError
  }
  localStorage.setItem(PHONE_KEY, phone)
}

/**
 * 读取已绑定的手机号
 * @returns  手机号字符串，或 null（未登录）
 */
export function getPhone(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(PHONE_KEY)
}

/**
 * 是否已绑定手机号（UI 登录态）
 * @returns  true = 有登录态
 */
export function isLoggedIn(): boolean {
  return getPhone() !== null
}

/**
 * 退出登录 — 清除本地手机号
 */
export function logout(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PHONE_KEY)
}

/**
 * 脱敏手机号 — 把中间四位替换为 ****
 * @param phone  原始手机号
 * @returns      脱敏后字符串，如 '138****5678'；非 11 位原样返回
 */
export function maskPhone(phone: string): string {
  if (phone.length !== 11) return phone
  return `${phone.slice(0, 3)}****${phone.slice(7)}`
}
