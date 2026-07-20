#!/usr/bin/env node
/**
 * @module stability/probe-allowlist-whitespace
 * @desc   【零 AI 成本】证明 beta_allowlist 里带首尾空白的行会导致该内测者被误锁。
 *
 *         已观测事实：生产 beta_allowlist 第 2 行 email 首字符是空格（charCode 32，len 22 / trim 后 21）。
 *         触发器比对是 `lower(email) = lower(target_email)`，【只对传入值做了 btrim（还仅用于判空）、
 *         对存储值不做 btrim】→ 存 ' x@gmail.com'、用户填 'x@gmail.com' 时不匹配 → 该内测者注册被拒。
 *
 *         本脚本不碰任何真实内测者邮箱：用一个同形态的探测邮箱（存入时带前导空格）复现该比对行为。
 *         临时行在 finally 中删除并复核。
 *
 * 用法：node --env-file=.env.local scripts/stability/probe-allowlist-whitespace.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const log = (s) => console.log(`[${new Date().toISOString()}] ${s}`)
const admin = createClient(URL, SRK, { auth: { persistSession: false } })

const stamp = Date.now()
const CLEAN = `qa-ws-${stamp}@lingobridge-qa-probe.com`
const STORED = ` ${CLEAN}` // 带前导空格入库，模拟第 2 行的形态
const CREATED = new Set()
let inserted = false
log(`目标库：${URL}   AI 调用数：0`)

try {
  const { error: insErr } = await admin.from('beta_allowlist')
    .insert({ email: STORED, note: 'QA 空白复现行·脚本自动删除' })
  if (insErr) { console.error(`❌ 插入失败：${insErr.message}`); process.exit(2) }
  inserted = true
  log(`已插入带前导空格的白名单行：${JSON.stringify(STORED)}（len=${STORED.length}）`)

  log(`\n用户按正常写法填写（无空格）：${CLEAN}`)
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signUp({ email: CLEAN, password: `Qa!${stamp}aB9` })
  if (error) {
    log(`🔴 复现成功：被拒 status=${error.status} message="${error.message}"`)
    log('   → 结论：白名单里带首尾空白的行 = 该内测者【永远注册不进来】，且报错文案会显示「不在内测名单」，极难排查。')
    log('   → 生产第 2 行正是这个形态，那位内测者现在是锁死状态。')
  } else {
    if (data?.user?.id) CREATED.add(data.user.id)
    log(`✅ 竟然通过了 uid=${data?.user?.id} → 说明比对对空白不敏感，前述担忧不成立`)
  }
} finally {
  log('\n════ 清理 ════')
  for (const uid of CREATED) {
    const { error } = await admin.auth.admin.deleteUser(uid)
    log(error ? `⚠️ 删除失败 ${uid}：${error.message}` : `🧹 已删除用户 ${uid}`)
  }
  if (inserted) {
    const { error } = await admin.from('beta_allowlist').delete().eq('email', STORED)
    log(error ? `⚠️ 删除临时行失败：${error.message}（务必手工删）` : '🧹 已删除临时白名单行')
  }
  const { data: fin } = await admin.from('beta_allowlist').select('email')
  const leftover = (fin ?? []).filter((r) => String(r.email).includes('qa-ws-'))
  log(`清理后行数=${fin?.length ?? '?'}（应为 3），残留 QA 行：${leftover.length === 0 ? '✅ 无' : `🔴 ${leftover.length}`}`)
}
