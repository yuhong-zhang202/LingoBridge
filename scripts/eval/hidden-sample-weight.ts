/**
 * @module   hidden-sample-weight
 * @desc     隐藏区抽样的冻结权重表（Horvitz-Thompson）—— 台账 036 的修复。
 *           单独成模块的两个理由：(1) 它是「关于金标的数据」，与算分逻辑是两件事；
 *           (2) 算分脚本用了 import.meta.url（ESM），jest 的 CommonJS transform 吃不下，
 *           表放在这里才能被单测直接引用——而这张表恰恰是最需要被钉死的东西。
 *           ⚠️ 本文件属指标定义，与 run-ranking-score.ts 同级，已加入 guard-golden 保护清单。
 * @author   LingoBridge
 * @created  2026-07-17
 */

/** 金标标注分区：visible=全量标注；hidden_sampled=按 1/5 系统抽样 */
export type Zone = 'visible' | 'hidden_sampled'

// ── 隐藏区抽样：冻结权重表（Horvitz-Thompson）──────────────────────────────────
//
// 权重 = 1/π_i，π_i = 该故事历史隐藏区的入选概率 = ceil(n_i/5)/n_i。
// **运行时零计算**：入选概率是历史事实——标注当时按什么规则抽的，权重就是那个规则定死的常数。
// 用本轮实测反推权重（旧实现的 `scale = hiddenTotal / n`）等于让被测对象决定自己的称重方式：
// 管道越准、候选跨区越多，hiddenTotal 越变，权重跟着变（实测已漂 3.457→3.661→4.441）。
//
// 【框版本】ranking-2026-07-16T00-20-41-967Z.json，可见线 <40 为隐藏区。
//   逐故事 id 集合 40/40 与金标 zone 完全一致，已验证这就是建金标时用的那份。
// 【为什么逐故事而非全局常数】抽样是 per-story 的 `i % 5 === 0`（run-ranking.ts:490），
//   每个故事各自从 0 开始数 → 实际抽 ceil(n_i/5) 条而非 n_i/5 条。
//   于是 π_i 随该故事隐藏区大小在 1.0 ~ 0.2 之间变：n_i≤5 的故事那一条是**必被抽中**的
//   （π=1，权重必须为 1，它是确定性观测）；n_i=5 的整除故事 π=0.2（权重 5）。
//   40 个故事里有 23 个 n_i≤5。用全局常数 204/59=3.458 会把一条确定性观测当成 3.46 条用。
//   两者估总量等价（Σw 都=204），但埋没率的分子是**个体级**的量，不是总量。
// 【与金标声明的 hiddenSampleRate: 0.2 不符，是正常的】真实平均入选概率 = 59/204 = 28.9%，
//   因为每故事 ceil 向上取整。该元数据的修正属金标编辑，由人亲手改，本文件只做交叉校验告警。
// 【抽样框可信度】该导出是管道错位修复**前**的（台账 014）。错位交换的是同一故事内两道题的
//   {score,reason} 单元，故事内分数集合不变 → 每故事 ceil(n_i/5) 的**数量**与分层性质不受影响，
//   HT 的入选概率结构成立（**估计无偏**）；但**哪一条**被抽中受错位影响 → **方差受损**。
//   据此埋没率闸门降级为烟雾报警（只报非零、不报量级，见 burialStr）。
//   恢复精度的路径是金标 v2 重建抽样框（内测评估方案 L3），本次不返工重抽。
export const HIDDEN_WEIGHT_FRAME = 'ranking-2026-07-16T00-20-41-967Z.json (可见线<40)'
/** 冻结框里每个故事的隐藏区规模与抽中数。n/k 即 HT 权重 1/π_i；n、k 一并留存——
 *  它们是历史事实，只留商会丢信息（w=4 可能来自 n=4,k=1 也可能 n=16,k=4，反推不唯一） */
export const HIDDEN_FRAME: Record<string, { n: number; k: number }> = {
  S016: { n:  3, k: 1 },
  S017: { n:  4, k: 1 },
  S019: { n:  7, k: 2 },
  S020: { n:  5, k: 1 },
  S024: { n:  4, k: 1 },
  S025: { n:  4, k: 1 },
  S037: { n: 13, k: 3 },
  S040: { n:  3, k: 1 },
  S041: { n:  2, k: 1 },
  S044: { n:  9, k: 2 },
  S045: { n: 13, k: 3 },
  S046: { n:  7, k: 2 },
  S047: { n:  6, k: 2 },
  S051: { n:  4, k: 1 },
  S056: { n:  3, k: 1 },
  S057: { n:  3, k: 1 },
  S060: { n:  5, k: 1 },
  S061: { n:  1, k: 1 },
  S062: { n:  4, k: 1 },
  S063: { n:  1, k: 1 },
  S064: { n:  5, k: 1 },
  S065: { n:  5, k: 1 },
  S066: { n:  6, k: 2 },
  S067: { n:  3, k: 1 },
  S072: { n:  3, k: 1 },
  S074: { n:  2, k: 1 },
  S075: { n:  6, k: 2 },
  S079: { n:  6, k: 2 },
  S080: { n:  5, k: 1 },
  S083: { n:  4, k: 1 },
  S084: { n:  3, k: 1 },
  S085: { n:  6, k: 2 },
  S086: { n:  6, k: 2 },
  S090: { n:  6, k: 2 },
  S091: { n:  6, k: 2 },
  S092: { n:  6, k: 2 },
  S093: { n:  7, k: 2 },
  S094: { n:  7, k: 2 },
  S095: { n:  6, k: 2 },
  S096: { n:  5, k: 1 },
}
/** 声明抽样率（金标元数据）与冻结框的真实均值不符时告警——现状必然告警，见上方注释 */
export const FRAME_HIDDEN_TOTAL = 204
export const FRAME_HIDDEN_SAMPLED = 59

/** 一条金标对的抽样权重：visible 全标恒 1；hidden_sampled 查冻结表 */
export function sampleWeight(zone: Zone, storyId: string): number {
  if (zone === 'visible') return 1
  const f = HIDDEN_FRAME[storyId]
  if (f === undefined) {
    console.error('[Score] 金标故事不在冻结权重表内，按权重 1 保守处理（会低估埋没）', { storyId, frame: HIDDEN_WEIGHT_FRAME })
    return 1
  }
  return f.n / f.k
}
