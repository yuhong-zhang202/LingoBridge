#!/usr/bin/env node
/**
 * @module   check-no-secrets
 * @desc     【发布闸门】构建后扫描 .next/static 下所有 .js 产物，确保 service_role key
 *           的明文未泄漏进前端包；命中即退出码 1。额外告警字面量 "service_role"。
 *
 * 用法：
 *   1) npm run build
 *   2) node --env-file=.env.local scripts/check-no-secrets.mjs
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const root = '.next/static'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!key) {
  console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY 未配置，跳过 service_role 泄漏检查')
  process.exit(0)
}

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir)
  } catch (e) {
    console.error(`❌ 找不到 ${dir}（先 npm run build？）`, e.message)
    process.exit(1)
  }
  for (const name of entries) {
    const p = join(dir, name)
    const s = await stat(p)
    if (s.isDirectory()) out.push(...await walk(p))
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

const files = await walk(root)
const hits = []
const warnings = []

for (const f of files) {
  const text = await readFile(f, 'utf8')
  if (text.includes(key)) hits.push(f)
  if (text.includes('service_role')) warnings.push(f)
}

if (warnings.length > 0) {
  console.warn(`⚠️  发现 ${warnings.length} 处字面量 "service_role"（仅告警，不致命）：`)
  for (const f of warnings) console.warn('   ' + f)
}

if (hits.length > 0) {
  console.error(`❌ service_role key 明文出现在 ${hits.length} 个前端 JS 文件中：`)
  for (const f of hits) console.error('   ' + f)
  process.exit(1)
}

console.log(`✅ 前端包未发现 service_role key（已扫 ${files.length} 个 .js 文件）`)
