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
 *     - 'generated' ：有语料 且 已生成【可渲染】的分点式卡背（corpusId 非空 且 generatedAnswer 解析成点数组、
 *                     至少一个非留空点 en 非空）；
 *     - 'analysis'  ：其余（无语料 / part3 / 生成尚未回填 / 生成了但点数组全留空或空数组）——背面走静态分析。
 *
 *   ⚠️ v0.3 分点式：generatedAnswer 从「整段 text」改为「点数组 JSON 字符串」[{idx,en,noMaterial}]（drain 存
 *      JSON.stringify(AnkiAnswerPoint[])）。故【不能简单判非空】——即便所有点都留空（en=null），JSON 串
 *      "[{...}]" 仍非空，简单判非空会把「生成了但全留空」误判为有卡背。正确判据 = 解析出的点数组里至少
 *      一个点 en 是非空字符串（见 hasGeneratedContent）。空数组 / 全留空 / 非法 JSON / 旧整段文本 一律
 *      回落 analysis（保守、安全，宁可显示静态分析也不渲染一个空卡背）。
 *      与 SQL 侧 is_answered 的对齐见 0036 迁移头：is_answered 是「是否已回答」（corpus 绑定或 edited 即算，
 *      不看生成内容），backKind 是「渲染哪种背面」（需要真有可渲染的生成内容），两者语义不同、互不矛盾。
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
  /** 语料一句话概括（corpus.summary）；无语料 / 旧语料 / part3 为 null，正面据此降级不渲染。 */
  corpusSummary: string | null
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
  corpus_summary: string | null
  generated_answer: string | null
  edited_answer: string | null
  analysis: QuestionAnalysis | null
  box: number
  due_at: string
  last_reviewed_at: string | null
  has_card: boolean
  is_answered: boolean
}

/**
 * 判定 generated_answer 是否有【可渲染的分点式卡背内容】。
 * generated_answer 现在是点数组 JSON 字符串（drain 存 JSON.stringify(AnkiAnswerPoint[])，形如
 * [{"idx":0,"en":"...","noMaterial":false},{"idx":1,"en":null,"noMaterial":true}]）。
 * 有内容 = 能解析成数组 且 至少一个点 en 是非空字符串（= 非留空点）。
 * null / '' / 空数组 / 全留空 / 非法 JSON / 旧整段纯文本（JSON.parse 抛错）→ 一律 false（回落 analysis）。
 * @param raw  generated_answer 原始值
 * @returns    是否有可渲染的生成内容
 */
function hasGeneratedContent(raw: string | null): boolean {
  if (raw === null || raw === '') return false
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false // 非法 JSON / 旧整段文本 → 保守回落 analysis
  }
  if (!Array.isArray(parsed)) return false
  return parsed.some((p) => {
    if (typeof p !== 'object' || p === null) return false
    const en = (p as { en?: unknown }).en
    return typeof en === 'string' && en.trim() !== ''
  })
}

/** 背面判定：编辑覆盖 > 有语料且已生成【可渲染】卡背 > 分析兜底（见模块头 v0.3 分点式说明）。 */
function backKindOf(row: RawCardRow): AnkiBackKind {
  if (row.edited_answer !== null && row.edited_answer !== '') return 'edited'
  if (row.corpus_id !== null && hasGeneratedContent(row.generated_answer)) return 'generated'
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
    corpusSummary: row.corpus_summary,
    generatedAnswer: row.generated_answer,
    editedAnswer: row.edited_answer,
    // ⚠️ 性能：analysis（题目分析全文，占列表 payload ~71%）不再随列表下发浏览器 —— 列表返回恒 null，
    //    展示层（QuestionFlashCard 卡背）按需经 GET /api/anki/analysis?questionIds= 单/批懒加载并注入。
    //    RPC 仍取 analysis（服务端内网快链、可忽略），backKind 不依赖它（见 backKindOf），故此处置空安全。
    analysis: null,
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
