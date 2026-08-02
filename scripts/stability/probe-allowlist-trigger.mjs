#!/usr/bin/env node
/**
 * @module stability/probe-allowlist-trigger
 * @desc   【真实注册探测·零 AI 成本】验证 enforce_beta_allowlist_trg 是否真的挂在生产 auth.users 上。
 *         产品方已明确授权本次探测（台账 113 遗留：表和 3 行白名单在，触发器本体验不到）。
 *
 *         两条路径分别测（触发器是 before insert or update OF email, email_change）：
 *           路径 A：GoTrue signUp({email,password})            → 走 INSERT
 *           路径 B：signInAnonymously() → updateUser({email})   → 走 UPDATE OF email（真实用户走的路）
 *
 *         判定三态（绝不把「没测到」写成「通过」）：
 *           ✅ PASS         被拒且错误可归因于白名单闸
 *           🔴 FAIL         真的建出了带邮箱的用户 → 闸是纸门 → 立即 admin 删除并复核
 *           ⚠️ INCONCLUSIVE 被拒但原因不可归因（限流/邮箱格式/注册关闭等）→ 记为未验证
 *
 *         本脚本【不触发任何 AI 调用】，只打 Supabase GoTrue / PostgREST。
 *         自己造的一切用户在 finally 中删除并复核。
 *
 * 用法：node --env-file=.env.local scripts/stability/probe-allowlist-trigger.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { signInAnonymouslyTagged } from '../lib/qa-anon-auth.mjs'

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!URL || !ANON || !SRK) { console.error('❌ 缺少环境变量'); process.exit(1) }

const AI_CALLS = 0 // 本脚本恒为 0：不存在任何模型调用路径
const log = (s) => console.log(`[${new Date().toISOString()}] ${s}`)
const admin = createClient(URL, SRK, { auth: { persistSession: false } })

const T0 = new Date().toISOString()
log(`目标库：${URL}`)
log(`测试时间窗口起：${T0}`)
log(`本脚本 AI 调用数：${AI_CALLS}（无模型调用路径）`)

// 造出来的用户 id 全部登记在此，finally 统一清理
const CREATED = new Set()
const DENIED_KW = 'BETA_ALLOWLIST_DENIED'
const results = []

// ── 前置：确认候选邮箱确实不在名单内 ──────────────────────────────
const stamp = Date.now()
const EMAIL_A = `qa-probe-signup-${stamp}@lingobridge-qa-probe.com`
const EMAIL_B = `qa-probe-update-${stamp}@lingobridge-qa-probe.com`
const PW = `Qa!${stamp}aB9`

const { data: allow, error: allowErr } = await admin.from('beta_allowlist').select('email')
if (allowErr) { console.error(`❌ 读 beta_allowlist 失败：${allowErr.message}`); process.exit(2) }
const lower = allow.map((r) => String(r.email).trim().toLowerCase())
const gateEnabled = allow.length > 0 && !lower.includes('*')
log(`beta_allowlist 行数=${allow.length}，哨兵'*'=${lower.includes('*') ? '存在' : '不存在'} → 闸应处于 ${gateEnabled ? '启用' : '停用'} 状态`)
for (const e of [EMAIL_A, EMAIL_B]) {
  if (lower.includes(e.toLowerCase())) { console.error(`❌ 候选邮箱竟在名单内：${e}`); process.exit(2) }
}
log(`候选邮箱均不在名单内 ✅  A=${EMAIL_A}  B=${EMAIL_B}`)
if (!gateEnabled) {
  log('🔴 闸处于停用状态，本次探测无法区分「闸失效」与「闸被主动停用」→ 中止，避免得出误导结论')
  process.exit(2)
}

// 判定：错误是否可归因于白名单闸
function classifyErr(err) {
  const msg = `${err?.message ?? ''} ${err?.code ?? ''}`.trim()
  if (msg.includes(DENIED_KW)) return { verdict: 'PASS', why: `错误含关键词 ${DENIED_KW}（直接归因白名单闸）` }
  // GoTrue 常把触发器 raise exception 包装成不透明的 5xx，需标注为「疑似但不可直接归因」
  if (/database error|unexpected_failure|500/i.test(msg)) {
    return { verdict: 'LIKELY', why: '被 DB 层拒绝但 GoTrue 隐藏了原文（疑似触发器，需 A/B 对照才能坐实）' }
  }
  return { verdict: 'INCONCLUSIVE', why: '拒绝原因与白名单无关（限流/格式/注册关闭等）' }
}

async function findUserByEmail(email) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) { log(`⚠️ listUsers 失败：${error.message}`); return null }
  return data.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase()) ?? null
}

try {
  // ══ 路径 A：signUp（INSERT 路径）════════════════════════════════
  log('\n════ 路径 A：GoTrue signUp（触发 before INSERT）════')
  const cA = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: dA, error: eA } = await cA.auth.signUp({ email: EMAIL_A, password: PW })
  if (eA) {
    const k = classifyErr(eA)
    log(`signUp 被拒：status=${eA.status} code=${eA.code ?? '-'} message="${eA.message}"`)
    log(`判定 ${k.verdict} —— ${k.why}`)
    results.push(['A signUp', k.verdict, `被拒: ${eA.message}`])
  } else {
    const uid = dA?.user?.id
    if (uid) CREATED.add(uid)
    log(`🔴 signUp 未被拒！user.id=${uid} email=${dA?.user?.email ?? '(空)'}`)
    results.push(['A signUp', 'FAIL', `建出用户 ${uid}，闸未拦截`])
  }
  // 无论如何复核：库里是否真落了这个邮箱
  const leakA = await findUserByEmail(EMAIL_A)
  log(`复核 auth.users 是否存在 ${EMAIL_A}：${leakA ? `🔴 存在 uid=${leakA.id}` : '✅ 不存在'}`)
  if (leakA) CREATED.add(leakA.id)

  // ══ 路径 B：匿名 updateUser 绑邮箱（UPDATE OF email 路径·真实产品路径）══
  log('\n════ 路径 B：signInAnonymously → updateUser({email,password})（触发 before UPDATE OF email）════')
  const cB = createClient(URL, ANON, { auth: { persistSession: false } })
  // 带 lb_qa_script 标记建号（finally 会自删；崩溃残留时靠标记被 cleanup-qa-anon.mjs 清掉）
  const { data: anonD, error: anonE } = await signInAnonymouslyTagged(cB, 'probe-allowlist-trigger')
  if (anonE) {
    log(`⚠️ 匿名登录失败：${anonE.message} → 路径 B 无法验证`)
    results.push(['B updateUser', 'INCONCLUSIVE', `匿名登录失败：${anonE.message}`])
  } else {
    const anonUid = anonD.user.id
    CREATED.add(anonUid) // 匿名账号是我造的，必须清理
    log(`匿名账号已建：uid=${anonUid} is_anonymous=${anonD.user.is_anonymous}`)
    const { data: dB, error: eB } = await cB.auth.updateUser({ email: EMAIL_B, password: PW })
    if (eB) {
      const k = classifyErr(eB)
      log(`updateUser 被拒：status=${eB.status} code=${eB.code ?? '-'} message="${eB.message}"`)
      log(`判定 ${k.verdict} —— ${k.why}`)
      results.push(['B updateUser', k.verdict, `被拒: ${eB.message}`])
    } else {
      log(`🔴 updateUser 未被拒！返回 email=${dB?.user?.email ?? '(空)'} email_change=${dB?.user?.new_email ?? '(空)'}`)
      results.push(['B updateUser', 'FAIL', '闸未拦截，邮箱已写入/进入待确认'])
    }
    // 用 admin 直读该 uid，看 email / email_change 到底落了没（绕过客户端返回体的迷惑）
    const { data: gu } = await admin.auth.admin.getUserById(anonUid)
    const u = gu?.user
    log(`复核 uid=${anonUid} 落库实况：email=${u?.email || '(空)'} new_email=${u?.new_email || '(空)'} is_anonymous=${u?.is_anonymous}`)
    if (u?.email || u?.new_email) {
      log('🔴 邮箱确实写进了 auth.users（email 或 email_change）→ 闸未生效')
      results.push(['B 落库复核', 'FAIL', `email=${u?.email || '-'} new_email=${u?.new_email || '-'}`])
    } else {
      log('✅ auth.users 上 email 与 email_change 均为空 → 未写入')
      results.push(['B 落库复核', 'PASS', 'email/email_change 均空'])
    }
  }
} finally {
  // ══ 清理：删除本次造出的所有用户，并复核确实没了 ══════════════════
  log('\n════ 清理 ════')
  if (CREATED.size === 0) log('本次未造出任何用户，无需清理')
  for (const uid of CREATED) {
    const { error } = await admin.auth.admin.deleteUser(uid)
    log(error ? `⚠️ 删除 uid=${uid} 失败：${error.message}（需手工删）` : `🧹 已删除 uid=${uid}`)
    const { data: chk } = await admin.auth.admin.getUserById(uid)
    log(`   复核 uid=${uid}：${chk?.user ? '🔴 仍存在！' : '✅ 已不存在'}`)
  }
  for (const e of [EMAIL_A, EMAIL_B]) {
    const left = await findUserByEmail(e)
    log(`复核残留 ${e}：${left ? `🔴 仍存在 uid=${left.id}` : '✅ 无残留'}`)
  }
  log(`测试时间窗口止：${new Date().toISOString()}（起 ${T0}）`)
  log(`本次 AI 调用数：${AI_CALLS} —— 零成本`)
  console.log('\n════ 汇总 ════')
  for (const [name, verdict, note] of results) console.log(`${verdict.padEnd(13)} ${name.padEnd(16)} ${note}`)
}
