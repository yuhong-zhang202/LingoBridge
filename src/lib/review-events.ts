/**
 * @module   review-events
 * @desc     【仅服务端】闪卡复习流水埋点写入 review_events 表 —— 每复习一次追加一行、不覆盖不回补，
 *           为经营看板的核心活跃/留存提供逐次复习信号（现有 last_reviewed_at 只存最后一次、会被覆盖）。
 *           用 service_role 写库（绕 RLS）：review_events 无客户端 insert 策略（照 0018_flow_events 同款防线，
 *           见 0046_review_events），写入唯一入口收归服务端，杜绝客户端 anon key 灌水污染复习统计。
 *
 *   隐私：本表【不存任何内容字段】——不存卡面、不存题目 id、不存词组文本，只记「谁在何时复习了哪类卡」。
 *
 * @author   LingoBridge
 * @created  2026-07-31
 */
import 'server-only'
import { getSupabaseServer } from './supabase-server'
import { logErr } from './log'

/** 复习卡类别：'anki' = 题库速览整题卡（anki_cards）；'phrase' = 词组闪卡（phrase_cards）。 */
export type ReviewEventKind = 'anki' | 'phrase'

/**
 * 记录一次闪卡复习：向 review_events 追加一行 { user_id, kind }（id/created_at 由 DB 生成，不带）。
 * @param  userId  当前复习用户 id（必须由服务端鉴权结果给出，绝不接受客户端传入的 userId）
 * @param  kind    复习卡类别（'anki' | 'phrase'）
 * @returns        Promise<void>
 * @sideEffect     用 service_role 向 review_events insert 一行（绕 RLS，无需 session）。
 *                 【内部吞掉所有异常、绝不向上抛】——埋点是旁路统计，写入失败（含迁移未跑、表不存在）
 *                 一律静默降级、只 logErr，绝不能影响或阻断用户的复习动作。
 */
export async function logReviewEvent(userId: string, kind: ReviewEventKind): Promise<void> {
  try {
    const { error } = await getSupabaseServer().from('review_events').insert({
      user_id: userId,
      kind,
    })
    if (error) throw error
  } catch (err) {
    logErr('[ReviewEvents] failed to write review event', err)
  }
}
