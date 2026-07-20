#!/usr/bin/env node
/**
 * @module stability/snapshot-user-rows
 * @desc   【纯只读·零 AI 成本】给定 user_id，逐表 count 该用户的行，输出 JSON 快照。
 *         删号前后各跑一次，用 --compare 对照，即得逐表判定表。
 *
 *   ⚠️ 判定纪律：删号后为 0 只有在【删号前 > 0】时才算「验证通过」。
 *      删号前就是 0 的表，删号后仍为 0 属于【未验证】，绝不能记成通过 ——
 *      这正是本项目吃过两次亏的「检查手段覆盖面 < 被检查对象」。
 *
 * 用法：
 *   node --env-file=.env.local scripts/stability/snapshot-user-rows.mjs --user <uuid> --out before.json
 *   node --env-file=.env.local scripts/stability/snapshot-user-rows.mjs --user <uuid> --out after.json \
 *        --compare before.json
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, readFileSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]] : a), []),
)
const USER = args.user
if (!USER) { console.error('❌ 必须传 --user <uuid>'); process.exit(1) }

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const db = createClient(URL, SRK, { auth: { persistSession: false } })

// 分组：cascade = 靠 on delete cascade 兜底（security 最没把握的一批）
const CASCADE = ['saved_phrases', 'saved_words', 'saved_pronunciations', 'corpus_question_matches', 'daily_usage_counts', 'anon_restructure_counts']
const EXPLICIT = ['corpus_match_snapshots', 'flow_events', 'consent_records', 'corpus', 'phrase_cards', 'feedback', 'practice_sessions']
const RAW = ['llm_raw_logs', 'asr_raw_logs']

async function countBy(table, col, val) {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true }).eq(col, val)
  if (error) return { n: null, err: `${error.code ?? ''} ${error.message}` }
  return { n: count ?? 0 }
}

const snap = { user_id: USER, at: new Date().toISOString(), tables: {} }

for (const t of [...CASCADE, ...EXPLICIT, ...RAW]) snap.tables[t] = await countBy(t, 'user_id', USER)
snap.tables['profiles'] = await countBy('profiles', 'id', USER)

// corpus_point_links 无 user_id，按该用户的 corpus.id 反查
{
  const { data: cs } = await db.from('corpus').select('id').eq('user_id', USER)
  const ids = (cs ?? []).map((r) => r.id)
  if (ids.length === 0) {
    snap.tables['corpus_point_links'] = { n: 0, note: '该用户已无 corpus，无法反查（删号后此值必然为0，不具判别力）' }
  } else {
    const { count, error } = await db.from('corpus_point_links').select('*', { count: 'exact', head: true }).in('corpus_id', ids)
    snap.tables['corpus_point_links'] = error ? { n: null, err: error.message } : { n: count ?? 0 }
  }
}

// api_usage_logs：去标识化，非硬删 —— 关注 user_id 仍指向该用户的行数（应归 0）
snap.tables['api_usage_logs(user_id=该用户)'] = await countBy('api_usage_logs', 'user_id', USER)

// consent_audit：全表行数（该表刻意无 user_id，只能看总量增减）
{
  const { count } = await db.from('consent_audit').select('*', { count: 'exact', head: true })
  snap.consent_audit_total = count ?? 0
}

// beta_allowlist 全量
{
  const { data } = await db.from('beta_allowlist').select('email')
  snap.beta_allowlist = (data ?? []).map((r) => String(r.email).toLowerCase()).sort()
}

// Storage avatars/{userId}/
{
  const { data, error } = await db.storage.from('avatars').list(USER, { limit: 100 })
  snap.avatar_files = error ? `ERR ${error.message}` : (data ?? []).map((o) => o.name)
}

// auth.users 是否还在
{
  const { data, error } = await db.auth.admin.getUserById(USER)
  snap.auth_user_exists = !error && !!data?.user
  snap.auth_user_email = data?.user?.email ?? null
}

if (args.out) writeFileSync(args.out, JSON.stringify(snap, null, 2))

const label = (t) => (CASCADE.includes(t) ? '[cascade]' : EXPLICIT.includes(t) ? '[显式删]' : RAW.includes(t) ? '[原文]' : '')

if (args.compare) {
  const before = JSON.parse(readFileSync(args.compare, 'utf8'))
  console.log('\n表名'.padEnd(42) + '前'.padStart(6) + '后'.padStart(6) + '   判定')
  console.log('─'.repeat(78))
  let vacuous = 0, failed = 0
  for (const [t, v] of Object.entries(snap.tables)) {
    const b = before.tables[t]?.n, a = v.n
    let verdict
    if (b === null || a === null) verdict = '⚠️ 查询报错'
    else if (b === 0) { verdict = '⚪ 未验证（删号前就是0，无判别力）'; vacuous++ }
    else if (a === 0) verdict = '✅ 归零'
    else { verdict = `🔴 残留 ${a} 行`; failed++ }
    console.log(`${(label(t) + ' ' + t).padEnd(42)}${String(b ?? '?').padStart(6)}${String(a ?? '?').padStart(6)}   ${verdict}`)
  }
  console.log('─'.repeat(78))
  console.log(`consent_audit 总行数：${before.consent_audit_total} → ${snap.consent_audit_total}  ` +
    (snap.consent_audit_total > before.consent_audit_total ? `✅ 新增 ${snap.consent_audit_total - before.consent_audit_total} 行` : '🔴 未新增'))
  console.log(`auth.users 存在：${before.auth_user_exists} → ${snap.auth_user_exists}  ${snap.auth_user_exists === false ? '✅ 已删' : '🔴 仍在'}`)
  console.log(`头像文件数：${(before.avatar_files ?? []).length} → ${(snap.avatar_files ?? []).length}  ` +
    ((before.avatar_files ?? []).length === 0 ? '⚪ 未验证（删号前就没文件）' : (snap.avatar_files ?? []).length === 0 ? '✅ 已清空' : '🔴 有残留'))
  const gone = before.beta_allowlist.filter((e) => !snap.beta_allowlist.includes(e))
  const kept = snap.beta_allowlist
  console.log(`\nbeta_allowlist：被删 [${gone.join(', ')}]`)
  console.log(`                仍在 [${kept.join(', ')}]`)
  console.log(`\n汇总：残留失败 ${failed} 项，未验证（空表）${vacuous} 项`)
  if (vacuous > 0) console.log('⚠️ 「未验证」项不得记为通过 —— 需在报告中如实标注。')
} else {
  console.log(JSON.stringify(snap, null, 2))
}
