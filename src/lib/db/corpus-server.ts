/**
 * @module   db/corpus-server
 * @desc     【仅服务端】语料读取 — 使用 service_role client 绕过 RLS，供 API route 读取用户语料。
 *           禁止被任何 'use client' 文件或现有 lib/db/*.ts 引用。
 * @author   LingoBridge
 * @created  2026-06-06
 */
import 'server-only'

import { getSupabaseServer } from '../supabase-server'

/**
 * 按 id 读取单条语料的整理后正文（cleaned_text）
 * 使用 service_role client，不需要用户 session，完全绕过 RLS。
 * @param  id  corpus UUID
 * @returns    整理后的故事正文，不存在或出错时返回 null
 */
export async function getCorpusByIdServer(id: string): Promise<string | null> {
  if (!id) return null
  try {
    const { data, error } = await getSupabaseServer()
      .from('corpus')
      .select('cleaned_text')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return (data as { cleaned_text: string | null } | null)?.cleaned_text ?? null
  } catch (err) {
    console.error('[corpus-server] getCorpusByIdServer failed', err)
    return null
  }
}
