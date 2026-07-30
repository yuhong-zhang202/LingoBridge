/**
 * @module   db/corpus-server
 * @desc     【仅服务端】语料读取 — 使用 service_role client 绕过 RLS，供 API route 读取用户语料。
 *           禁止被任何 'use client' 文件或现有 lib/db/*.ts 引用。
 * @author   LingoBridge
 * @created  2026-06-06
 */
import 'server-only'

import { getSupabaseServer } from '../supabase-server'
import { mapCorpusRow, type CorpusRow } from './corpus'
import type { Corpus, CorpusSource } from '../types'

/** 当月 1 日 0 点（本地时区）的 ISO 字符串（与客户端 corpus 版同逻辑）。 */
function monthStartISO(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

/**
 * 统计某用户本月创建的语料数。service_role 绕 RLS，故须显式按 user_id 过滤（不能依赖 auth.uid()）。
 * @param  userId  requireUser 反查出的当前用户 id
 * @returns        本月语料数
 * @throws         Error —— 查询出错
 */
export async function countCorpusThisMonthServer(userId: string): Promise<number> {
  const { count, error } = await getSupabaseServer()
    .from('corpus')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', monthStartISO())
  if (error) throw new Error(`读取本月语料数失败：${error.message}`)
  return count ?? 0
}

/**
 * 统计某用户的 corpus 总条数（不限时间）。用于匿名试用「仅 1 条」额度判定。
 * @param  userId  requireUserAllowAnon 反查出的用户 id
 * @returns        该用户 corpus 总条数
 * @throws         Error —— 查询出错
 * @sideEffect     service_role 读 corpus（绕 RLS，须显式按 user_id 过滤）
 */
export async function countCorpusForUserServer(userId: string): Promise<number> {
  const { count, error } = await getSupabaseServer()
    .from('corpus')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error) throw new Error(`读取语料总数失败：${error.message}`)
  return count ?? 0
}

/**
 * 原子递增某用户「今日整理次数」并返回递增后的值（含本次）。用于匿名 restructure 当日额度。
 * @param  userId  requireUserAllowAnon 反查出的用户 id
 * @returns        递增后的当日计数
 * @throws         Error —— RPC 出错
 * @sideEffect     service_role 调 RPC bump_anon_restructure（原子 upsert 计数，绕 RLS）
 */
export async function bumpAnonRestructureTodayServer(userId: string): Promise<number> {
  const { data, error } = await getSupabaseServer().rpc('bump_anon_restructure', { p_user_id: userId })
  if (error) throw new Error(`匿名整理计数失败：${error.message}`)
  return (data as number) ?? 0
}

/**
 * 原子递增某用户「今日某类用量」并返回递增后的值（含本次）。通用每日计数，
 * 供 practice/polish/pronounce/transcribe 等付费接口判匿名试用上限与注册熔断上限。
 * @param  userId  requireUserAllowAnon 反查出的用户 id
 * @param  kind    用量类别（practice / polish / pronounce / transcribe）
 * @returns        递增后的当日该类计数
 * @throws         Error —— RPC 出错
 * @sideEffect     service_role 调 RPC bump_daily_usage（原子 upsert 计数，绕 RLS）
 */
export async function bumpDailyUsageServer(userId: string, kind: string): Promise<number> {
  const { data, error } = await getSupabaseServer().rpc('bump_daily_usage', { p_user_id: userId, p_kind: kind })
  if (error) throw new Error(`每日用量计数失败：${error.message}`)
  return (data as number) ?? 0
}

/**
 * 只读某用户「今日某类用量」当前值（不递增）。供需要「先便宜地早退、真花钱前才计次」的接口
 * （如 transcribe：转码在前、ASR 在后）做前置早退判断。
 *
 * 【非原子，只能当优化用】本函数不加锁、不递增，并发下可能读到偏小的值；额度的权威闸门仍是
 * bumpDailyUsageServer 的原子递增 + 递增后复核。读失败或时区口径不一致时一律按 0 返回（失败开放），
 * 最坏结果只是白做一次转码，绝不会放过超额请求。
 *
 * @param  userId  requireUserAllowAnon 反查出的用户 id
 * @param  kind    用量类别（同 bumpDailyUsageServer）
 * @returns        当日该类已计次数；无记录 / 读取失败均返回 0
 * @sideEffect     service_role 读 daily_usage_counts（绕 RLS，须显式按 user_id 过滤）
 */
export async function readDailyUsageServer(userId: string, kind: string): Promise<number> {
  try {
    // day 列由 RPC 用 Postgres current_date 写入（库时区 UTC），故这里同样取 UTC 日期对齐口径
    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await getSupabaseServer()
      .from('daily_usage_counts')
      .select('count')
      .eq('user_id', userId)
      .eq('day', today)
      .eq('kind', kind)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as { count: number } | null)?.count ?? 0
  } catch (err) {
    console.warn('[corpus-server] readDailyUsageServer 失败，按 0 处理（权威闸门在 bump）', err)
    return 0
  }
}

/**
 * 服务端创建一段新语料（status 默认 draft，cleaned_text 暂空）。service_role insert，user_id 用入参。
 * @param  userId  requireUser 反查出的当前用户 id（作为行 user_id，防客户端伪造）
 * @param  input   source（voice/text）与原始文本
 * @returns        映射后的完整 Corpus（含服务端生成的 id / created_at，供后续整理/匹配链路使用）
 * @throws         Error —— 写入出错
 */
export async function createCorpusServer(
  userId: string,
  input: { source: CorpusSource; rawText: string },
): Promise<Corpus> {
  const { data, error } = await getSupabaseServer()
    .from('corpus')
    .insert({ user_id: userId, source: input.source, raw_text: input.rawText })
    .select()
    .single()
  if (error) throw new Error(`保存语料失败：${error.message}`)
  return mapCorpusRow(data as CorpusRow)
}

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

/**
 * 按 id 读取单条语料的一句话概括（summary），供换语料弹窗对比「当前已绑语料」用。
 * 使用 service_role client，绕 RLS；不存在 / 无概括 / 出错一律返回 null（弹窗降级为中性占位文案）。
 * @param  id  corpus UUID
 * @returns    语料一句话概括，或 null
 */
export async function getCorpusSummaryServer(id: string): Promise<string | null> {
  if (!id) return null
  try {
    const { data, error } = await getSupabaseServer()
      .from('corpus')
      .select('summary')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return (data as { summary: string | null } | null)?.summary ?? null
  } catch (err) {
    console.error('[corpus-server] getCorpusSummaryServer failed', err)
    return null
  }
}

/**
 * 按 corpusId 读取匹配时挑定的「主观察点」code（corpus_point_links.role='primary' → observation_points.code）。
 * 供分析页维度标签显示「用户语料匹配到的维度」而非题目第一个观察点维度。
 * 使用 service_role client 绕 RLS；归属由调用方（analysis route 已 assertCorpusOwner）把关，本函数只读。
 * 容错优先：无 primary 行 / 查询出错一律返回 null，让上游回落题目维度，绝不抛、不阻塞分析主流程。
 * @param  corpusId  corpus UUID
 * @returns          主观察点 code（如 EMO_04），无 / 出错时 null
 */
export async function getCorpusPrimaryPointCodeServer(corpusId: string): Promise<string | null> {
  if (!corpusId) return null
  try {
    const { data, error } = await getSupabaseServer()
      .from('corpus_point_links')
      .select('observation_points(code)')
      .eq('corpus_id', corpusId)
      .eq('role', 'primary')
      .maybeSingle()
    if (error) throw error
    // corpus_point_links → observation_points 是 many-to-one，Supabase 嵌套返回「对象」而非数组；
    // 兼容 对象/数组/空（与客户端 getCorpusPointCodes 同口径）。
    const op = (data as { observation_points: { code: string } | { code: string }[] | null } | null)
      ?.observation_points
    if (!op) return null
    return Array.isArray(op) ? (op[0]?.code ?? null) : op.code
  } catch (err) {
    console.error('[corpus-server] getCorpusPrimaryPointCodeServer failed', err)
    return null
  }
}
