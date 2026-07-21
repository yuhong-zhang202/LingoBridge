/**
 * seed-reference —— 种入参照/taxonomy 表（dimensions + observation_points）。
 *
 * 背景：这两张表是「AI 观察点体系」的真源之一，历史上手动种入、【不在迁移里】
 * （0001/0002 只建表；0003/0017 只插了个别点）。故 db:push 建完 schema 后必须再跑本脚本，
 * 否则新库缺维度/观察点、匹配链路整个瘫。数据取自 scripts/data/{dimensions,observation-points}-seed.json
 * （由主会话从生产库 REST 导出）。幂等 upsert：dimensions 按 id、observation_points 按 code。
 *
 * 用法：npm run seed:reference   （直连 SUPABASE_DB_URL）
 */
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dirname, 'data')

async function upsert(client, table, conflictKey, rows) {
  if (rows.length === 0) { console.log(`${table}: 种子为空,跳过`); return }
  const cols = Object.keys(rows[0])
  const setCols = cols.filter((c) => c !== conflictKey)
  const setClause = setCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')
  let n = 0
  for (const row of rows) {
    const vals = cols.map((c) => row[c])
    const ph = cols.map((_, i) => `$${i + 1}`).join(', ')
    const sql = `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${ph}) ` +
      `ON CONFLICT ("${conflictKey}") DO UPDATE SET ${setClause}`
    await client.query(sql, vals)
    n++
  }
  console.log(`✓ ${table}: upsert ${n} 行（冲突键 ${conflictKey}）`)
}

async function main() {
  const url = process.env.SUPABASE_DB_URL
  if (!url) { console.error('✗ 缺少 SUPABASE_DB_URL'); process.exit(1) }

  const dims = JSON.parse(readFileSync(join(DATA, 'dimensions-seed.json'), 'utf-8'))
  const obs = JSON.parse(readFileSync(join(DATA, 'observation-points-seed.json'), 'utf-8'))

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await upsert(client, 'dimensions', 'id', dims)          // 维度必须先于观察点（观察点 FK 引用维度）
    await upsert(client, 'observation_points', 'code', obs)
    const { rows: d } = await client.query('SELECT count(*)::int n FROM dimensions')
    const { rows: o } = await client.query('SELECT count(*)::int n FROM observation_points')
    console.log(`\n库内现有：dimensions ${d[0].n} / observation_points ${o[0].n}`)
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error('✗ seed-reference 异常：', e instanceof Error ? e.message : e); process.exit(1) })
