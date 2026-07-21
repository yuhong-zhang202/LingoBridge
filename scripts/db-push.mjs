/**
 * db-push —— 直连 Postgres 的迁移器，替代手动 SQL Editor。
 *
 * 连 SUPABASE_DB_URL（Supabase Dashboard → Settings → Database → Connection string，
 * 用 Session pooler / 直连，端口 5432），把 supabase/migrations/ 里尚未应用的 *.sql 按文件名顺序
 * 逐个在事务内执行，并记入 _schema_migrations 记账表。幂等：已应用的不再跑。
 *
 * 用法（底层直连 DB，非 REST，故 DDL 可正常执行）：
 *   npm run db:push                 应用所有未应用迁移
 *   npm run db:push -- --dry-run     只列出待应用、不执行
 *   npm run db:push -- --mark-all-applied
 *                                    仅记账不执行——用于「pg_dump/restore 已把 schema+data 搬过来」后，
 *                                    把现有 0001..NNNN 标记为已应用，之后 db:push 只跑新增迁移。
 *
 * 依赖：pg（devDependency）。连接需 SSL（Supabase 强制），已内置。
 */
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations')
const TABLE = '_schema_migrations'

function parseArgs() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const markAll = args.includes('--mark-all-applied')
  const unknown = args.filter((a) => a !== '--dry-run' && a !== '--mark-all-applied')
  if (unknown.length) {
    console.error(`未知参数：${unknown.join(', ')}（支持 --dry-run / --mark-all-applied）`)
    process.exit(1)
  }
  return { dryRun, markAll }
}

/** 全部迁移文件名（按文件名排序 = 按 0001..NNNN 顺序） */
function allMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

async function main() {
  const { dryRun, markAll } = parseArgs()

  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    console.error('✗ 缺少 SUPABASE_DB_URL（Dashboard → Settings → Database → Connection string）。')
    console.error('  请用 npm run db:push（底层带 --env-file=.env.local），并在 .env.local 里配好。')
    process.exit(1)
  }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    )
    const { rows } = await client.query(`SELECT name FROM ${TABLE}`)
    const applied = new Set(rows.map((r) => r.name))
    const files = allMigrationFiles()
    const pending = files.filter((f) => !applied.has(f))

    // 记账模式：把现有全部文件标为已应用（不执行）——pg_dump/restore 后用
    if (markAll) {
      if (pending.length === 0) {
        console.log('所有迁移已在记账表中，无需标记。')
        return
      }
      for (const f of pending) {
        await client.query(`INSERT INTO ${TABLE}(name) VALUES ($1) ON CONFLICT DO NOTHING`, [f])
      }
      console.log(`已把 ${pending.length} 个迁移标记为「已应用」（未执行）：\n  ${pending.join('\n  ')}`)
      console.log('\n之后 npm run db:push 只会执行新增迁移。')
      return
    }

    console.log(`# db-push 报告\n已应用 ${applied.size} / 待应用 ${pending.length}（共 ${files.length}）`)
    if (pending.length === 0) {
      console.log('✓ 无待应用迁移，数据库为最新。')
      return
    }
    console.log('待应用：\n  ' + pending.join('\n  '))

    if (dryRun) {
      console.log('\n本次为 --dry-run，未执行。去掉该参数即应用。')
      return
    }

    for (const f of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf-8')
      process.stdout.write(`\n▶ 执行 ${f} … `)
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query(`INSERT INTO ${TABLE}(name) VALUES ($1)`, [f])
        await client.query('COMMIT')
        console.log('✓')
      } catch (e) {
        await client.query('ROLLBACK')
        console.log('✗')
        console.error(`  ${f} 执行失败，已回滚该文件（前面已应用的保留）：`)
        console.error(`  ${e instanceof Error ? e.message : e}`)
        process.exit(1)
      }
    }
    console.log(`\n✓ 完成：本次应用 ${pending.length} 个迁移。`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error('\n✗ db-push 异常：', e instanceof Error ? e.message : e)
  process.exit(1)
})
