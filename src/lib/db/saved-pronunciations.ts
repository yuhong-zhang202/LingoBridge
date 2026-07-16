/**
 * @module   db/saved-pronunciations
 * @desc     发音收藏增删查改 + snake_case（DB）↔ camelCase（应用层）映射。
 *           语义沿用旧本地实现：id 为内容键（intended__heard 小写），add 是 upsert 覆盖（同一条只存一份、重存移到最前）；
 *           updateSavedPronunciation 就地缓存 AI 音标/提示、不动 created_at 以保持顺序。
 *           另含一次性幂等迁移：把旧 localStorage 发音收藏 upsert 进 Supabase。
 * @author   LingoBridge
 * @created  2026-07-11
 */
'use client'
import { getSupabase, ensureSession } from '../supabase'
import type { SavedPronunciation } from '../types'

/** 旧本地发音收藏 key（迁移用；与拆分前 storage.ts 的 SAVED_PRON_KEY 一致） */
const LEGACY_SAVED_PRON_KEY = 'lingobridge:saved_pronunciations'
/** 迁移完成标记 key（幂等：置位后不再重跑迁移） */
const MIGRATED_FLAG_KEY = 'lingobridge:saved_pronunciations_migrated'

interface SavedPronunciationRow {
  user_id: string
  pron_id: string
  intended: string | null
  heard: string | null
  context: string | null
  ipa_intended: string | null
  ipa_heard: string | null
  tip: string | null
  created_at: string
}

function mapRow(row: SavedPronunciationRow): SavedPronunciation {
  return {
    id: row.pron_id,
    intended: row.intended ?? '',
    heard: row.heard ?? '',
    context: row.context ?? '',
    createdAt: row.created_at,
    ipaIntended: row.ipa_intended ?? undefined,
    ipaHeard: row.ipa_heard ?? undefined,
    tip: row.tip ?? undefined,
  }
}

/** 应用层 SavedPronunciation → DB 行（camel→snake）。created_at 带上以支持「重存移到最前」 */
function toRow(userId: string, p: SavedPronunciation): Record<string, unknown> {
  return {
    user_id: userId,
    pron_id: p.id,
    intended: p.intended,
    heard: p.heard,
    context: p.context,
    ipa_intended: p.ipaIntended ?? null,
    ipa_heard: p.ipaHeard ?? null,
    tip: p.tip ?? null,
    created_at: p.createdAt,
  }
}

/**
 * 读取当前用户收藏的所有发音正音（RLS 自动按 auth.uid() 过滤）
 * @returns  发音列表，按收藏时间倒序（最新在前）
 */
export async function listSavedPronunciations(): Promise<SavedPronunciation[]> {
  await ensureSession()
  const { data, error } = await getSupabase()
    .from('saved_pronunciations')
    .select()
    .order('created_at', { ascending: false })
  if (error) throw new Error(`读取发音收藏失败：${error.message}`)
  return ((data ?? []) as SavedPronunciationRow[]).map(mapRow)
}

/**
 * 收藏一条发音正音（upsert 覆盖语义：同一 pron_id 只存一条，重存刷新时间移到最前）
 * @param  p  完整 SavedPronunciation（id 为内容键=intended__heard 小写，createdAt 由调用方给 now()）
 * @returns   落库后的 SavedPronunciation
 */
export async function addSavedPronunciation(p: SavedPronunciation): Promise<SavedPronunciation> {
  const userId = await ensureSession()
  const { data, error } = await getSupabase()
    .from('saved_pronunciations')
    .upsert(toRow(userId, p), { onConflict: 'user_id,pron_id' })
    .select()
    .single()
  if (error) throw new Error(`收藏发音失败：${error.message}`)
  return mapRow(data as SavedPronunciationRow)
}

/**
 * 取消收藏一条发音（按内容键精确删）
 * @param  id  intended__heard 小写（= SavedPronunciation.id）
 */
export async function removeSavedPronunciation(id: string): Promise<void> {
  const userId = await ensureSession()
  const { error } = await getSupabase()
    .from('saved_pronunciations')
    .delete()
    .eq('user_id', userId)
    .eq('pron_id', id)
  if (error) throw new Error(`取消发音收藏失败：${error.message}`)
}

/**
 * 就地更新一条发音收藏（缓存 AI 生成的音标/提示等），只更 patch 到的列，不动 created_at 以保持顺序
 * @param  id     intended__heard 小写（= SavedPronunciation.id）
 * @param  patch  待更新字段（如 ipaIntended / ipaHeard / tip）
 */
export async function updateSavedPronunciation(id: string, patch: Partial<SavedPronunciation>): Promise<void> {
  const userId = await ensureSession()
  const update: Record<string, unknown> = {}
  if (patch.intended !== undefined)    update.intended = patch.intended
  if (patch.heard !== undefined)       update.heard = patch.heard
  if (patch.context !== undefined)     update.context = patch.context
  if (patch.ipaIntended !== undefined) update.ipa_intended = patch.ipaIntended
  if (patch.ipaHeard !== undefined)    update.ipa_heard = patch.ipaHeard
  if (patch.tip !== undefined)         update.tip = patch.tip
  if (Object.keys(update).length === 0) return
  const { error } = await getSupabase()
    .from('saved_pronunciations')
    .update(update)
    .eq('user_id', userId)
    .eq('pron_id', id)
  if (error) throw new Error(`更新发音失败：${error.message}`)
}

/** localStorage 里的旧发音收藏形态（字段可能缺失，逐一容错） */
interface LegacySavedPronunciation {
  id?: unknown
  intended?: unknown
  heard?: unknown
  context?: unknown
  ipaIntended?: unknown
  ipaHeard?: unknown
  tip?: unknown
  createdAt?: unknown
}

/**
 * 一次性幂等迁移：把旧 localStorage 发音收藏 upsert 进 Supabase，成功后删旧 key 并打迁移标记。
 * 失败安全：整批用单条 upsert（原子），失败即抛错且不删本地旧数据，下次读收藏会自动重试；
 * upsert 天然幂等（老 id 直接作 pron_id，冲突即覆盖），重跑不产生重复。
 * @sideEffect 读/删 localStorage；一次批量 upsert 到 saved_pronunciations
 */
export async function migrateLegacySavedPronunciations(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(MIGRATED_FLAG_KEY) === '1') return

  let legacy: LegacySavedPronunciation[]
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_SAVED_PRON_KEY) ?? '[]') as LegacySavedPronunciation[]
  } catch {
    legacy = []
  }
  if (!Array.isArray(legacy) || legacy.length === 0) {
    localStorage.setItem(MIGRATED_FLAG_KEY, '1')
    return
  }

  const userId = await ensureSession()
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
  const rows = legacy
    .filter((item): item is LegacySavedPronunciation & { id: string } => typeof item.id === 'string' && item.id !== '')
    .map((item) => ({
      user_id: userId,
      pron_id: item.id,
      intended: typeof item.intended === 'string' ? item.intended : '',
      heard:    typeof item.heard === 'string' ? item.heard : '',
      context:  typeof item.context === 'string' ? item.context : '',
      ipa_intended: str(item.ipaIntended),
      ipa_heard:    str(item.ipaHeard),
      tip:          str(item.tip),
      created_at: typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : new Date().toISOString(),
    }))

  if (rows.length > 0) {
    const { error } = await getSupabase().from('saved_pronunciations').upsert(rows, { onConflict: 'user_id,pron_id' })
    if (error) throw new Error(`迁移发音收藏失败：${error.message}`)
  }

  localStorage.removeItem(LEGACY_SAVED_PRON_KEY)
  localStorage.setItem(MIGRATED_FLAG_KEY, '1')
}
