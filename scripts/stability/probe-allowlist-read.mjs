#!/usr/bin/env node
/**
 * @module stability/probe-allowlist-read
 * @desc   【纯只读·零成本】读取 beta_allowlist 现状，为触发器探测选一个「确定不在名单内」的邮箱。
 *         不做任何写操作，不触碰 AI。
 * 用法：node --env-file=.env.local scripts/stability/probe-allowlist-read.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!URL || !SRK) { console.error('❌ 缺少 URL / SERVICE_ROLE_KEY'); process.exit(1) }

const db = createClient(URL, SRK, { auth: { persistSession: false } })
console.log(`目标库：${URL}`)

const { data, error } = await db.from('beta_allowlist').select('email,note,created_at')
if (error) { console.error(`🔴 读 beta_allowlist 失败：${error.code} ${error.message}`); process.exit(2) }

console.log(`\nbeta_allowlist 共 ${data.length} 行：`)
for (const r of data) {
  // 邮箱做脱敏打印（隐私：名单是内测者真实邮箱）
  const [u, d] = String(r.email).split('@')
  const masked = r.email === '*' ? '*（哨兵行·停用开关）' : `${u.slice(0, 2)}***@${d ?? '?'}`
  console.log(`  - ${masked}  note=${r.note ?? ''}  created=${r.created_at}`)
}

const hasSentinel = data.some((r) => r.email === '*')
console.log(`\n哨兵行 '*'（存在 = 白名单已停用、全部放行）：${hasSentinel ? '🟡 存在' : '不存在'}`)
console.log(`表为空（空 = 防呆兜底放行）：${data.length === 0 ? '🟡 是' : '否'}`)

// 生成候选探测邮箱，并证明它不在名单里
const CANDIDATE = `qa-allowlist-probe-${Date.now()}@lingobridge-qa-probe.com`
const inList = data.some((r) => String(r.email).toLowerCase() === CANDIDATE.toLowerCase())
console.log(`\n候选探测邮箱：${CANDIDATE}`)
console.log(`该邮箱在名单内？${inList ? '🔴 在（换一个）' : '✅ 不在（可用于探测）'}`)
console.log(`\n前置条件：白名单应处于「启用」状态才能测出闸效果 → ${!hasSentinel && data.length > 0 ? '✅ 满足' : '🔴 不满足，测出的「放行」无法区分是闸失效还是闸被停用'}`)
