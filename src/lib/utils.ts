/**
 * @module   utils
 * @desc     通用工具函数
 * @author   LingoBridge
 * @created  2026-05-15
 */
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { MIN_CORPUS_CHARS } from '@/lib/constants'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 语料无意义时统一展示的提示文案（判「不像经历」，与「太少」正交，见 TOO_SHORT_TOAST_MSG） */
export const GARBAGE_TOAST_MSG = '这段看起来不像一段经历，换个真实的小故事再试试吧'

/**
 * 语料「真实但太少」时的提示文案 —— 与 GARBAGE_TOAST_MSG 严格区分：
 * 后者判「不像经历」，本条是「像经历但信息量不够」，故不劝换故事、而是引导补充三个维度。
 */
export const TOO_SHORT_TOAST_MSG = '再多说几句就能匹配到题：这件事是什么、你具体做了什么、后来心里是什么感受'

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
 * 统计语料【有效字符数】：剔除标点 / 空格 / 换行，仅计「中文汉字 + 英文单词字符（字母、数字）」。
 * 只数实义字符 = 挡「伪长文本」（大量标点空格换行灌水冲字数、绕过纯长度门槛）。
 * @param text  原始文本
 * @returns     有效字符数
 */
export function countEffectiveCorpusChars(text: string): number {
  // 逐字符匹配：单个 CJK 汉字或单个 ASCII 字母/数字各计 1；其余（标点、空白、符号、emoji）不计。
  const matches = text.match(/[一-鿿]|[A-Za-z0-9]/g)
  return matches ? matches.length : 0
}

/**
 * 语料最小字数门槛预检：有效字符 < MIN_CORPUS_CHARS 即判「太少」。不调 API。
 * 与 isGarbageInput 正交——后者判「不像经历」、本函数判「真实但信息不足」，两防线各拦一类、共用于文字/语音两入口。
 * ⚠️ 独立字数闸，与 restructure 的 usable（故意放行薄素材的 LLM 质量判断）互不相干。
 * @param text  用户输入或转写文本
 * @returns     true = 太少需补充；false = 达门槛放行
 */
export function isTooShortForCorpus(text: string): boolean {
  return countEffectiveCorpusChars(text) < MIN_CORPUS_CHARS
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
