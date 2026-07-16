/**
 * @module   phrase-cards
 * @desc     词组记忆卡片（Leitner 间隔重复）的 Supabase 读写
 * @author   LingoBridge
 * @created  2026-06-12
 */
import { getSupabase, ensureSession } from '@/lib/supabase'
import { nextBox, nextDue } from '@/lib/srs'
import type { PhraseCard } from '@/lib/types'

interface PhraseCardRow {
  id: string
  text: string
  meaning: string
  scene: string | null
  card_group: string | null
  box: number
  due_at: string
  last_reviewed_at: string | null
  created_at: string
}

function mapRow(r: PhraseCardRow): PhraseCard {
  return {
    id: r.id,
    text: r.text,
    meaning: r.meaning,
    scene: r.scene ?? '',
    group: r.card_group ?? '',
    box: r.box,
    dueAt: r.due_at,
    lastReviewedAt: r.last_reviewed_at,
    createdAt: r.created_at,
  }
}

/**
 * 把一个词组加入记忆卡片（同一词组重复加入则忽略）
 * @sideEffect 向 phrase_cards 插入一行（box=1，due=now）
 */
export async function addPhraseCard(input: {
  text: string; meaning: string; scene: string; group: string; sourceWordId: string
}): Promise<void> {
  const userId = await ensureSession()
  const supabase = getSupabase()
  const { error } = await supabase.from('phrase_cards').upsert(
    {
      user_id: userId,
      text: input.text,
      meaning: input.meaning,
      scene: input.scene,
      card_group: input.group,
      source_word_id: input.sourceWordId,
    },
    { onConflict: 'user_id,source_word_id', ignoreDuplicates: true },
  )
  if (error) throw new Error(`加入记忆卡片失败：${error.message}`)
}

/** 所有到期待复习的卡片（due_at <= now），按到期时间升序 */
export async function listDueCards(): Promise<PhraseCard[]> {
  await ensureSession()
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('phrase_cards')
    .select('*')
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
  if (error) throw new Error(`读取待复习卡片失败：${error.message}`)
  return (data as PhraseCardRow[]).map(mapRow)
}

/** 待复习数量（入口横幅用） */
export async function getDueCount(): Promise<number> {
  await ensureSession()
  const supabase = getSupabase()
  const { count, error } = await supabase
    .from('phrase_cards')
    .select('id', { count: 'exact', head: true })
    .lte('due_at', new Date().toISOString())
  if (error) throw new Error(`读取待复习数量失败：${error.message}`)
  return count ?? 0
}

/** 已加入卡片的来源词组 id 列表（词组收藏里标记"已加入"用） */
export async function listDeckWordIds(): Promise<string[]> {
  await ensureSession()
  const supabase = getSupabase()
  const { data, error } = await supabase.from('phrase_cards').select('source_word_id')
  if (error) throw new Error(`读取卡片列表失败：${error.message}`)
  return (data as { source_word_id: string | null }[])
    .map(r => r.source_word_id)
    .filter((v): v is string => v !== null)
}

/**
 * 评估一张卡片
 * @param card        当前卡片
 * @param remembered  右滑记住=true / 左滑没记住=false
 * @sideEffect        更新该行 box / due_at / last_reviewed_at
 */
export async function gradeCard(card: PhraseCard, remembered: boolean): Promise<void> {
  const supabase = getSupabase()
  const box = nextBox(card.box, remembered)
  const due = nextDue(box)
  const { error } = await supabase
    .from('phrase_cards')
    .update({ box, due_at: due.toISOString(), last_reviewed_at: new Date().toISOString() })
    .eq('id', card.id)
  if (error) throw new Error(`保存复习结果失败：${error.message}`)
}
