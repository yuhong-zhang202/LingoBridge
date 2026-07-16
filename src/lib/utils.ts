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

/** 语料无意义时统一展示的提示文案 */
export const GARBAGE_TOAST_MSG = '这段看起来不像一段经历，换个真实的小故事再试试吧'

/**
 * 即时预检：判断是否为明显无意义的输入，不调 API，从严克制只挡明显垃圾
 * @param text  用户输入或转写文本
 * @returns     true = 明显垃圾；false = 放行（交由 LLM 二次判断）
 */
export function isGarbageInput(text: string): boolean {
  const t = text.trim()
  if (t.length === 0) return true
  if (/^https?:\/\/\S+$/.test(t)) return true   // 整段就是一个 URL
  if (t.length < 5) return true                  // 极短，不可能是一段经历
  return false
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
