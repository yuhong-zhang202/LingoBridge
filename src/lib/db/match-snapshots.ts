/**
 * @module   db/match-snapshots
 * @desc     【仅服务端】匹配结果快照读写 —— 使用 service_role client 绕过 RLS，供 api/matching/route.ts
 *           读档（命中即冻结返回、不跑模型）/ 写档（重算后落库整份结果）。
 *           禁止被任何 'use client' 文件或客户端可达模块引用（含 service_role 权限链路）。
 * @author   LingoBridge
 * @created  2026-07-17
 */
import 'server-only'

import { getSupabaseServer } from '../supabase-server'
import type { FunnelMatchResult } from '@/services/matching'

/** 一段语料的匹配存档：整份结果 + 冻结时的正文哈希与算法口径版本（供命中判定） */
export interface MatchSnapshot {
  result: FunnelMatchResult
  storyHash: string
  algoVersion: string | null
}

/**
 * 按 corpusId 读取匹配快照。service_role 绕 RLS，按主键 corpus_id 精确取一行。
 * @param  corpusId  corpus UUID
 * @returns          存档（含 result / storyHash / algoVersion），无档或出错时返回 null（视为未命中，走重算）
 */
export async function getMatchSnapshotServer(corpusId: string): Promise<MatchSnapshot | null> {
  if (!corpusId) return null
  try {
    const { data, error } = await getSupabaseServer()
      .from('corpus_match_snapshots')
      .select('result, story_hash, algo_version')
      .eq('corpus_id', corpusId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const row = data as { result: FunnelMatchResult; story_hash: string; algo_version: string | null }
    return { result: row.result, storyHash: row.story_hash, algoVersion: row.algo_version }
  } catch (err) {
    console.error('[match-snapshots] getMatchSnapshotServer failed', err)
    return null
  }
}

/**
 * upsert 一段语料的匹配快照（冲突键 corpus_id，一段语料只留一行）。
 * updated_at 每次显式刷成当前时间（不依赖 DB 触发器）。
 * @param  input  corpusId / userId（存档归属）/ result（整份结果）/ storyHash / algoVersion
 * @throws        Error —— 写入出错（调用方需 catch，写档失败不应阻断匹配返回）
 * @sideEffect    service_role 向 corpus_match_snapshots upsert 一行（绕 RLS，须显式带 user_id）
 */
export async function upsertMatchSnapshotServer(input: {
  corpusId: string
  userId: string
  result: FunnelMatchResult
  storyHash: string
  algoVersion: string
}): Promise<void> {
  const { error } = await getSupabaseServer()
    .from('corpus_match_snapshots')
    .upsert(
      {
        corpus_id: input.corpusId,
        user_id: input.userId,
        result: input.result,
        story_hash: input.storyHash,
        algo_version: input.algoVersion,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'corpus_id' },
    )
  if (error) throw error
}
