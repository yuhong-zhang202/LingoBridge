/**
 * @module   db/question-analyses
 * @desc     【仅服务端】按 question_id 批量读题目分析（question_analyses.analysis，当季静态分析 JSON）。
 *           供 GET /api/anki/analysis 懒加载 —— 题卡列表不再随行下发 analysis（占 payload ~71%，见
 *           anki/list.ts mapRow ⚠️），改由题卡组件翻面时按需拉这几张。经 service_role 客户端（绕 RLS）：
 *           analysis 是当季参考数据、非用户私有（与列表默认卡背同源），匿名会话读取无越权。
 * @author   LingoBridge
 * @created  2026-07-31
 */
import 'server-only'
import { getSupabaseServer } from '@/lib/supabase-server'
import type { QuestionAnalysis } from '@/lib/types'

/**
 * 批量取某季一组题的分析，返回 { questionId: analysis } 映射（无分析的题不在映射里）。
 * @param  questionIds  题 id 列表（空则直接回 {}，不打库）
 * @param  season       季度（CURRENT_SEASON）
 * @returns             命中题的 analysis 映射
 * @throws              Error —— 查询出错
 */
export async function getAnalysesByQuestionIds(
  questionIds: string[],
  season: string,
): Promise<Record<string, QuestionAnalysis>> {
  if (questionIds.length === 0) return {}
  const { data, error } = await getSupabaseServer()
    .from('question_analyses')
    .select('question_id, analysis')
    .eq('season', season)
    .in('question_id', questionIds)
  if (error) throw new Error(`读取题目分析失败：${error.message}`)
  const out: Record<string, QuestionAnalysis> = {}
  for (const row of (data ?? []) as { question_id: string; analysis: QuestionAnalysis }[]) {
    out[row.question_id] = row.analysis
  }
  return out
}

/**
 * 读单条个性化分析缓存（corpus_question_analyses，供 /api/analysis 个性化分析路径命中判定）。
 * 命中键 = (corpus_id, question_id)。不在此处做 season / content_hash 命中判定——把两者原样带回，
 * 由 route 与「题目当前 season」+「当前语料正文哈希」比对（三重命中：键 + season 一致 + content_hash 一致）。
 * 隐私：此表按语料 CASCADE、仅 service_role 可读（RLS 无策略），不对外共享。
 * @param  corpusId    语料 id（storyId，须为真实 corpus，非 storyUrl 兜底）
 * @param  questionId  题 id
 * @returns            { analysis, season, contentHash }；无该行时返回 null
 * @throws             Error —— 查询出错（route 侧需 try/catch 兜住，静默降级为未命中）
 */
export async function getPersonalAnalysis(
  corpusId: string,
  questionId: string,
): Promise<{ analysis: QuestionAnalysis; season: string; contentHash: string } | null> {
  const { data, error } = await getSupabaseServer()
    .from('corpus_question_analyses')
    .select('analysis, season, content_hash')
    .eq('corpus_id', corpusId)
    .eq('question_id', questionId)
    .maybeSingle()
  if (error) throw new Error(`读取个性化分析失败：${error.message}`)
  if (!data) return null
  const row = data as { analysis: QuestionAnalysis; season: string; content_hash: string }
  return { analysis: row.analysis, season: row.season, contentHash: row.content_hash }
}

/**
 * 写入/更新单条个性化分析缓存（供 /api/analysis 个性化路径真调成功后回填）。
 * 复合主键 (corpus_id, question_id) 冲突则整行覆盖，updated_at 显式刷成当前时刻。
 * content_hash 为生成所依语料正文(cleaned_text)的哈希——改故事→哈希变→下次命中失败→重算。
 * 隐私：仅个性化路径（story 非空 + storyId 存在）可写入；此表随语料 CASCADE、绝不公开读。
 * @param  corpusId     语料 id（storyId）
 * @param  questionId   题 id
 * @param  season       生成所依题面季度（与题目当前 season 同值，命中判定用）
 * @param  contentHash  生成所依语料正文的哈希（命中判定用）
 * @param  analysis     整份个性化分析
 * @throws              Error —— 写入出错（route 侧需 try/catch 吞掉、只 logErr，不改变已成功的返回）
 */
export async function upsertPersonalAnalysis(
  corpusId: string,
  questionId: string,
  season: string,
  contentHash: string,
  analysis: QuestionAnalysis,
): Promise<void> {
  const { error } = await getSupabaseServer()
    .from('corpus_question_analyses')
    .upsert(
      { corpus_id: corpusId, question_id: questionId, season, content_hash: contentHash, analysis, updated_at: new Date().toISOString() },
      { onConflict: 'corpus_id,question_id' },
    )
  if (error) throw new Error(`写入个性化分析失败：${error.message}`)
}
