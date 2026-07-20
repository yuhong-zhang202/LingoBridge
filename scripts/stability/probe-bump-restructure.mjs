#!/usr/bin/env node
/**
 * @module   stability/probe-bump-restructure
 * @desc     【零成本探针】验证 bump_daily_usage RPC 对 kind='restructure' 在真库可用。
 *           fix-engineer 给 /api/restructure 补的注册侧熔断走 bumpDailyUsageServer(userId,'restructure')，
 *           其单测把该函数 mock 了 —— 真库上这个 kind 能不能用是本次改动唯一的真实未知。
 *           本脚本【不触发任何 AI 调用】：只打 Supabase PostgREST 的 rpc 与表读写。
 *           验完把造出来的计数恢复原状（预先读旧值，跑完写回/删行），不污染测试账号当日额度。
 *
 * 用法：node --env-file=.env.local scripts/stability/probe-bump-restructure.mjs
 * 只读环境变量名，脚本内绝不打印密钥值。
 */
import { createClient } from '@supabase/supabase-js'

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const EMAIL = process.env.QA_TEST_EMAIL ?? ''
const PASSWORD = process.env.QA_TEST_PASSWORD ?? ''
if (!URL || !SRK || !EMAIL || !PASSWORD) {
  console.error('❌ 缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / QA_TEST_EMAIL / QA_TEST_PASSWORD')
  process.exit(1)
}
const KIND = 'restructure'
const log = (s) => console.log(`[${new Date().toISOString()}] ${s}`)
const db = createClient(URL, SRK, { auth: { persistSession: false } })

log(`目标库：${URL}`)
log(`开始时间窗口：${new Date().toISOString()}`)

// ── 1) 取测试账号 uid（走 admin API 按邮箱找，避免依赖登录态）──────────
const { data: list, error: lErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (lErr) { console.error('❌ listUsers 失败：', lErr.message); process.exit(1) }
const user = list.users.find((u) => (u.email ?? '').toLowerCase() === EMAIL.toLowerCase())
if (!user) { console.error(`❌ 未找到测试账号 ${EMAIL}`); process.exit(1) }
const UID = user.id
log(`测试账号 uid=${UID}`)

// ── 2) 记录改动前的原始状态（用于事后精确还原）──────────────────────
const readRow = async () => {
  const { data, error } = await db.from('daily_usage_counts')
    .select('user_id,day,kind,count')
    .eq('user_id', UID).eq('kind', KIND)
    .gte('day', new Date().toISOString().slice(0, 10))
    .maybeSingle()
  if (error) throw new Error(`读 daily_usage_counts 失败：${error.message}`)
  return data
}
const before = await readRow()
log(`改动前 kind='${KIND}' 当日行：${before ? `count=${before.count}（已存在，事后写回该值）` : '不存在（事后整行删除）'}`)

// ── 3) 连调两次 RPC，验递增 ────────────────────────────────────────
const results = []
for (const i of [1, 2]) {
  const { data, error } = await db.rpc('bump_daily_usage', { p_user_id: UID, p_kind: KIND })
  if (error) {
    console.error(`🔴 第 ${i} 次 RPC 报错 —— kind='${KIND}' 在真库不可用！`)
    console.error(`   code=${error.code} message=${error.message} details=${error.details ?? ''} hint=${error.hint ?? ''}`)
    console.error('   结论：fix-engineer 的 /api/restructure 熔断改动上线会 500，禁止部署。')
    process.exit(3)
  }
  log(`第 ${i} 次 rpc('bump_daily_usage', {p_kind:'${KIND}'}) → 返回 ${JSON.stringify(data)}（类型 ${typeof data}）`)
  results.push(data)
}

// ── 4) 断言 ───────────────────────────────────────────────────────
const checks = []
const c = (name, pass, note) => { checks.push([pass ? '✅' : '❌', name, note]); log(`${pass ? '✅' : '❌'} ${name} —— ${note}`) }
c('两次调用均无错误', true, `返回 ${results[0]} / ${results[1]}`)
c('返回值是整数', Number.isInteger(results[0]) && Number.isInteger(results[1]), `${typeof results[0]} / ${typeof results[1]}`)
c('第二次 = 第一次 + 1（原子递增）', results[1] === results[0] + 1, `${results[0]} → ${results[1]}`)
const after = await readRow()
c(`daily_usage_counts 落了 kind='${KIND}' 的行`, !!after && after.kind === KIND, after ? `count=${after.count} day=${after.day}` : '未找到行')
c('落库 count 与 RPC 返回值一致', !!after && after.count === results[1], after ? `行 count=${after.count} vs RPC ${results[1]}` : 'n/a')

// ── 5) 清理：精确还原到改动前状态 ──────────────────────────────────
if (before) {
  const { error } = await db.from('daily_usage_counts').update({ count: before.count })
    .eq('user_id', UID).eq('kind', KIND).eq('day', after.day)
  log(error ? `⚠️ 还原失败：${error.message}（请手工把 count 改回 ${before.count}）` : `🧹 已把 count 写回改动前的 ${before.count}`)
} else {
  const { error } = await db.from('daily_usage_counts').delete()
    .eq('user_id', UID).eq('kind', KIND).eq('day', after.day)
  log(error ? `⚠️ 删除失败：${error.message}（请手工删该行）` : '🧹 已删除本次造出的整行（恢复到「不存在」）')
}
const final = await readRow()
log(`清理后复查：${final ? `仍存在 count=${final.count}` : '该行已不存在 ✅'}`)

const failed = checks.filter((x) => x[0] === '❌').length
log(`结束时间窗口：${new Date().toISOString()}`)
log(`本次探针 AI 调用次数：0（只打 Supabase，未触碰任何模型接口）`)
log(failed === 0 ? '════ 全部通过 ════' : `════ ${failed} 项未通过 ════`)
process.exit(failed === 0 ? 0 : 1)
