/**
 * @module   anki/list
 * @desc     【仅服务端】Anki 卡列表读取 —— 薄封装 0034 的 get_anki_cards RPC：按「当季 + part + scope」
 *           列出某用户的题卡（无卡的题回默认卡值，part2 带其 part3 成组、已排好序，见 0034 迁移头）。
 *           季度由本层用应用常量 CURRENT_SEASON 传入 RPC（单一真源在 constants.ts，RPC 不写死季度）。
 *
 *   越权防护：RPC 内一律按传入的 p_user_id 过滤用户私有表（anki_cards / corpus / matches）；调用端点须先
 *   requireUser 反查 userId 再传入。经 service_role 调 RPC（绕 RLS），与 enqueue.ts 同范式。
 *
 *   背面内容判定（backKind，供展示层选渲染）：
 *     - 'edited'    ：用户编辑覆盖（editedAnswer 非空）——优先级最高，part3 用户自填也走这条；
 *     - 'generated' ：有语料且已生成卡背（corpusId 非空 且 generatedAnswer 非空）；
 *     - 'analysis'  ：其余（无语料 / part3 / 生成尚未回填）——背面走该题静态分析。
 * @author   LingoBridge
 * @created  2026-07-23
 */
import 'server-only'
import { getSupabaseServer } from '@/lib/supabase-server'
import { CURRENT_SEASON } from '@/lib/constants'
import type { QuestionAnalysis } from '@/lib/types'

/** 列表 scope：全部 / 仅已回答。 */
export type AnkiListScope = 'all' | 'answered'

/** 背面内容种类（展示层据此选渲染答案还是分析）。 */
export type AnkiBackKind = 'edited' | 'generated' | 'analysis'

/** 单张 Anki 卡（camelCase 契约，对齐 get_anki_cards RPC 返回列）。 */
export interface AnkiCard {
  questionId: string
  part: 1 | 2 | 3
  /** part3 → 其 part2 题 id；part1/2 为 null。 */
  parentQuestionId: string | null
  topic: string
  questionText: string
  questionTextZh: string | null
  cueCardTitle: string | null
  cueCardTitleZh: string | null
  season: string
  corpusId: string | null
  generatedAnswer: string | null
  editedAnswer: string | null
  analysis: QuestionAnalysis | null
  box: number
  dueAt: string
  lastReviewedAt: string | null
  /** 卡行是否已物化（false = 默认卡，SRS 字段为默认值）。 */
  hasCard: boolean
  /** 是否已回答（scope 依据，也供展示层标记）。 */
  isAnswered: boolean
  /** 背面内容判定（见模块头）。 */
  backKind: AnkiBackKind
}

/** RPC 返回的原始行（snake_case，与 0034 RETURNS TABLE 逐列对应）。 */
interface RawCardRow {
  question_id: string
  part: 1 | 2 | 3
  parent_question_id: string | null
  topic: string
  question_text: string
  question_text_zh: string | null
  cue_card_title: string | null
  cue_card_title_zh: string | null
  season: string
  corpus_id: string | null
  generated_answer: string | null
  edited_answer: string | null
  analysis: QuestionAnalysis | null
  box: number
  due_at: string
  last_reviewed_at: string | null
  has_card: boolean
  is_answered: boolean
}

/** 背面判定：编辑覆盖 > 有语料且已生成 > 分析兜底。 */
function backKindOf(row: RawCardRow): AnkiBackKind {
  if (row.edited_answer !== null && row.edited_answer !== '') return 'edited'
  if (row.corpus_id !== null && row.generated_answer !== null && row.generated_answer !== '') return 'generated'
  return 'analysis'
}

/** snake_case RPC 行 → camelCase 契约。 */
function mapRow(row: RawCardRow): AnkiCard {
  return {
    questionId: row.question_id,
    part: row.part,
    parentQuestionId: row.parent_question_id,
    topic: row.topic,
    questionText: row.question_text,
    questionTextZh: row.question_text_zh,
    cueCardTitle: row.cue_card_title,
    cueCardTitleZh: row.cue_card_title_zh,
    season: row.season,
    corpusId: row.corpus_id,
    generatedAnswer: row.generated_answer,
    editedAnswer: row.edited_answer,
    analysis: row.analysis,
    box: row.box,
    dueAt: row.due_at,
    lastReviewedAt: row.last_reviewed_at,
    hasCard: row.has_card,
    isAnswered: row.is_answered,
    backKind: backKindOf(row),
  }
}

/**
 * 列出某用户当季某 part 的 Anki 卡（已按方案 §5 排序 / part2 带 part3 成组）。
 * @param  userId  requireUser 反查出的当前用户 id
 * @param  part    1 或 2（part=2 时 part3 子题随父卡成组返回；part3 不作为独立 part 入口）
 * @param  scope   'all' 全部当季题 / 'answered' 仅已回答
 * @returns        已排序的卡列表
 * @throws         Error —— RPC 出错
 * @sideEffect     service_role 调 get_anki_cards RPC（绕 RLS，越权防护落在 p_user_id 过滤）
 */
export async function listAnkiCards(userId: string, part: 1 | 2, scope: AnkiListScope): Promise<AnkiCard[]> {
  const { data, error } = await getSupabaseServer().rpc('get_anki_cards', {
    p_user_id: userId,
    p_season: CURRENT_SEASON,
    p_part: part,
    p_scope: scope,
  })
  if (error) throw new Error(`读取 Anki 卡列表失败：${error.message}`)
  return ((data ?? []) as RawCardRow[]).map(mapRow)
}
