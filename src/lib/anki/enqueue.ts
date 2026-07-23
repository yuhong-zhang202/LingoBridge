/**
 * @module   anki/enqueue
 * @desc     【仅服务端】存对子时把「某用户某题的卡背生成」入队 —— 原子 upsert 卡行 + 插一条生成任务。
 *           薄封装：真正的原子性（卡行 upsert 不清进度 + 任务入队走部分唯一索引的 on conflict do nothing）
 *           落在 0033 的 enqueue_anki_generation RPC 里（PostgREST 无法对带谓词的部分索引表达 ON CONFLICT，
 *           故必须走库函数，理由见 0033 迁移头）。经 service_role 调 RPC，绕 RLS。
 *
 *   职责边界：本函数【不做】同意闸 / 计次。这两者是「用户发起请求」时的闸门，归调用方（未来的存对子端点）
 *   在入队【之前】做——与 phrases 路由「requireConsent + bumpDailyUsage 前置、再调 AI」同范式。本函数假定
 *   调用方已过闸。（外发语料的真正出口是 drain，drain 会在外发前再复核一次卡主同意，见 drain 端点。）
 * @author   LingoBridge
 * @created  2026-07-23
 */
import 'server-only'
import { getSupabaseServer } from '@/lib/supabase-server'

/** 入队参数：绑到哪个用户的哪道题、依据哪条语料（无语料时 corpusId 传 null）。 */
export interface EnqueueAnkiParams {
  userId: string
  questionId: string
  corpusId: string | null
}

/**
 * 入队一条卡背生成任务（幂等：同题已有未完成任务时不重复入队）。
 * @param params  userId / questionId / corpusId
 * @returns       upsert 后的卡行 id
 * @throws        RPC 出错时抛出（交由调用端点落入 500）
 * @sideEffect    service_role 调 enqueue_anki_generation：upsert anki_cards + 条件插 anki_generation_jobs
 */
export async function enqueueAnkiGeneration(params: EnqueueAnkiParams): Promise<string> {
  const { data, error } = await getSupabaseServer().rpc('enqueue_anki_generation', {
    p_user_id: params.userId,
    p_question_id: params.questionId,
    p_corpus_id: params.corpusId,
  })
  if (error) throw new Error(`Anki 入队失败：${error.message}`)
  return data as string
}
