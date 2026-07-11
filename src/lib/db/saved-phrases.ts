/**
 * @module   db/saved-phrases
 * @desc     语料卡收藏（我的表达库）增删查 + snake_case（DB）↔ camelCase（应用层）映射。
 *           语义沿用旧本地实现：允许重复（无唯一约束），新收藏靠 created_at desc 天然排最前。
 *           另含一次性幂等迁移：把旧 localStorage 收藏搬到 Supabase（见 migrateLegacySavedPhrases）。
 * @author   LingoBridge
 * @created  2026-07-11
 */
'use client'
import { getSupabase, ensureSession } from '../supabase'
import type { SavedPhrase } from '../types'

/** 旧本地收藏 key（迁移用；与拆分前 storage.ts 的 SAVED_KEY 一致） */
const LEGACY_SAVED_KEY = 'lingobridge:saved_phrases'
/** 迁移完成标记 key（幂等：置位后不再重跑迁移） */
const MIGRATED_FLAG_KEY = 'lingobridge:saved_phrases_migrated'

interface SavedPhraseRow {
  id: string
  user_id: string
  original: string | null
  optimized: string | null
  note: string | null
  part: 1 | 2 | 3
  question_en: string | null
  created_at: string
}

function mapRow(row: SavedPhraseRow): SavedPhrase {
  return {
    id: row.id,
    original: row.original ?? '',
    optimized: row.optimized ?? '',
    note: row.note ?? '',
    part: row.part,
    questionEn: row.question_en ?? '',
    createdAt: row.created_at,
  }
}

/** 应用层字段 → DB 行（camel→snake）；createdAt 可选（迁移旧数据时沿用旧时间，正常新增交给 DB default） */
function toInsertRow(
  userId: string,
  p: Omit<SavedPhrase, 'id' | 'createdAt'>,
  createdAt?: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    user_id: userId,
    original: p.original,
    optimized: p.optimized,
    note: p.note,
    part: p.part,
    question_en: p.questionEn,
  }
  if (createdAt) row.created_at = createdAt
  return row
}

/**
 * 读取当前用户的所有语料卡收藏（RLS 自动按 auth.uid() 过滤）
 * @returns  收藏列表，按收藏时间倒序（最新在前）
 */
export async function listSavedPhrases(): Promise<SavedPhrase[]> {
  await ensureSession()
  const { data, error } = await getSupabase()
    .from('saved_phrases')
    .select()
    .order('created_at', { ascending: false })
  if (error) throw new Error(`读取收藏失败：${error.message}`)
  return ((data ?? []) as SavedPhraseRow[]).map(mapRow)
}

/**
 * 新增一条语料卡收藏（不去重，允许重复）
 * @param  p  SessionPolish 字段（original/optimized/note/part/questionEn），id/createdAt 由 DB 生成
 * @returns   落库后的完整 SavedPhrase（含 DB 生成的 uuid 与 created_at）
 */
export async function addSavedPhrase(p: Omit<SavedPhrase, 'id' | 'createdAt'>): Promise<SavedPhrase> {
  const userId = await ensureSession()
  const { data, error } = await getSupabase()
    .from('saved_phrases')
    .insert(toInsertRow(userId, p))
    .select()
    .single()
  if (error) throw new Error(`收藏失败：${error.message}`)
  return mapRow(data as SavedPhraseRow)
}

/**
 * 按 id 精确删除一条收藏（RLS 保证只能删自己的）
 * @param  id  saved_phrases 行的 uuid
 */
export async function removeSavedPhrase(id: string): Promise<void> {
  await ensureSession()
  const { error } = await getSupabase().from('saved_phrases').delete().eq('id', id)
  if (error) throw new Error(`删除收藏失败：${error.message}`)
}

/** localStorage 里的旧收藏形态（字段可能缺失，逐一容错） */
interface LegacySavedPhrase {
  original?: unknown
  optimized?: unknown
  note?: unknown
  part?: unknown
  questionEn?: unknown
  createdAt?: unknown
}

/**
 * 一次性幂等迁移：把旧 localStorage 语料卡收藏搬到 Supabase，成功后删旧 key 并打迁移标记。
 * 失败安全：整批用单条 insert（原子，全成或全不成），失败即抛错且不删本地旧数据，下次读收藏会自动重试。
 * 丢弃旧的时间戳 id（DB 重新生成 uuid）；createdAt 有则沿用、无则用 now。
 * @sideEffect 读/删 localStorage；一次批量 insert 到 saved_phrases
 */
export async function migrateLegacySavedPhrases(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(MIGRATED_FLAG_KEY) === '1') return

  let legacy: LegacySavedPhrase[]
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_SAVED_KEY) ?? '[]') as LegacySavedPhrase[]
  } catch {
    legacy = []
  }
  if (!Array.isArray(legacy) || legacy.length === 0) {
    // 无旧数据：直接置标记，避免每次读收藏都重复解析
    localStorage.setItem(MIGRATED_FLAG_KEY, '1')
    return
  }

  const userId = await ensureSession()
  // 旧数据是 unshift（新在前），保留各自 createdAt → DB order by created_at desc 复现原顺序
  const rows = legacy.map((item) => {
    const part = item.part === 1 || item.part === 2 || item.part === 3 ? item.part : 1
    const createdAt = typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : new Date().toISOString()
    return toInsertRow(
      userId,
      {
        original:  typeof item.original === 'string' ? item.original : '',
        optimized: typeof item.optimized === 'string' ? item.optimized : '',
        note:      typeof item.note === 'string' ? item.note : '',
        part,
        questionEn: typeof item.questionEn === 'string' ? item.questionEn : '',
      },
      createdAt,
    )
  })

  // 原子批量 insert：失败则一条不落、抛错中止（不删旧 key、不打标记），保证可安全重试、不产生重复
  const { error } = await getSupabase().from('saved_phrases').insert(rows)
  if (error) throw new Error(`迁移收藏失败：${error.message}`)

  localStorage.removeItem(LEGACY_SAVED_KEY)
  localStorage.setItem(MIGRATED_FLAG_KEY, '1')
}
