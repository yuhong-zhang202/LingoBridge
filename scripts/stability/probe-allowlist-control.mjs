#!/usr/bin/env node
/**
 * @module stability/probe-allowlist-control
 * @desc   【A/B 对照·零 AI 成本】坐实 probe-allowlist-trigger 里那两个 LIKELY 到底是不是白名单闸干的。
 *
 *         背景：路径 A 报 "Database error saving new user"、路径 B 报 "Error confirm email"，
 *         GoTrue 把 DB 原文吞了。这两条报错的**另一种解释**同样成立且更可怕：
 *           - A 的报错是 handle_new_user 触发器坏掉的经典症状（那样所有人都注册不了）
 *           - B 的报错可能只是 SMTP 没配好（跟触发器无关）
 *         若不做对照就写「闸有效」，就是本项目吃过两次亏的「检查手段覆盖面 < 被检查对象」。
 *
 *         对照设计：唯一变量 = 该邮箱是否在 beta_allowlist 内。
 *           实验组（上一脚本）：不在名单 → 已观察到被拒
 *           对照组（本脚本）  ：把同形态邮箱【临时插入】名单 → 再跑同样两条路
 *             · 对照组通过 → 拒绝确由白名单闸造成 → ✅ 闸有效
 *             · 对照组仍失败 → 拒绝与白名单无关，是通用注册故障 → 🔴 另一个阻断问题，
 *                              且白名单闸【依旧未验证】
 *
 *         ⚠️ 本脚本会对 beta_allowlist 做一次【临时插入】（自造数据，finally 中删除并复核）。
 *            插入的是不存在的探测域名，不会给任何真实方授予权限。
 *         不触发任何 AI 调用。
 *
 * 用法：node --env-file=.env.local scripts/stability/probe-allowlist-control.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { signInAnonymouslyTagged } from '../lib/qa-anon-auth.mjs'

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!URL || !ANON || !SRK) { console.error('❌ 缺少环境变量'); process.exit(1) }

const log = (s) => console.log(`[${new Date().toISOString()}] ${s}`)
const admin = createClient(URL, SRK, { auth: { persistSession: false } })
const T0 = new Date().toISOString()
log(`目标库：${URL}`)
log(`测试时间窗口起：${T0}   AI 调用数：0`)

const stamp = Date.now()
const EMAIL_A = `qa-ctrl-signup-${stamp}@lingobridge-qa-probe.com`
const EMAIL_B = `qa-ctrl-update-${stamp}@lingobridge-qa-probe.com`
const PW = `Qa!${stamp}aB9`
const CREATED = new Set()
const INSERTED = []
const results = []

try {
  // ── 临时把两个对照邮箱插入白名单 ────────────────────────────────
  log('\n════ 准备：把对照邮箱临时插入 beta_allowlist ════')
  for (const e of [EMAIL_A, EMAIL_B]) {
    const { error } = await admin.from('beta_allowlist')
      .insert({ email: e, note: 'QA 临时对照行·脚本自动删除' })
    if (error) { console.error(`❌ 插入失败：${error.message}`); process.exit(2) }
    INSERTED.push(e)
    log(`已插入对照行：${e}`)
  }

  // ══ 对照 A：signUp（名单内）══════════════════════════════════
  log('\n════ 对照 A：signUp，邮箱【在】名单内 ════')
  const cA = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: dA, error: eA } = await cA.auth.signUp({ email: EMAIL_A, password: PW })
  if (eA) {
    log(`🔴 对照组仍被拒：status=${eA.status} code=${eA.code ?? '-'} message="${eA.message}"`)
    log('   → 拒绝与白名单无关（名单内也进不去）= 通用注册故障，白名单闸依旧未验证')
    results.push(['对照A signUp', 'FAIL', `名单内仍被拒: ${eA.message}`])
  } else {
    const uid = dA?.user?.id
    if (uid) CREATED.add(uid)
    log(`✅ 对照组通过：建出 uid=${uid} email=${dA?.user?.email ?? '(空)'}`)
    log('   → 同一路径「名单外拒 / 名单内过」= 白名单闸确实在起作用且能区分')
    results.push(['对照A signUp', 'PASS', `名单内成功建号 uid=${uid}`])
  }

  // ══ 对照 B：匿名 updateUser（名单内）════════════════════════════
  log('\n════ 对照 B：signInAnonymously → updateUser，邮箱【在】名单内 ════')
  const cB = createClient(URL, ANON, { auth: { persistSession: false } })
  // 带 lb_qa_script 标记建号（finally 会自删；崩溃残留时靠标记被 cleanup-qa-anon.mjs 清掉）
  const { data: anonD, error: anonE } = await signInAnonymouslyTagged(cB, 'probe-allowlist-control')
  if (anonE) {
    log(`⚠️ 匿名登录失败：${anonE.message}`)
    results.push(['对照B updateUser', 'INCONCLUSIVE', anonE.message])
  } else {
    const anonUid = anonD.user.id
    CREATED.add(anonUid)
    log(`匿名账号：uid=${anonUid}`)
    const { error: eB } = await cB.auth.updateUser({ email: EMAIL_B, password: PW })
    const { data: gu } = await admin.auth.admin.getUserById(anonUid)
    const u = gu?.user
    log(`落库实况：email=${u?.email || '(空)'} new_email=${u?.new_email || '(空)'}`)
    if (eB) {
      log(`🟡 对照组仍报错：status=${eB.status} code=${eB.code ?? '-'} message="${eB.message}"`)
      if (u?.email || u?.new_email) {
        log('   但邮箱已落库 → 报错发生在【写库之后】（如发确认信 SMTP 失败），与白名单闸无关')
        results.push(['对照B updateUser', 'PASS(带瑕疵)', `邮箱已落库但报错：${eB.message} → 疑 SMTP`])
      } else {
        log('   且邮箱未落库 → 名单内也写不进去 = 通用故障，路径 B 的白名单闸未验证')
        results.push(['对照B updateUser', 'FAIL', `名单内仍写不进：${eB.message}`])
      }
    } else {
      log('✅ 对照组通过，无报错')
      results.push(['对照B updateUser', 'PASS', `email=${u?.email || '-'} new_email=${u?.new_email || '-'}`])
    }
  }
} finally {
  // ══ 清理 ══════════════════════════════════════════════════
  log('\n════ 清理 ════')
  for (const uid of CREATED) {
    const { error } = await admin.auth.admin.deleteUser(uid)
    log(error ? `⚠️ 删除 uid=${uid} 失败：${error.message}` : `🧹 已删除用户 uid=${uid}`)
    const { data: chk } = await admin.auth.admin.getUserById(uid)
    log(`   复核：${chk?.user ? '🔴 仍存在！' : '✅ 已不存在'}`)
  }
  for (const e of INSERTED) {
    const { error } = await admin.from('beta_allowlist').delete().eq('email', e)
    log(error ? `⚠️ 删除白名单临时行失败：${e} ${error.message}（务必手工删）` : `🧹 已删除白名单临时行：${e}`)
  }
  const { data: fin } = await admin.from('beta_allowlist').select('email')
  log(`清理后 beta_allowlist 行数=${fin?.length ?? '?'}（应恢复为 3）`)
  const leftover = (fin ?? []).filter((r) => String(r.email).includes('qa-ctrl-'))
  log(`残留 QA 临时行：${leftover.length === 0 ? '✅ 无' : `🔴 ${leftover.length} 行，需手工删`}`)
  log(`测试时间窗口止：${new Date().toISOString()}（起 ${T0}）  AI 调用数：0`)
  console.log('\n════ 汇总 ════')
  for (const [n, v, note] of results) console.log(`${v.padEnd(14)} ${n.padEnd(18)} ${note}`)
}
