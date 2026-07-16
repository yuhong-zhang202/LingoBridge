/**
 * @module   db/practice-sessions-server
 * @desc     【仅服务端】复练月额度计数 —— service_role client 绕过 RLS，按显式 user_id 统计本月复练次数。
 *           客户端版 countReviewPracticeThisMonth 走 ensureSession + RLS，服务端无用户 session 上下文无法复用，
 *           故在此以 requireUser 反查出的 userId 显式过滤，逻辑与客户端版一致。禁止被任何 'use client' 文件引用。
 * @author   LingoBridge
 * @created  2026-07-11
 */
import 'server-only'

import { getSupabaseServer } from '../supabase-server'

/** 当月 1 日 0 点（本地时区）的 ISO 字符串，作为月度计数的下界（与客户端 practice-sessions 同逻辑）。 */
function monthStartISO(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

/**
 * 统计某用户本月「复练」次数（is_review = true，created_at >= 当月 1 日）。
 * service_role 绕 RLS，故须显式按 user_id 过滤（不能依赖 auth.uid()）。
 * @param  userId  requireUser 反查出的当前用户 id
 * @returns        本月复练次数
 * @throws         Error —— 查询出错
 */
export async function countReviewPracticeThisMonthServer(userId: string): Promise<number> {
  const { count, error } = await getSupabaseServer()
    .from('practice_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_review', true)
    .gte('created_at', monthStartISO())
  if (error) throw new Error(`读取复练次数失败：${error.message}`)
  return count ?? 0
}
