/**
 * @module   topic
 * @desc     话题名美化 —— 题目 topic 字段（英文全大写、下划线分词，如 HOMETOWN / WORK_OR_STUDY）
 *           直接展示难看，统一转 Title Case + 下划线换空格后再显示话题标。QuestionFlashCard（题卡正面
 *           Part1 话题标）与首页雅思模式选题卡共用此一份，避免两处漂移。
 *           ⚠️ 这是英文话题名占位；理想是中文话题名 topic_zh，但当前题目数据无该字段（需后端补），
 *              本轮先用美化英文，不阻塞。
 * @author   LingoBridge
 * @created  2026-07-25
 */

/**
 * 话题名美化（HOMETOWN→Hometown，WORK_OR_STUDY→Work Or Study）。
 * @param topic  原始 topic（英文大写下划线）
 * @returns      美化后的话题名；空 / 全空白 → null（调用侧不渲染话题标）
 */
export function prettifyTopic(topic: string): string | null {
  const t = topic.trim()
  if (t === '') return null
  return t
    .split(/[_\s]+/)
    .filter((w) => w !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}
