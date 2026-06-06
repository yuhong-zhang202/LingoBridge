/**
 * @module   db/questions
 * @desc     题库数据查询层 — 题目列表、切换池、观察点匹配
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { getSupabase, ensureSession } from '../supabase'
import type { DBQuestion, QuestionWithLinks, SwitchQuestion } from '../types'

export interface QuestionWithMatchTag extends QuestionWithLinks {
  isPrimaryMatch: boolean
}

interface RawLinkRow {
  observation_point_id: string
}

interface RawQuestionRow extends DBQuestion {
  question_observation_links: RawLinkRow[]
}

interface RawNestedRow {
  is_primary: boolean
  questions: RawQuestionRow
}

/**
 * 格式化从 DB 取到的原始题目行为应用层类型
 * @param raw  含嵌套 question_observation_links 的原始行
 * @returns    QuestionWithLinks
 */
function mapQuestion(raw: RawQuestionRow): QuestionWithLinks {
  return {
    id: raw.id,
    part: raw.part,
    topic: raw.topic,
    question_text: raw.question_text,
    question_text_zh: raw.question_text_zh,
    cue_card_title: raw.cue_card_title,
    cue_card_title_zh: raw.cue_card_title_zh,
    is_new: raw.is_new,
    topic_only: raw.topic_only,
    parent_card_id: raw.parent_card_id,
    created_at: raw.created_at,
    observation_points: (raw.question_observation_links ?? []).map((l) => l.observation_point_id),
  }
}

/**
 * 格式化为切换池题目
 * @param raw  含嵌套 question_observation_links 的原始行
 * @returns    SwitchQuestion
 */
function mapSwitchQuestion(raw: RawQuestionRow): SwitchQuestion {
  return {
    id: raw.id,
    part: raw.part as 1 | 2,
    question_text: raw.question_text,
    question_text_zh: raw.question_text_zh ?? '',
    cue_card_title: raw.cue_card_title,
    cue_card_title_zh: raw.cue_card_title_zh,
    topic_only: raw.topic_only,
    observation_points: (raw.question_observation_links ?? []).map((l) => l.observation_point_id),
  }
}

/**
 * 获取所有题目（带观察点映射）
 * @param part  可选 Part 过滤（1/2/3）
 * @returns     题目列表 + 关联观察点 code 列表
 */
export async function getQuestions(part?: 1 | 2 | 3): Promise<QuestionWithLinks[]> {
  await ensureSession()
  const supabase = getSupabase()
  let query = supabase
    .from('questions')
    .select(`*, question_observation_links(observation_point_id)`)
    .order('part')
    .order('topic')

  if (part !== undefined) {
    query = query.eq('part', part)
  }

  const { data, error } = await query
  if (error) throw new Error(`读取题目失败：${error.message}`)
  return (data as RawQuestionRow[]).map(mapQuestion)
}

/**
 * 根据观察点 code 获取匹配的题目
 * @param observationPointId  观察点 code（如 'SPA_03'）
 * @param includeSecondary    true 时同时返回副标签命中的题；默认 false（仅主标签）
 * @returns                   匹配的题目列表，每项带 isPrimaryMatch 标记
 */
export async function getQuestionsByObservation(
  observationPointId: string,
  includeSecondary = false,
): Promise<QuestionWithMatchTag[]> {
  await ensureSession()
  const supabase = getSupabase()
  const base = supabase
    .from('question_observation_links')
    .select(`is_primary, questions(*, question_observation_links(observation_point_id))`)
    .eq('observation_point_id', observationPointId)

  const { data, error } = await (includeSecondary ? base : base.eq('is_primary', true))
  if (error) throw new Error(`按观察点读取题目失败：${error.message}`)
  return (data as unknown as RawNestedRow[]).map((row) => ({
    ...mapQuestion(row.questions),
    isPrimaryMatch: row.is_primary,
  }))
}

/**
 * 按多个观察点 code 聚合计算不重复题目数（一次查询代替 N 次逐个查）
 * @param  codes             观察点 code 列表（如 ['SPA_03', 'EMO_04']）
 * @param  includeSecondary  true 时副标签题也计入；默认 false（仅主标签）
 * @returns                  去重后的题目数量
 */
export async function getQuestionCountByObservations(
  codes: string[],
  includeSecondary = false,
): Promise<number> {
  if (codes.length === 0) return 0
  await ensureSession()
  const base = getSupabase()
    .from('question_observation_links')
    .select('question_id')
    .in('observation_point_id', codes)

  const { data, error } = await (includeSecondary ? base : base.eq('is_primary', true))
  if (error) throw new Error(`读取匹配题数失败：${error.message}`)
  const ids = new Set((data as { question_id: string }[]).map((r) => r.question_id))
  return ids.size
}

/**
 * 获取一张 Part 2 卡片的 Part 3 追问
 * @param cardId  Part 2 题目 UUID
 * @returns       该卡的 Part 3 题目列表（按创建顺序）
 */
export async function getQuestionsByParent(cardId: string): Promise<QuestionWithLinks[]> {
  await ensureSession()
  const { data, error } = await getSupabase()
    .from('questions')
    .select(`*, question_observation_links(observation_point_id)`)
    .eq('parent_card_id', cardId)
    .order('created_at')

  if (error) throw error
  return (data ?? []).map((q) => mapQuestion(q as RawQuestionRow))
}

/**
 * 按 ID 获取单道题目（带观察点）
 * @param id  题目 UUID
 * @returns   题目 + 观察点列表，找不到返回 null
 */
export async function getQuestionById(id: string): Promise<QuestionWithLinks | null> {
  await ensureSession()
  const { data, error } = await getSupabase()
    .from('questions')
    .select(`*, question_observation_links(observation_point_id)`)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const q = data as Record<string, unknown>
  return {
    ...(q as unknown as DBQuestion),
    observation_points: (
      (q.question_observation_links as Array<{ observation_point_id: string }>) ?? []
    ).map((l) => l.observation_point_id),
  }
}

/**
 * 获取切换池随机题目（首页随机切换用）
 * 优先取 topic_only 题目，没有则取普通映射题目
 * @param excludeIds  已展示过的题目 ID 列表（去重用）
 * @returns           一道随机题目，池子为空时返回 null
 */
export async function getRandomSwitchQuestion(
  excludeIds: string[] = [],
): Promise<SwitchQuestion | null> {
  await ensureSession()
  const supabase = getSupabase()
  const selectFields = `id, part, question_text, question_text_zh, cue_card_title, cue_card_title_zh, topic_only, question_observation_links(observation_point_id)`

  // 1. 优先取 topic_only 题目
  let q1 = supabase
    .from('questions')
    .select(selectFields)
    .in('part', [1, 2])
    .eq('topic_only', true)
    .limit(20)

  if (excludeIds.length > 0) {
    q1 = q1.not('id', 'in', `(${excludeIds.join(',')})`)
  }

  const { data: topicOnly, error: err1 } = await q1
  if (err1) throw new Error(`读取 topic_only 题目失败：${err1.message}`)

  if (topicOnly && topicOnly.length > 0) {
    const pick = topicOnly[Math.floor(Math.random() * topicOnly.length)]
    return mapSwitchQuestion(pick as RawQuestionRow)
  }

  // 2. 退而求其次：普通映射题目
  let q2 = supabase
    .from('questions')
    .select(selectFields)
    .in('part', [1, 2])
    .eq('topic_only', false)
    .limit(20)

  if (excludeIds.length > 0) {
    q2 = q2.not('id', 'in', `(${excludeIds.join(',')})`)
  }

  const { data: mapped, error: err2 } = await q2
  if (err2) throw new Error(`读取切换池题目失败：${err2.message}`)

  if (mapped && mapped.length > 0) {
    const pick = mapped[Math.floor(Math.random() * mapped.length)]
    return mapSwitchQuestion(pick as RawQuestionRow)
  }

  return null
}
