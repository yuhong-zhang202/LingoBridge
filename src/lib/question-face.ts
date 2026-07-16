/**
 * @module   question-face
 * @desc     构造「喂给重排 AI / 呈现给标注人」的候选题面。单一事实源：重排打分看到的题面，
 *           必须与盲标表呈现给标注人的题面完全一致，否则金标与线上判据错位。
 *           关键：Part2 cue card 的完整题面（含 "You should say" 的约束 bullet）存在 question_text，
 *           旧逻辑 `cue_card_title ?? question_text` 会因 title 非空而短路丢弃 question_text，
 *           使 AI/标注人只看到裸标题（如「一个经常帮助别人的人」而丢掉「how often / 经常」的约束），
 *           系统性造成 Part2 虚高。此处改为「标题 + 完整题面」，Part1/3（无 cue_card_title）行为不变。
 * @author   LingoBridge
 * @created  2026-07-16
 */

/** 题面所需的最小字段集（结构化，兼容 DBQuestion / MatchedQuestion 等） */
export interface QuestionFaceInput {
  question_text: string
  question_text_zh: string | null
  cue_card_title: string | null
  cue_card_title_zh: string | null
}

const SEP = ' — '

/**
 * 返回候选题的英文/中文题面。
 * - 有 cue_card_title（Part2 cue card）：标题 + 完整题面（question_text 带 bullet）。
 *   中文侧 question_text_zh 目前多为 null（DB 无中文 bullet），此时退回中文标题；英文题面已含约束，足以判定。
 * - 无 cue_card_title（Part1/3）：沿用 question_text / question_text_zh，行为与旧逻辑一致。
 */
export function questionFace(q: QuestionFaceInput): { en: string; zh: string } {
  const en = q.cue_card_title
    ? `${q.cue_card_title}${SEP}${q.question_text}`
    : q.question_text

  const zh = q.cue_card_title_zh
    ? (q.question_text_zh ? `${q.cue_card_title_zh}${SEP}${q.question_text_zh}` : q.cue_card_title_zh)
    : (q.question_text_zh ?? '')

  return { en, zh }
}
