/**
 * @module   apply-0017（一次性执行器，真源是 supabase/migrations/0017_observation_points_rel06_rel12.sql）
 * @desc     本仓库无 supabase CLI / 无 DB 连接串，migration 只能经 service-role REST 通道落库。
 *           本脚本严格执行 0017 的两条语句，幂等 + 落库前备份受影响 observation_points 行：
 *             (1) UPDATE REL_06 name → '一个让你印象深刻的陌生人'（对齐 prompt）
 *             (2) upsert REL_12（不存在才插；等价 ON CONFLICT(code) DO NOTHING）
 *           默认 --dry-run 只读只报告；--apply 才写。运行：
 *             npx tsx --conditions=react-server --env-file=.env.local scripts/apply-0017.ts [-- --apply]
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getSupabaseServer } from '@/lib/supabase-server'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKUP_DIR = join(__dirname, 'data', 'backup')

const REL06_NEW_NAME = '一个让你印象深刻的陌生人'
const REL12_ROW = { code: 'REL_12', dimension_id: 'relationship', name: '一个让你印象深刻的人', layer: 'rhythm', mapped_question_count: 0, rich_threshold: 2, sort_order: 12 }

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes('--apply')
  const sb = getSupabaseServer()

  const { data, error } = await sb.from('observation_points').select('*').in('code', ['REL_06', 'REL_12'])
  if (error) throw new Error(`读取 observation_points 失败：${error.message}`)
  const rows = data ?? []
  const rel06 = rows.find((r) => r.code === 'REL_06')
  const rel12 = rows.find((r) => r.code === 'REL_12')

  console.log('# apply-0017 报告\n')
  console.log('## (1) REL_06 改名')
  if (!rel06) console.log('  ! REL_06 不存在（异常，请核查）')
  else console.log(`  当前 name = 「${rel06.name}」  →  目标 「${REL06_NEW_NAME}」  ${rel06.name === REL06_NEW_NAME ? '(已对齐,no-op)' : '(将更新)'}`)
  console.log('\n## (2) REL_12 建点')
  if (rel12) console.log(`  已存在(no-op): name=「${rel12.name}」 layer=${rel12.layer} sort=${rel12.sort_order}`)
  else console.log(`  不存在 → 将插入 ${JSON.stringify(REL12_ROW)}`)

  if (!apply) {
    console.log('\n———\n本次为 dry-run，未写库。加 --apply 执行（apply 前自动备份受影响行）。')
    return
  }

  mkdirSync(BACKUP_DIR, { recursive: true })
  const backupPath = join(BACKUP_DIR, `observation-points-0017-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(backupPath, JSON.stringify(rows, null, 2), 'utf-8')
  console.log(`\n已备份受影响行(旧值) → ${backupPath}`)

  if (rel06 && rel06.name !== REL06_NEW_NAME) {
    const { error: e1 } = await sb.from('observation_points').update({ name: REL06_NEW_NAME }).eq('code', 'REL_06')
    if (e1) throw new Error(`REL_06 改名失败：${e1.message}`)
    console.log('✓ REL_06 已改名')
  } else console.log('· REL_06 无需改（已对齐或缺失）')

  if (!rel12) {
    const { error: e2 } = await sb.from('observation_points').insert(REL12_ROW)
    if (e2) throw new Error(`REL_12 插入失败：${e2.message}`)
    console.log('✓ REL_12 已建点')
  } else console.log('· REL_12 已存在，跳过')
}

main().catch((e) => { console.error(e); process.exit(1) })
