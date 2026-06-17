/**
 * @module   feedback
 * @desc     用户反馈写入（崩溃 'crash' / 主动 'manual'）— 强制 RLS 下的本人 insert；
 *           context 透传分类/路由/上下文 id/可选邮箱。日志严禁出现 message / context 内容。
 * @author   LingoBridge
 * @created  2026-06-12
 */
import type { AppError } from '@/types/errors'
import { getSupabase, ensureSession } from '@/lib/supabase'

export type FeedbackKind = 'crash' | 'manual'

/**
 * 提交一条反馈到 feedback 表。
 * @param input.kind     'crash' 或 'manual'
 * @param input.message  用户补充文字（必填，非空字符串）
 * @param input.context  任意结构的上下文，写入 jsonb 列
 * @throws  AppError NO_SESSION / FEEDBACK_FAILED
 */
export async function submitFeedback(input: {
  kind: FeedbackKind
  message: string
  context?: Record<string, unknown>
}): Promise<void> {
  const supabase = getSupabase()
  await ensureSession()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    throw { code: 'NO_SESSION', message: '当前没有用户会话' } satisfies AppError
  }
  const { error } = await supabase.from('feedback').insert({
    user_id: user.id,
    kind: input.kind,
    message: input.message,
    context: input.context ?? {},
  })
  if (error) {
    throw { code: 'FEEDBACK_FAILED', message: '反馈提交失败，请稍后再试', cause: error } satisfies AppError
  }
}
