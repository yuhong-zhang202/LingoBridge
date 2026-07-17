/**
 * @module   lib/format-cost
 * @desc     看板费用金额的统一精度策略 —— 全站一处口径，消除卡片 2 位 / 表格 4 位 / tooltip 4 位「同页三套」。
 *           按量级动态取小数位（大额 2 位、小额补到 3–4 位保留有效数字），既不丢内测阶段的分厘小额，
 *           也不让大额金额拖一串零。
 * @author   LingoBridge
 * @created  2026-07-18
 */

/**
 * 按金额量级选小数位：|v|≥1 → 2 位；≥0.1 → 3 位；否则 4 位。
 * 保证大额清爽、小额（单次调用常低至 0.0003 元）仍有有效数字可读。
 * @param value  金额（人民币元）
 * @returns      小数位数（2 | 3 | 4）
 */
export function cnyDecimals(value: number): number {
  const abs = Math.abs(value)
  if (abs >= 1) return 2
  if (abs >= 0.1) return 3
  return 4
}

/**
 * 统一格式化人民币金额（不带符号），仅数字部分，含动态小数位。
 * @param value  金额（人民币元）
 * @returns      如 "12.34" / "0.523" / "0.0003"
 */
export function formatCnyNumber(value: number): string {
  return value.toFixed(cnyDecimals(value))
}

/**
 * 统一格式化人民币金额（带 ¥ 前缀），全站费用展示唯一入口。
 * @param value  金额（人民币元）
 * @returns      如 "¥12.34" / "¥0.0003"
 */
export function formatCny(value: number): string {
  return `¥${formatCnyNumber(value)}`
}
