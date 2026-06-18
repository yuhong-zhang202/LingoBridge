/**
 * @module   srs
 * @desc     Leitner 盒子法间隔重复：根据"记住/没记住"算下一个盒子与下次复习时间
 * @author   LingoBridge
 * @created  2026-06-12
 */

// 盒子 1..7 → 下次间隔（天），递增（艾宾浩斯遗忘曲线，长尾延伸到 60 天）
const BOX_INTERVAL_DAYS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 15, 6: 30, 7: 60 }
const MAX_BOX = 7
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 评估后的新盒子等级
 * @param box         当前盒子（1..5）
 * @param remembered  是否记住（右滑=true / 左滑=false）
 * @returns           记住→升一格（封顶 5）；没记住→回第 1 格
 */
export function nextBox(box: number, remembered: boolean): number {
  if (!remembered) return 1
  return Math.min(box + 1, MAX_BOX)
}

/**
 * 按盒子等级算下次复习时间
 * @param box   盒子等级（1..5）
 * @param from  起算时间，默认现在
 * @returns     下次到期 Date
 */
export function nextDue(box: number, from: Date = new Date()): Date {
  const days = BOX_INTERVAL_DAYS[box] ?? 1
  return new Date(from.getTime() + days * DAY_MS)
}

export { MAX_BOX }
