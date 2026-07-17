/**
 * @module   lib/format-cost.test
 * @desc     费用统一精度策略守卫 —— 钉死按量级动态取小数位的分界（1 / 0.1）与边界补零，
 *           防止未来有人改回「同页三套」精度。
 * @author   LingoBridge
 * @created  2026-07-18
 */
import { cnyDecimals, formatCnyNumber, formatCny } from '@/lib/format-cost'

describe('format-cost · 动态精度', () => {
  test('cnyDecimals 按量级分档：≥1→2、≥0.1→3、否则 4', () => {
    expect(cnyDecimals(12.3456)).toBe(2)
    expect(cnyDecimals(1)).toBe(2)
    expect(cnyDecimals(0.5)).toBe(3)
    expect(cnyDecimals(0.1)).toBe(3)
    expect(cnyDecimals(0.0234)).toBe(4)
    expect(cnyDecimals(0.0003)).toBe(4)
    expect(cnyDecimals(0)).toBe(4)
  })

  test('分界值与负数按绝对值同档', () => {
    expect(cnyDecimals(-12.3)).toBe(2)
    expect(cnyDecimals(-0.05)).toBe(4)
  })

  test('formatCnyNumber：大额清爽、小额补零保留有效数字', () => {
    expect(formatCnyNumber(12.3456)).toBe('12.35')
    expect(formatCnyNumber(0.5)).toBe('0.500')
    expect(formatCnyNumber(0.0003)).toBe('0.0003')
    expect(formatCnyNumber(0)).toBe('0.0000')
  })

  test('formatCny 带 ¥ 前缀', () => {
    expect(formatCny(3.5)).toBe('¥3.50')
    expect(formatCny(0.0008)).toBe('¥0.0008')
  })
})
