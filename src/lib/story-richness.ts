/**
 * @module   story-richness
 * @desc     故事文本「丰富度」派生 —— 收敛此前首页 textPanel 与 /write 里逐字复制的同一套公式为单一真源。
 *           公式与阈值完全沿用现有实现（值不变）：pct = len/90，18 段点亮 SegmentDots，len≥10 可提交。
 * @author   LingoBridge
 * @created  2026-07-09
 */

export interface StoryRichness {
  /** 去空白后字数 */
  len: number
  /** 丰富度百分比（0–100，len/90 封顶） */
  pct: number
  /** 点亮的 SegmentDots 段数（共 18 段） */
  richnessFilled: number
  /** 是否已达丰富（pct ≥ 80） */
  isRich: boolean
  /** 丰富度文案 */
  richState: string
  /** 是否可提交（len ≥ 10） */
  canSubmit: boolean
}

/**
 * 计算故事文本的丰富度派生值
 * @param  text  用户输入的故事文本
 * @returns      丰富度派生（字数 / 百分比 / 点亮段数 / 文案 / 可提交）
 */
export function computeRichness(text: string): StoryRichness {
  const len = text.trim().length
  const pct = Math.min(100, (len / 90) * 100)
  const richnessFilled = Math.round((pct / 100) * 18)
  const isRich = pct >= 80
  const richState =
    len === 0   ? '越具体匹配越准' :
    pct < 30    ? '还比较简单，多展开一些' :
    pct < 80    ? '渐入佳境，再补点细节' :
                  '很丰富啦 ✨ 可以开始匹配'
  const canSubmit = len >= 10
  return { len, pct, richnessFilled, isRich, richState, canSubmit }
}
