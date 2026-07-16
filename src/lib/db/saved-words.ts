/**
 * @module   db/saved-words
 * @desc     词组收藏增删查 + snake_case（DB）↔ camelCase（应用层）映射（含 group_tag↔group）。
 *           语义沿用旧本地实现：id 为内容键（词组英文），add 是 upsert 覆盖（同一词组只存一条、重存移到最前）。
 *           另含一次性幂等迁移：把旧 localStorage 词组收藏 upsert 进 Supabase。
 * @author   LingoBridge
 * @created  2026-07-11
 */
'use client'
import { getSupabase, ensureSession } from '../supabase'
import type { SavedWord } from '../types'

/** 旧本地词组收藏 key（迁移用；与拆分前 storage.ts 的 SAVED_WORDS_KEY 一致） */
const LEGACY_SAVED_WORDS_KEY = 'lingobridge:saved_words'
/** 迁移完成标记 key（幂等：置位后不再重跑迁移） */
const MIGRATED_FLAG_KEY = 'lingobridge:saved_words_migrated'

interface SavedWordRow {
  user_id: string
  word_id: string
  meaning: string | null
  scene: string | null
  group_tag: string | null
  level: string | null
  question_en: string | null
  created_at: string
}

function mapRow(row: SavedWordRow): SavedWord {
  return {
    id: row.word_id,
    text: row.word_id,          // id 与 text 恒为同一内容键（词组英文）
    meaning: row.meaning ?? '',
    scene: row.scene ?? '',
    group: row.group_tag ?? '',
    level: row.level ?? '',
    questionEn: row.question_en ?? '',
    createdAt: row.created_at,
  }
}

/** 应用层 SavedWord → DB 行（camel→snake，group→group_tag）。created_at 带上以支持「重存移到最前」 */
function toRow(userId: string, w: SavedWord): Record<string, unknown> {
  return {
    user_id: userId,
    word_id: w.id,
    meaning: w.meaning,
    scene: w.scene,
    group_tag: w.group,
    level: w.level,
    question_en: w.questionEn,
    created_at: w.createdAt,
  }
}

/**
 * 读取当前用户收藏的所有词组（RLS 自动按 auth.uid() 过滤）
 * @returns  词组列表，按收藏时间倒序（最新在前）
 */
export async function listSavedWords(): Promise<SavedWord[]> {
  await ensureSession()
  const { data, error } = await getSupabase()
    .from('saved_words')
    .select()
    .order('created_at', { ascending: false })
  if (error) throw new Error(`读取词组收藏失败：${error.message}`)
  return ((data ?? []) as SavedWordRow[]).map(mapRow)
}

/**
 * 收藏一个词组（upsert 覆盖语义：同一 word_id 只存一条，重存刷新为最新时间移到最前）
 * @param  w  完整 SavedWord（id 为内容键=词组英文，createdAt 由调用方给 now()）
 * @returns   落库后的 SavedWord
 */
export async function addSavedWord(w: SavedWord): Promise<SavedWord> {
  const userId = await ensureSession()
  const { data, error } = await getSupabase()
    .from('saved_words')
    .upsert(toRow(userId, w), { onConflict: 'user_id,word_id' })
    .select()
    .single()
  if (error) throw new Error(`收藏词组失败：${error.message}`)
  return mapRow(data as SavedWordRow)
}

/**
 * 取消收藏一个词组（按内容键精确删）
 * @param  id  词组英文（= SavedWord.id）
 */
export async function removeSavedWord(id: string): Promise<void> {
  const userId = await ensureSession()
  const { error } = await getSupabase()
    .from('saved_words')
    .delete()
    .eq('user_id', userId)
    .eq('word_id', id)
  if (error) throw new Error(`取消收藏失败：${error.message}`)
}

/** localStorage 里的旧词组收藏形态（字段可能缺失，逐一容错） */
interface LegacySavedWord {
  id?: unknown
  meaning?: unknown
  scene?: unknown
  group?: unknown
  level?: unknown
  questionEn?: unknown
  createdAt?: unknown
}

/**
 * 一次性幂等迁移：把旧 localStorage 词组收藏 upsert 进 Supabase，成功后删旧 key 并打迁移标记。
 * 失败安全：整批用单条 upsert（原子），失败即抛错且不删本地旧数据，下次读收藏会自动重试；
 * upsert 天然幂等（老 id 直接作 word_id，冲突即覆盖），重跑不产生重复。
 * @sideEffect 读/删 localStorage；一次批量 upsert 到 saved_words
 */
export async function migrateLegacySavedWords(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(MIGRATED_FLAG_KEY) === '1') return

  let legacy: LegacySavedWord[]
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_SAVED_WORDS_KEY) ?? '[]') as LegacySavedWord[]
  } catch {
    legacy = []
  }
  if (!Array.isArray(legacy) || legacy.length === 0) {
    localStorage.setItem(MIGRATED_FLAG_KEY, '1')
    return
  }

  const userId = await ensureSession()
  // 只迁 id（内容键）有效的行；createdAt 沿用旧值（无则 now），保序
  const rows = legacy
    .filter((item): item is LegacySavedWord & { id: string } => typeof item.id === 'string' && item.id !== '')
    .map((item) => ({
      user_id: userId,
      word_id: item.id,
      meaning:  typeof item.meaning === 'string' ? item.meaning : '',
      scene:    typeof item.scene === 'string' ? item.scene : '',
      group_tag: typeof item.group === 'string' ? item.group : '',
      level:    typeof item.level === 'string' ? item.level : '',
      question_en: typeof item.questionEn === 'string' ? item.questionEn : '',
      created_at: typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : new Date().toISOString(),
    }))

  if (rows.length > 0) {
    const { error } = await getSupabase().from('saved_words').upsert(rows, { onConflict: 'user_id,word_id' })
    if (error) throw new Error(`迁移词组收藏失败：${error.message}`)
  }

  localStorage.removeItem(LEGACY_SAVED_WORDS_KEY)
  localStorage.setItem(MIGRATED_FLAG_KEY, '1')
}
