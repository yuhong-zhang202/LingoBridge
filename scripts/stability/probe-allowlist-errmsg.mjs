#!/usr/bin/env node
/**
 * @module stability/probe-allowlist-errmsg
 * @desc   【零 AI 成本】验证 src/lib/auth.ts 的 isAllowlistDenied() 在真实 GoTrue 错误上到底命不命中。
 *
 *         该函数把错误对象序列化后找关键词 'beta_allowlist_denied'，命中才回友好文案
 *         「该邮箱不在内测名单内，如需参加请联系我们」，否则用户看到原始 5xx 文案。
 *         本脚本【原样复刻】它的匹配逻辑，喂真实错误对象，看是 true 还是 false。
 *
 *         为什么必须实测：我此前只抓了 error.message，没看嵌套字段——
 *         不把整个对象打出来就断言「文案不会生效」，属于证据不足。
 *
 * 用法：node --env-file=.env.local scripts/stability/probe-allowlist-errmsg.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const admin = createClient(URL, SRK, { auth: { persistSession: false } })
const log = (s) => console.log(`[${new Date().toISOString()}] ${s}`)

// ── 原样复刻 src/lib/auth.ts:59 的 isAllowlistDenied ──────────────
const ALLOWLIST_DENIED_KEY = 'beta_allowlist_denied'
function isAllowlistDenied(error) {
  if (error === null || error === undefined) return false
  const msg = error?.message
  const parts = [typeof msg === 'string' ? msg : '']
  try { parts.push(JSON.stringify(error) ?? '') } catch { /* ignore */ }
  return parts.join(' ').toLowerCase().includes(ALLOWLIST_DENIED_KEY)
}

const stamp = Date.now()
const EMAIL = `qa-err-${stamp}@lingobridge-qa-probe.com`
const CREATED = new Set()
log(`AI 调用数：0   探测邮箱（不在名单内）：${EMAIL}`)

try {
  // ── 路径 A：signUp ────────────────────────────────────────
  const cA = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: dA, error: eA } = await cA.auth.signUp({ email: EMAIL, password: `Qa!${stamp}aB9` })
  if (dA?.user?.id) CREATED.add(dA.user.id)
  log('\n════ 路径 A signUp 的完整错误对象 ════')
  console.log('  message  :', eA?.message)
  console.log('  status   :', eA?.status, ' code:', eA?.code, ' name:', eA?.name)
  console.log('  JSON     :', JSON.stringify(eA))
  console.log('  自有属性 :', eA ? Object.getOwnPropertyNames(eA).join(', ') : '(无错误)')
  log(`  isAllowlistDenied() → ${isAllowlistDenied(eA)} ${isAllowlistDenied(eA) ? '✅ 会显示友好文案' : '🔴 不命中 → 用户看到的是原始报错，不是「不在内测名单」'}`)

  // ── 路径 B：匿名 updateUser ────────────────────────────────
  const cB = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: anonD } = await cB.auth.signInAnonymously()
  if (anonD?.user?.id) CREATED.add(anonD.user.id)
  const { error: eB } = await cB.auth.updateUser({ email: `qa-err2-${stamp}@lingobridge-qa-probe.com`, password: `Qa!${stamp}aB9` })
  log('\n════ 路径 B updateUser 的完整错误对象 ════')
  console.log('  message  :', eB?.message)
  console.log('  status   :', eB?.status, ' code:', eB?.code, ' name:', eB?.name)
  console.log('  JSON     :', JSON.stringify(eB))
  log(`  isAllowlistDenied() → ${isAllowlistDenied(eB)} ${isAllowlistDenied(eB) ? '✅ 会显示友好文案' : '🔴 不命中 → 用户看到的是原始报错'}`)
} finally {
  log('\n════ 清理 ════')
  for (const uid of CREATED) {
    const { error } = await admin.auth.admin.deleteUser(uid)
    log(error ? `⚠️ 删除失败 ${uid}：${error.message}` : `🧹 已删除 uid=${uid}`)
  }
}
