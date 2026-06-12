/**
 * @module   feedback
 * @desc     用户反馈（崩溃/主动）写入 Supabase
 * @author   LingoBridge
 * @created  2026-06-12
 */
import { getSupabase, ensureSession } from '@/lib/supabase'

export type FeedbackKind = 'crash' | 'manual'

export interface FeedbackContext {
  route?: string
  errorMessage?: string
}

/**
 * 提交一条反馈
 * @sideEffect 向 feedback 表插入一行
 */
export async function submitFeedback(input: {
  kind: FeedbackKind
  message: string
  context?: FeedbackContext
}): Promise<void> {
  const userId = await ensureSession()
  const supabase = getSupabase()
  const { error } = await supabase.from('feedback').insert({
    user_id: userId,
    kind: input.kind,
    message: input.message,
    context: input.context ?? {},
  })
  if (error) throw new Error(`反馈提交失败：${error.message}`)
}
