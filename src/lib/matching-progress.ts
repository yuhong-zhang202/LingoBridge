/**
 * @module   matching-progress
 * @desc     匹配等待进度的纯计算 —— 已用时长 → 分阶段文案 + 进度百分比。
 *           与渲染分离放在 lib：这两条是产品约束（文案定稿、进度条永不到顶），
 *           必须能被单测直接钉死，不该只活在组件里靠肉眼等几分钟去验。
 * @author   LingoBridge
 * @created  2026-07-20
 */

/**
 * 分阶段文案（产品方定稿，措辞不要自行改写）。
 * 每档 fromMs 为「进入该档的毫秒下界」，取最后一个满足 elapsed >= fromMs 的档。
 */
const STAGES: readonly { fromMs: number; text: string }[] = [
  { fromMs: 0,      text: '正在读你的故事…' },
  { fromMs: 5_000,  text: '已找到你的表达特质，正在筛选题目…' },
  { fromMs: 10_000, text: '正在逐题评估贴合度…' },
  // 30 秒档：此前最后一档停在 10 秒，而实测慢的那次匹配跑了约 50 秒 ——
  // 用户会盯着同一句话看 40 秒，那句话就从「有进展」变成了「是不是卡死了」。
  { fromMs: 30_000, text: '还在逐题评估，这次候选题有点多…' },
]

/** 进度条基准时长：20 秒对应 BASE_PCT，取自实测常见耗时（19.8s），不是对用户的承诺 */
const BASELINE_MS = 20_000
/** 走到基准时长时的百分比 */
const BASE_PCT = 85
/** 超出基准后渐近逼近的上限（永不到达，更不会到 100） */
const CEIL_PCT = 99
/** 超出基准后的渐近时间常数：每过 TAIL_TAU_MS，剩余空间衰减到 1/e */
const TAIL_TAU_MS = 20_000

/**
 * 已用时长 → 进度百分比。
 * 20 秒内线性走到 85%，之后渐近逼近 99% 但【永远不到 100】——
 * 进度条走满却还在转，比没有进度条更伤信任：那等于明着告诉用户这个数字是编的。
 * @param elapsedMs 从开始等待起的毫秒数
 * @returns 0 到 CEIL_PCT 之间的百分比（严格小于 100）
 */
export function progressPct(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0
  if (elapsedMs < BASELINE_MS) return (BASE_PCT * elapsedMs) / BASELINE_MS
  const tail = (CEIL_PCT - BASE_PCT) * (1 - Math.exp(-(elapsedMs - BASELINE_MS) / TAIL_TAU_MS))
  return BASE_PCT + tail
}

/**
 * 已用时长 → 当前阶段文案。
 * @param elapsedMs 从开始等待起的毫秒数
 * @returns 该时刻应显示的文案
 */
export function stageText(elapsedMs: number): string {
  let text = STAGES[0].text
  for (const s of STAGES) {
    if (elapsedMs >= s.fromMs) text = s.text
  }
  return text
}
