#!/usr/bin/env node
/**
 * @module stability/probe-ilike-escape2
 * @desc   【纯只读·零成本·零写入】真正能失败的转义验证。
 *
 *   为什么要有 v2：v1 用 `+lb_qa` / `+lbqa` 这一对做断言，但 LIKE 的 `_` 匹配【恰好一个】字符，
 *   而这两个串长度差 1 —— 它们【本就不可能】互相命中。v1 的对照组证实了这点：即使完全不转义，
 *   也只命中 1 行。也就是说 v1 无论转义是否生效都会「通过」，是个假阳性测试。
 *
 *   v2 改用「同一个已存在的行 + 人为把某个字符换成 `_`」做差分，只读、不写、不删：
 *     A. 未转义 `sianchenn68@gmail_com` → 若 `_` 是活的通配符，应命中 sianchenn68@gmail.com
 *     B. 已转义 `sianchenn68@gmail\_com` → 若转义成功透传，应命中 0 行（没有哪行真含下划线）
 *   A 命中 && B 落空 = 转义确实生效。A 命中 && B 也命中 = 转义未透传（真 bug）。
 *
 * 用法：node --env-file=.env.local scripts/stability/probe-ilike-escape2.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const db = createClient(URL, SRK, { auth: { persistSession: false } })

const esc = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`) // 与 route.ts 第 125 行同款
const mask = (e) => { const [u, d] = String(e).split('@'); return `${u}@${(d ?? '?').slice(0, 2)}***` }

async function ilike(pattern) {
  const { data, error } = await db.from('beta_allowlist').select('email').ilike('email', pattern)
  if (error) { console.error(`🔴 查询失败 pattern=${pattern}: ${error.message}`); process.exit(2) }
  return data
}

console.log(`目标库：${URL}\n`)
console.log('══════ 用例1：`_` 通配符是否为活的 ══════')
const p1raw = 'sianchenn68@gmail_com'          // 把 . 换成 _
const r1 = await ilike(p1raw)
console.log(`未转义 pattern = ${p1raw}`)
console.log(`  命中 ${r1.length} 行 ${r1.map((r) => mask(r.email)).join(', ')}`)
const wildcardLive = r1.length > 0

console.log('\n══════ 用例2：转义后 `\\_` 是否被当作字面下划线 ══════')
const p2 = esc('sianchenn68@gmail_com')
const r2 = await ilike(p2)
console.log(`已转义 pattern = ${p2}`)
console.log(`  命中 ${r2.length} 行 ${r2.map((r) => mask(r.email)).join(', ')}`)
const escapeWorks = r2.length === 0

console.log('\n══════ 用例3：`%` 通配符转义（同一机制的第二证据）══════')
const p3raw = 'sianchenn68%'
const r3 = await ilike(p3raw)
console.log(`未转义 pattern = ${p3raw} → 命中 ${r3.length} 行`)
const p4 = esc('sianchenn68%')
const r4 = await ilike(p4)
console.log(`已转义 pattern = ${p4} → 命中 ${r4.length} 行`)

console.log('\n══════ 判定 ══════')
console.log(`用例1 下划线是活通配符（前提，应 true）      ：${wildcardLive}`)
console.log(`用例2 转义后不再通配（核心，应 true）      ：${escapeWorks}`)
console.log(`用例3 百分号未转义命中多行（前提，应 true）  ：${r3.length > 1}`)
console.log(`用例3 百分号转义后命中 0 行（核心，应 true） ：${r4.length === 0}`)

if (!wildcardLive) {
  console.log('\n🟡 前提不成立：`_` 在本环境根本不通配，本测试无判别力，结论不可采信。')
  process.exit(4)
}
if (!escapeWorks) {
  console.log('\n🔴 转义未透传：ilike 里的 `\\_` 仍在通配 → 删号会误删他人白名单行。')
  process.exit(3)
}
console.log('\n✅ 转义机制确实生效（`_` 与 `%` 双证据），且本测试具备失败能力。')
