/**
 * @module   db/corpus-server
 * @desc     【仅服务端】语料读取 — 使用 service_role client 绕过 RLS，供 API route 读取用户语料。
 *           禁止被任何 'use client' 文件或现有 lib/db/*.ts 引用。
 * @author   LingoBridge
 * @created  2026-06-06
 */
import 'server-only'

import { getSupabaseServer } from '../supabase-server'
import { isInternalAccount } from '../internal-accounts'
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
  // 内部账户全豁免：一处收敛。所有付费接口（practice/polish/pronounce/transcribe/analysis/matching/
  // restructure/phrases/anki/anki_swap 共 12+ 调用点）都靠本函数返回值做 `count > LIMIT` 防刷闸，
  // 这里恒返 0 即让每一处闸门天然通过，且不递增 RPC（日额度只是防刷计数器、非分析口径，跳过无副作用）。
  if (isInternalAccount(userId)) return 0
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
  // 内部账户全豁免：transcribe 的「只读早退」闸走本函数（在 bump 之前），若不同样豁免，内部账户历史
  // 已累计到上限的计数会在这里被早退挡下、绕过 bump 的豁免。恒返 0 = 「今日未用」→ 放行到（同样豁免的）
  // bump。与 bumpDailyUsageServer 一起构成日额度层的完整一处收敛。
  if (isInternalAccount(userId)) return 0
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
 * 只读某用户「某类用量的【终身】累计次数」（跨所有自然日求和，不递增）。
 * 供匿名转写的终身总量闸使用 —— 每日额度每天清零，挡不住「每天领一份新额度、无限期用下去」。
 *
 * 【为什么不需要新表】daily_usage_counts 主键是 (user_id, day, kind)、且全仓从不删除该表的行
 * （无 delete 调用、无相关 cron），故「终身累计」= 同 user_id + kind 的所有 day 行 count 之和。
 *
 * 【非原子】与 readDailyUsageServer 同性质：不加锁，并发下可能读到偏小的值。但调用方在
 * bumpDailyUsageServer 原子递增【之后】再读一次，读到的和已包含本次及并发的递增，
 * 最坏只在恰好的时序窗口多放行 1 次，不会系统性失守。
 *
 * 【读失败一律按 0 返回（失败开放）】与本模块既有约定一致。理由（两种选择后果不对称）：
 *   · 失败开放的最坏后果 = 该账号退回改动前的水位（仍受每日 ANON_TRANSCRIBE_LIMIT 限速，
 *     即 ≤25 次/天），而这正是产品已经承受了几个月、且实测无人利用的风险；
 *   · 失败关闭的最坏后果 = 一次瞬时读超时，就把「试用次数已用完，请注册后继续」发给
 *     第一次用产品的匿名用户 —— 文案不可证伪、用户无从重试，直接掐掉唯一的转化主路径。
 *   一笔钱 vs 一个用户永久流失，选前者。读失败会 warn 出来（见下），便于发现持续性故障。
 *
 * @param  userId  requireUserAllowAnon 反查出的用户 id
 * @param  kind    用量类别（同 bumpDailyUsageServer，如 'transcribe'）
 * @returns        该用户该类的终身累计次数；无记录 / 读取失败 / 内部账户均返回 0
 * @sideEffect     service_role 读 daily_usage_counts（绕 RLS，须显式按 user_id 过滤）
 */
export async function readLifetimeUsageServer(userId: string, kind: string): Promise<number> {
  // 内部账户全豁免：与 bumpDailyUsageServer / readDailyUsageServer 同一处收敛。少了这一行，
  // 产品方自用账户历史累计的转写次数会把自己永久锁死（终身闸没有"明天再来"这条退路）。
  if (isInternalAccount(userId)) return 0
  try {
    const { data, error } = await getSupabaseServer()
      .from('daily_usage_counts')
      .select('count')
      .eq('user_id', userId)
      .eq('kind', kind)
    if (error) throw new Error(error.message)
    // 行数 = 该用户用过此接口的天数（每天至多 1 行），量级极小，在应用层求和即可
    return ((data as { count: number }[] | null) ?? []).reduce((sum, row) => sum + (row.count ?? 0), 0)
  } catch (err) {
    console.warn('[corpus-server] readLifetimeUsageServer 失败，按 0 处理（失败开放，见函数注释）', err)
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
