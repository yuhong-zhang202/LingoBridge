#!/usr/bin/env node
/**
 * @module stability/probe-anon-quota-free
 * @desc   【零 AI 成本】验证匿名 restructure 链路已随迁移补齐复活，且第 6 次正确 402 QUOTA_EXCEEDED。
 *
 *         为什么能零成本做到：读 src/app/api/restructure/route.ts 的顺序是
 *           requireUserAllowAnon → hasRecordedConsent → bumpAnonRestructureTodayServer → 超限即 402 return
 *         【402 分支在调用千问之前就 return 了】。所以只要把当日计数预置到上限，
 *         这一次请求就能走完「鉴权→同意→计数→熔断」全链路而一次模型都不调。
 *
 *         这同时也验证了本轮最关心的事：anon_restructure_counts 表 / bump_anon_restructure RPC
 *         补齐后，该接口不再 500。
 *         ⚠️ 未覆盖：limit 以内那次「正常返回 200 + 真整理结果」——那必然要花钱，
 *            受 _lib.mjs 的 TTY 确认闸约束，本脚本不做，如实标为未验证。
 *
 *         零成本【实测而非声称】：前后各读一次 api_usage_logs 行数，必须零增长。
 *         自造数据：1 个匿名账号（+ 其 profiles/consent/计数行），finally 中删号并复核。
 *
 * 用法：node --env-file=.env.local scripts/stability/probe-anon-quota-free.mjs --base-url https://lingobridge.zeabur.app
 */
import { createClient } from '@supabase/supabase-js'

const BASE = (process.argv.find((a) => a.startsWith('--base-url='))?.split('=')[1]
  ?? process.argv[process.argv.indexOf('--base-url') + 1] ?? '').replace(/\/$/, '')
if (!BASE.startsWith('http')) { console.error('❌ 需要 --base-url'); process.exit(1) }

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const log = (s) => console.log(`[${new Date().toISOString()}] ${s}`)
const admin = createClient(URL, SRK, { auth: { persistSession: false } })

const T0 = new Date().toISOString()
log(`目标：${BASE}`)
log(`测试时间窗口起：${T0}`)
log('本脚本设计为 0 次 AI 调用，收尾会用 api_usage_logs 行数增量实测证明。')

const ANON_LIMIT = 5 // 与 src/lib/constants.ts 的 ANON_RESTRUCTURE_LIMIT 对齐
const checks = []
const c = (n, pass, note) => { checks.push([pass, n, note]); log(`${pass ? '✅' : '❌'} ${n} —— ${note}`) }

const usageCount = async () => {
  const { count, error } = await admin.from('api_usage_logs').select('*', { head: true, count: 'exact' })
  if (error) throw new Error(error.message)
  return count
}
const before = await usageCount()
log(`api_usage_logs 起始行数：${before}`)

let uid = null
try {
  // ── 1) 匿名登录 ────────────────────────────────────────────
  const cli = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: ad, error: ae } = await cli.auth.signInAnonymously()
  if (ae) { console.error(`❌ 匿名登录失败：${ae.message}`); process.exit(2) }
  uid = ad.user.id
  const token = ad.session.access_token
  log(`匿名账号 uid=${uid}`)

  // ── 2) 签同意（服务端同意闸在计数之前）──────────────────────
  const cs = await fetch(`${BASE}/api/consent`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
  })
  c('匿名可签同意 /api/consent 200', cs.status === 200, `status=${cs.status}`)

  // ── 3) 预置当日计数到上限（等价于已用掉 5 次，省掉 5 次真实 AI 调用）──
  const today = new Date().toISOString().slice(0, 10)
  const { error: upErr } = await admin.from('anon_restructure_counts')
    .upsert({ user_id: uid, day: today, count: ANON_LIMIT }, { onConflict: 'user_id,day' })
  c(`预置 anon_restructure_counts=${ANON_LIMIT}（迁移 0013 的表可写）`, !upErr, upErr?.message ?? `day=${today}`)

  // ── 4) 这一次请求 = 第 6 次，应在调 AI 前就 402 ───────────────
  const r = await fetch(`${BASE}/api/restructure`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ rawText: '匿名配额测试，这是一段很短的中文文本。' }),
  })
  const body = await r.json().catch(() => ({}))
  log(`/api/restructure 第 ${ANON_LIMIT + 1} 次 → status=${r.status} code=${body?.code ?? '-'} error=${body?.error ?? '-'}`)

  c('接口不再 500（迁移 0013 补齐后匿名链路已复活）', r.status !== 500, `status=${r.status}`)
  c('第 6 次返回 402', r.status === 402, `实际 status=${r.status}`)
  c("code === 'QUOTA_EXCEEDED'", body?.code === 'QUOTA_EXCEEDED', `实际 code=${body?.code ?? '(无)'}`)

  // ── 5) 计数确实原子递增到 6（证明 bump_anon_restructure 真的跑了）──
  const { data: row } = await admin.from('anon_restructure_counts')
    .select('count').eq('user_id', uid).eq('day', today).maybeSingle()
  c('计数递增到 6（bump_anon_restructure 在真实请求中执行）', row?.count === ANON_LIMIT + 1, `count=${row?.count ?? '(无行)'}`)
} finally {
  // ── 6) 零成本实测 ────────────────────────────────────────
  const after = await usageCount()
  const delta = after - before
  c('本次零 AI 调用（api_usage_logs 行数零增长）', delta === 0, `Δ=${delta}（起 ${before} → 止 ${after}）`)

  // ── 7) 清理 ──────────────────────────────────────────────
  log('\n════ 清理 ════')
  if (uid) {
    const { error } = await admin.auth.admin.deleteUser(uid)
    log(error ? `⚠️ 删除匿名账号失败：${error.message}（需手工删 uid=${uid}）` : `🧹 已删除匿名账号 uid=${uid}`)
    const { data: chk } = await admin.auth.admin.getUserById(uid)
    log(`   复核用户：${chk?.user ? '🔴 仍存在' : '✅ 已不存在'}`)
    const { count: cc } = await admin.from('anon_restructure_counts').select('*', { head: true, count: 'exact' }).eq('user_id', uid)
    log(`   复核 anon_restructure_counts 残留：${cc} 行（外键 on delete cascade，应为 0）`)
    const { count: pc } = await admin.from('profiles').select('*', { head: true, count: 'exact' }).eq('id', uid)
    log(`   复核 profiles 残留：${pc} 行（应为 0）`)
    const { count: sc } = await admin.from('consent_records').select('*', { head: true, count: 'exact' }).eq('user_id', uid)
    log(`   复核 consent_records 残留：${sc} 行（若 >0 需按时间窗口手工清）`)
  }
  log(`测试时间窗口止：${new Date().toISOString()}（起 ${T0}）`)
  console.log('\n════ 汇总 ════')
  for (const [p, n, note] of checks) console.log(`${p ? '✅' : '❌'} ${n.padEnd(46)} ${note}`)
  const failed = checks.filter((x) => !x[0]).length
  console.log(failed ? `\n${failed} 项未通过` : '\n全部通过')
}
