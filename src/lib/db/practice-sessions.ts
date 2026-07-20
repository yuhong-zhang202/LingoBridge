/**
 * @module   db/practice-sessions
 * @desc     练习场次记录 — 写入/统计练习次数、复练月计数、读取连续打卡天数
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { getSupabase, ensureSession } from '../supabase'

/**
 * 雅思"复练"月额度（自然月）。
 * ⚠️【内测前必调回 10】当前 100 是产品方自测临时放开（18d96fd），设计值是 10。
 *    与 STORY_MONTHLY_LIMIT（corpus.ts）一并调回。
 */
export const IELTS_MONTHLY_LIMIT = 100

/** 当月 1 日 0 点（本地时区）的 ISO 字符串，作为月度计数的下界。 */
function monthStartISO(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

/**
 * 记录一次练习完成，显式传 user_id（表无 default auth.uid()）
 * @param  questionId  练习的题目 UUID，无则 null
 * @param  isReview    是否复练（题库/用完页发起 = true；故事链路自带 = false）
 * @sideEffect         向 practice_sessions 表 insert 一行
 */
export async function recordPracticeSession(questionId: string | null, isReview: boolean): Promise<void> {
  const userId = await ensureSession()
  const { error } = await getSupabase()
    .from('practice_sessions')
    .insert({ user_id: userId, question_id: questionId, is_review: isReview })
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
 * 统计当月「复练」次数（is_review = true，created_at >= 当月 1 日）。
 * 用于触发"雅思练习额度用完"。
 */
export async function countReviewPracticeThisMonth(): Promise<number> {
  await ensureSession()
  const { count, error } = await getSupabase()
    .from('practice_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('is_review', true)
    .gte('created_at', monthStartISO())
  if (error) throw new Error(`读取复练次数失败：${error.message}`)
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
