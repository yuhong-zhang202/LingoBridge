/**
 * @module   date
 * @desc     日期格式化统一出口 —— 一律走 Intl.DateTimeFormat，不手写 `${m}/${d}` 拼接
 *           （手写格式无视语言环境，且同一文案曾在 4 处各拷一份）。
 * @author   LingoBridge
 * @created  2026-07-10
 */

const MONTH_DAY = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })
const MONTH_DAY_CN = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' })

/**
 * 短日期，如「7/10」——用于卡片角标、时间戳
 * @param date 目标日期，默认今天
 */
export function formatMonthDay(date: Date = new Date()): string {
  return MONTH_DAY.format(date)
}

/**
 * 下月 1 日的中文标签，如「8月1日」——用于额度重置日提示
 * @param from 基准日期，默认今天
 */
export function nextMonthFirstLabel(from: Date = new Date()): string {
  return MONTH_DAY_CN.format(new Date(from.getFullYear(), from.getMonth() + 1, 1))
}
