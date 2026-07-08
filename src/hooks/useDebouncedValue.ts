/**
 * @module   useDebouncedValue
 * @desc     通用防抖值 —— 输入值在 delay 毫秒内无变化才更新返回值。用于搜索输入防抖等。
 * @author   LingoBridge
 * @created  2026-07-08
 */
'use client'
import { useState, useEffect } from 'react'

/**
 * 防抖某个值
 * @param value  实时值
 * @param delay  防抖毫秒
 * @returns      delay 内稳定后的值
 */
export default function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
