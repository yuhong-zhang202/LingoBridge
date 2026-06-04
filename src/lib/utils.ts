/**
 * @module   utils
 * @desc     通用工具函数
 * @author   LingoBridge
 * @created  2026-05-15
 */
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 将 ISO 时间字符串格式化为相对时间文案
 * @param iso  ISO 8601 时间字符串（如 '2026-06-01T10:00:00Z'）
 * @returns    相对时间（如 '刚刚' / '3 小时前' / '昨天' / '5 天前'）
 */
export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)   return '刚刚'
  if (mins < 60)  return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return '昨天'
  if (days < 30)  return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}
