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
