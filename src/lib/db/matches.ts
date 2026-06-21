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

  return items.sort((a, b) => {
    const r = LEVEL_RANK[a.matchLevel] - LEVEL_RANK[b.matchLevel]
    if (r !== 0) return r
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  })
}
