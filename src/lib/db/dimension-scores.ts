/**
 * @module   db/dimension-scores
 * @desc     读取维度得分（雷达图）与维度进度（折叠卡片），调用 Postgres 算分函数
 * @author   LingoBridge
 * @created  2026-06-02
 */
import { getSupabase, ensureSession } from '../supabase'
import type { DimensionId } from '../types'

const ALL_DIMENSIONS: DimensionId[] = [
  'emotion', 'relationship', 'space', 'spirit', 'growth', 'value',
]

export interface DimensionScore {
  dimensionId: DimensionId
  score: number // 0–1
}

export interface DimensionProgress {
  dimensionId: DimensionId
  lit: number
  total: number
}

/**
 * 读取 6 个维度的雷达图得分（§8.4 公式），value 维度因无观察点补 0
 * @returns  每个维度 0–1 的得分数组，顺序固定
 */
export async function getDimensionScores(): Promise<DimensionScore[]> {
  await ensureSession()
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('get_dimension_scores')
  if (error) throw new Error(`读取维度得分失败：${error.message}`)
  const byId = new Map(
    (data as { dimension_id: DimensionId; score: number }[]).map((r) => [
      r.dimension_id, Number(r.score),
    ]),
  )
  return ALL_DIMENSIONS.map((id) => ({ dimensionId: id, score: byId.get(id) ?? 0 }))
}

/**
 * 读取 6 个维度的进度（已亮灯观察点数 / 总数），value 维度 lit=0 total=0
 * @returns  每个维度的 lit / total
 */
export async function getDimensionProgress(): Promise<DimensionProgress[]> {
  await ensureSession()
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('get_dimension_progress')
  if (error) throw new Error(`读取维度进度失败：${error.message}`)
  const byId = new Map(
    (data as { dimension_id: DimensionId; lit: number; total: number }[]).map((r) => [
      r.dimension_id, { lit: Number(r.lit), total: Number(r.total) },
    ]),
  )
  return ALL_DIMENSIONS.map((id) => ({
    dimensionId: id,
    lit: byId.get(id)?.lit ?? 0,
    total: byId.get(id)?.total ?? 0,
  }))
}
