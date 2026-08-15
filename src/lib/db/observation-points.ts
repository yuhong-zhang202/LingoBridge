/**
 * @module   db/observation-points
 * @desc     读取 49 个观察点（参考数据，前端用来 code→id 映射与显示名称）。
 *           唯一真源是 extraction.ts 的 SYSTEM_PROMPT（产品不变式 5），本表是它的下游。
 *
 *   ⚠️ 2026-08-15（迁移 0066）：本表原有的 mapped_question_count 已删——它从未被任何触发器/迁移/
 *      脚本回写过，值双向失真。「这个观察点挂了几道题」一律用 getQuestionCountByObservations()
 *      对 question_observation_links 实算，**不要再往本表加缓存计数列**。
 *      （下面 select 用的是裸 `.select()` 取全列，故字段增删不必改查询，只需同步 Row 类型与 mapRow。）
 * @author   LingoBridge
 * @created  2026-06-02
 */
import { getSupabase, ensureSession } from '../supabase'
import type { ObservationPoint, DimensionId, ObservationLayer } from '../types'

interface ObservationPointRow {
  id: string
  code: string
  dimension_id: DimensionId
  name: string
  layer: ObservationLayer
  rich_threshold: number
  sort_order: number
}

function mapRow(row: ObservationPointRow): ObservationPoint {
  return {
    id: row.id,
    code: row.code,
    dimensionId: row.dimension_id,
    name: row.name,
    layer: row.layer,
    richThreshold: row.rich_threshold,
    sortOrder: row.sort_order,
  }
}

/**
 * 读取全部 49 个观察点，按 sort_order 升序
 * @returns  ObservationPoint 列表
 */
export async function listObservationPoints(): Promise<ObservationPoint[]> {
  await ensureSession()
  const supabase = getSupabase()
  const { data, error } = await supabase.from('observation_points').select().order('sort_order')
  if (error) throw new Error(`读取观察点失败：${error.message}`)
  return ((data ?? []) as ObservationPointRow[]).map(mapRow)
}
