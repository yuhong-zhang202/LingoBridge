/**
 * @module   db/matches
 * @desc     语料 ↔ 题目 匹配结果增查 + snake_case（DB）↔ camelCase（应用层）映射
 * @author   LingoBridge
 * @created  2026-06-21
 */

import { getSupabase, ensureSession } from '../supabase'
import type { CorpusSource } from '../types'

/** 匹配档位：故事流 high/mid/low（相关性档位），雅思直达流 chosen（用户已选） */
export type MatchLevel = 'high' | 'mid' | 'low' | 'chosen'

/** listCorpusByQuestion 返回项：corpus 摘要 + 该对的匹配档位 */
export interface CorpusMatch {
  id: string
  cleanedText: string | null
  source: CorpusSource
  createdAt: string
  matchLevel: MatchLevel
}

/** 排序档位权重：high → mid → low/chosen（low 与 chosen 同档） */
const LEVEL_RANK: Record<MatchLevel, number> = { high: 0, mid: 1, low: 2, chosen: 2 }

/** 匹配排序的最小可比较形态 —— 单题反查与批量预取共用同一套「谁更贴合」判据 */
interface RankableMatch {
  createdAt: string
  matchLevel: MatchLevel
}

/**
 * 匹配优先级比较器：档位 high → mid → low/chosen，同档 createdAt 新→旧
 *
 * listCorpusByQuestion 与 mapBestCorpusIdByQuestion 必须选出同一条语料，
 * 故判据只此一份；改这里等于同时改两条路径，不会出现「预取选 A、兜底选 B」。
 *
 * @param a  左项
 * @param b  右项
 * @returns  Array.prototype.sort 约定的负/零/正
 */
function compareMatchRank(a: RankableMatch, b: RankableMatch): number {
  const r = LEVEL_RANK[a.matchLevel] - LEVEL_RANK[b.matchLevel]
  if (r !== 0) return r
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
}

/**
 * 插入/更新一条「语料 ↔ 题目」匹配（冲突键 corpus_id,question_id，同一对只留一行）
 * @param corpusId    corpus UUID
 * @param questionId  questions UUID
 * @param level       匹配档位
 */
export async function upsertMatch(corpusId: string, questionId: string, level: MatchLevel): Promise<void> {
  const userId = await ensureSession()
  const { error } = await getSupabase()
    .from('corpus_question_matches')
    .upsert(
      { user_id: userId, corpus_id: corpusId, question_id: questionId, match_level: level },
      { onConflict: 'corpus_id,question_id' },
    )
  if (error) throw new Error(`保存匹配失败：${error.message}`)
}

interface MatchJoinRow {
  match_level: MatchLevel
  corpus: { id: string; cleaned_text: string | null; source: CorpusSource; created_at: string }
        | { id: string; cleaned_text: string | null; source: CorpusSource; created_at: string }[]
        | null
}

/**
 * 反查：列出「能匹配这道题」的语料（RLS 自动按当前用户过滤）
 * 排序 high → mid → low/chosen，同档按 createdAt 新→旧
 * @param  questionId  questions UUID
 * @returns            corpus 摘要 + 匹配档位列表
 */
export async function listCorpusByQuestion(questionId: string): Promise<CorpusMatch[]> {
  await ensureSession()
  const { data, error } = await getSupabase()
    .from('corpus_question_matches')
    .select('match_level, corpus:corpus_id(id, cleaned_text, source, created_at)')
    .eq('question_id', questionId)
  if (error) throw new Error(`读取匹配语料失败：${error.message}`)

  // corpus_question_matches → corpus 是 many-to-one，Supabase 嵌套返回「对象」而非数组；
  // 兼容 对象 / 数组 / 空 三种形态
  const rows = (data ?? []) as unknown as MatchJoinRow[]
  const items = rows.flatMap((row) => {
    const c = Array.isArray(row.corpus) ? row.corpus[0] : row.corpus
    if (!c) return []
    return [{
      id: c.id,
      cleanedText: c.cleaned_text,
      source: c.source,
      createdAt: c.created_at,
      matchLevel: row.match_level,
    }]
  })

  return items.sort(compareMatchRank)
}

interface BestMatchJoinRow {
  question_id: string
  match_level: MatchLevel
  corpus: { id: string; created_at: string }
        | { id: string; created_at: string }[]
        | null
}

/**
 * 批量预取：一次查出本人全部匹配，按题聚合出「最贴合的那条语料 id」
 *
 * 存在的理由是延迟而非功能 —— 题库「练习」按钮此前每次点击都要现查一次
 * listCorpusByQuestion 才能拿到 storyId，用户感知为「点了没反应」。改由题库
 * 挂载时随其它数据并行预取一次，点击即可同步取用。
 *
 * 选取判据与 listCorpusByQuestion 完全一致（共用 compareMatchRank），
 * 因此预取命中与现查兜底必然得到同一条语料。
 *
 * 数据量：行数 = 本人语料数 × 各自匹配到的题数，且只取 id/created_at 两列，
 * 与题库已有的六路请求相比可忽略。
 *
 * @returns  questionId → corpus UUID；无匹配的题不出现在结果里
 */
export async function mapBestCorpusIdByQuestion(): Promise<Record<string, string>> {
  await ensureSession()
  const { data, error } = await getSupabase()
    .from('corpus_question_matches')
    .select('question_id, match_level, corpus:corpus_id(id, created_at)')
  if (error) throw new Error(`读取匹配语料失败：${error.message}`)

  // 嵌套 corpus 的 对象/数组/空 三态兼容，同 listCorpusByQuestion
  const rows = (data ?? []) as unknown as BestMatchJoinRow[]
  const best: Record<string, { id: string } & RankableMatch> = {}
  for (const row of rows) {
    const c = Array.isArray(row.corpus) ? row.corpus[0] : row.corpus
    if (!c) continue
    const cur = { id: c.id, createdAt: c.created_at, matchLevel: row.match_level }
    const prev = best[row.question_id]
    if (!prev || compareMatchRank(cur, prev) < 0) best[row.question_id] = cur
  }

  const out: Record<string, string> = {}
  for (const [qid, m] of Object.entries(best)) out[qid] = m.id
  return out
}
