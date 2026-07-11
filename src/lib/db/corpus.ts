/**
 * @module   db/corpus
 * @desc     语料增查操作 + snake_case（DB）↔ camelCase（应用层）映射
 * @author   LingoBridge
 * @created  2026-06-02
 */

import { getSupabase, ensureSession } from '../supabase'
import type { Corpus, CorpusSource, CorpusStatus } from '../types'

/** 故事链路月额度（自然月） */
export const STORY_MONTHLY_LIMIT = 10

/** 当月 1 日 0 点（本地时区）的 ISO 字符串。 */
function monthStartISO(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

/**
 * 统计当月创建的语料数（RLS 自动按当前用户过滤），用于触发故事链路月额度。
 */
export async function countCorpusThisMonth(): Promise<number> {
  await ensureSession()
  const { count, error } = await getSupabase()
    .from('corpus')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', monthStartISO())
  if (error) throw new Error(`读取本月语料数失败：${error.message}`)
  return count ?? 0
}

/** corpus 表行（snake_case）；与服务端创建路径 corpus-server.ts 共用映射 */
export interface CorpusRow {
  id: string
  user_id: string
  source: CorpusSource
  raw_text: string
  cleaned_text: string | null
  audio_url: string | null
  status: CorpusStatus
  created_at: string
  updated_at: string
}

export function mapCorpusRow(row: CorpusRow): Corpus {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    rawText: row.raw_text,
    cleanedText: row.cleaned_text,
    audioUrl: row.audio_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 读取当前用户的所有语料（RLS 已自动按 auth.uid() 过滤）
 * @returns  语料列表，按创建时间倒序
 */
export async function listMyCorpus(): Promise<Corpus[]> {
  await ensureSession()
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('corpus')
    .select()
    .order('created_at', { ascending: false })
  if (error) throw new Error(`读取语料失败：${error.message}`)
  return ((data ?? []) as CorpusRow[]).map(mapCorpusRow)
}

/**
 * 按 id 读取单条语料，不存在时返回 null
 * @param  id  corpus UUID
 * @returns    Corpus 实体或 null
 */
export async function getCorpusById(id: string): Promise<Corpus | null> {
  await ensureSession()
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('corpus')
    .select()
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`读取语料失败：${error.message}`)
  return data ? mapCorpusRow(data as CorpusRow) : null
}

/**
 * 写入萃取结果：把主/副观察点写进 corpus_point_links，状态推进到 extracted
 * primaryCode / secondaryCode 是观察点 code（如 'REL_04'），内部自动换成 point_id
 * 支持幂等：先清空旧归类再插入，允许重新萃取
 * @param corpusId      corpus UUID
 * @param primaryCode   主观察点 code
 * @param secondaryCode 副观察点 code（无则 null）
 */
export async function saveExtraction(
  corpusId: string,
  primaryCode: string,
  secondaryCode: string | null,
): Promise<void> {
  await ensureSession()
  const supabase = getSupabase()

  // code → id
  const codes = secondaryCode ? [primaryCode, secondaryCode] : [primaryCode]
  const { data: points, error: pErr } = await supabase
    .from('observation_points')
    .select('id, code')
    .in('code', codes)
  if (pErr) throw new Error(`查观察点失败：${pErr.message}`)

  const idByCode = new Map((points as { id: string; code: string }[]).map((p) => [p.code, p.id]))
  const primaryId = idByCode.get(primaryCode)
  if (!primaryId) throw new Error(`未知观察点 code：${primaryCode}`)

  // 幂等：先删该语料已有的归类，再插（支持重新萃取）
  const { error: dErr } = await supabase.from('corpus_point_links').delete().eq('corpus_id', corpusId)
  if (dErr) throw new Error(`清理旧归类失败：${dErr.message}`)

  const rows: { corpus_id: string; point_id: string; role: string }[] = [
    { corpus_id: corpusId, point_id: primaryId, role: 'primary' },
  ]
  if (secondaryCode) {
    const secondaryId = idByCode.get(secondaryCode)
    if (secondaryId) rows.push({ corpus_id: corpusId, point_id: secondaryId, role: 'secondary' })
  }

  const { error: iErr } = await supabase.from('corpus_point_links').insert(rows)
  if (iErr) throw new Error(`写入归类失败：${iErr.message}`)

  const { error: uErr } = await supabase.from('corpus').update({ status: 'extracted' }).eq('id', corpusId)
  if (uErr) throw new Error(`更新语料状态失败：${uErr.message}`)
}

/**
 * 读取单条语料关联的观察点 code，及主观察点 code
 * @param  corpusId  corpus UUID
 * @returns          codes（全部）+ primaryCode（role='primary' 的那个，无则取首个）
 */
export async function getCorpusPointCodes(
  corpusId: string,
): Promise<{ codes: string[]; primaryCode: string | null }> {
  await ensureSession()
  const { data, error } = await getSupabase()
    .from('corpus_point_links')
    .select('role, observation_points(code)')
    .eq('corpus_id', corpusId)
  if (error) throw new Error(`读取观察点失败：${error.message}`)
  // corpus_point_links → observation_points 是 many-to-one，Supabase 嵌套返回「对象」而非数组；
  // 兼容 对象/数组/空，并对 data 本身做 null 兜底
  const rows = (data ?? []) as unknown as Array<{
    role: string
    observation_points: { code: string } | { code: string }[] | null
  }>
  const items = rows.map((r) => {
    const op = r.observation_points
    const code = !op ? null : Array.isArray(op) ? (op[0]?.code ?? null) : op.code
    return { role: r.role, code }
  })
  const codes = items.flatMap((item) => (item.code ? [item.code] : []))
  const primaryCode = items.find((item) => item.role === 'primary')?.code ?? codes[0] ?? null
  return { codes, primaryCode }
}

/**
 * 读取当前用户所有语料命中的观察点 code（去重）
 * corpus_point_links.point_id → observation_points(id) 有 FK，使用嵌套查询
 * @returns  去重后的观察点 code 列表（如 ['SPA_03', 'EMO_04']）
 */
export async function listMyObservationCodes(): Promise<string[]> {
  await ensureSession()
  const { data, error } = await getSupabase()
    .from('corpus_point_links')
    .select('observation_points(code)')
  if (error) throw new Error(`读取命中观察点失败：${error.message}`)
  // corpus_point_links → observation_points 是 many-to-one，Supabase 嵌套返回的是「对象」而非数组；
  // 兼容 对象 / 数组 / 空 三种形态，避免对对象调用 .map 抛错
  const rows = (data ?? []) as unknown as Array<{
    observation_points: { code: string } | { code: string }[] | null
  }>
  const codes = rows.flatMap((row) => {
    const op = row.observation_points
    if (!op) return []
    return Array.isArray(op) ? op.map((x) => x.code) : [op.code]
  })
  return [...new Set(codes)]
}

/**
 * 删除单条语料，先清关联的 corpus_point_links，再删除语料行
 * @param  id  corpus UUID
 */
export async function deleteCorpus(id: string): Promise<void> {
  await ensureSession()
  const supabase = getSupabase()
  const { error: linkErr } = await supabase.from('corpus_point_links').delete().eq('corpus_id', id)
  if (linkErr) throw new Error(`清理语料归类失败：${linkErr.message}`)
  const { error } = await supabase.from('corpus').delete().eq('id', id)
  if (error) throw new Error(`删除语料失败：${error.message}`)
}

/**
 * 写回整理后的短文，状态从 draft 推进到 restructured
 * @param  id           corpus UUID
 * @param  cleanedText  千问整理后的中文短文
 * @returns             更新后的 Corpus 实体
 */
export async function updateCorpusCleaned(id: string, cleanedText: string): Promise<Corpus> {
  await ensureSession()
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('corpus')
    .update({ cleaned_text: cleanedText, status: 'restructured' })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(`更新语料失败：${error.message}`)
  return mapCorpusRow(data as CorpusRow)
}
