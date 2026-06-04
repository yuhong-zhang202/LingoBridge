/**
 * @module   db/practice-sessions
 * @desc     练习场次记录 — 写入/统计练习次数、读取连续打卡天数
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { getSupabase, ensureSession } from '../supabase'

/**
 * 记录一次练习完成，显式传 user_id（表无 default auth.uid()）
 * @param  questionId  练习的题目 UUID，无则 null
 * @sideEffect         向 practice_sessions 表 insert 一行
 */
export async function recordPracticeSession(questionId: string | null): Promise<void> {
  const userId = await ensureSession()
  const { error } = await getSupabase()
    .from('practice_sessions')
    .insert({ user_id: userId, question_id: questionId })
  if (error) throw new Error(`记录练习场次失败：${error.message}`)
}

/**
 * 读取当前用户的总练习次数（RLS 自动按 user_id 过滤）
 * @returns  总练习次数；读取失败抛错
 */
export async function getPracticeCount(): Promise<number> {
  await ensureSession()
  const { count, error } = await getSupabase()
    .from('practice_sessions')
    .select('*', { count: 'exact', head: true })
  if (error) throw new Error(`读取练习次数失败：${error.message}`)
  return count ?? 0
}

/**
 * 读取当前用户的连续打卡天数（调用 Postgres RPC get_practice_streak）
 * @returns  连续天数；RPC 出错时静默返回 0
 */
export async function getStreak(): Promise<number> {
  const userId = await ensureSession()
  const { data, error } = await getSupabase().rpc('get_practice_streak', { p_user_id: userId })
  if (error) return 0
  return (data as number) ?? 0
}
