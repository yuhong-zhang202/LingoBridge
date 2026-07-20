#!/usr/bin/env node
/**
 * @module stability/verify-schema
 * @desc   【纯只读·零 AI 成本】复验产品方补跑的迁移（0006/0013/0009/0010/0011/0007）是否真的落地。
 *         用 service_role 走 PostgREST 逐表 head 探测（绕 RLS，行数为 0 也能区分「表不存在」）。
 *         RPC 用【故意传错参数名】探测签名，PostgREST 会在 hint 里回出真实签名 = 存在性证据，
 *         全程不产生任何写入。
 * 用法：node --env-file=.env.local scripts/stability/verify-schema.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const db = createClient(URL, SRK, { auth: { persistSession: false } })
console.log(`目标库：${URL}\nAI 调用数：0（纯只读）\n`)

const TABLES = [
  ['questions', '0003'], ['question_observation_links', '0003'], ['phrase_cards', '0004'],
  ['dimensions', '0001'], ['observation_points', '0001'], ['profiles', '0001'],
  ['corpus', '0001'], ['corpus_point_links', '0001'], ['feedback', '0005'],
  ['corpus_question_matches', '0007'], ['saved_phrases', '0009'], ['saved_words', '0010'],
  ['saved_pronunciations', '0011'], ['api_usage_logs', '0012'], ['anon_restructure_counts', '0013'],
  ['practice_sessions', '0016'], ['daily_usage_counts', '0015'], ['flow_events', '0018'],
  ['corpus_match_snapshots', '0019'], ['llm_raw_logs', '0020'], ['asr_raw_logs', '0020'],
  ['consent_records', '0022'], ['beta_allowlist', '0023'],
]

console.log('表名'.padEnd(30) + '迁移'.padEnd(8) + '状态'.padEnd(10) + '行数')
console.log('─'.repeat(66))
let missing = []
for (const [t, mig] of TABLES) {
  const { count, error } = await db.from(t).select('*', { count: 'exact', head: true })
  if (error) { missing.push([t, mig, error.code, error.message]); console.log(t.padEnd(30) + mig.padEnd(8) + '🔴 缺失'.padEnd(9) + `${error.code}`) }
  else console.log(t.padEnd(30) + mig.padEnd(8) + '✅ 存在'.padEnd(9) + count)
}
console.log(`\n表小计：${TABLES.length - missing.length}/${TABLES.length} 存在`)

// ── 关键列：practice_sessions.is_review（0006，本轮最急）──────────
console.log('\n════ 关键列 practice_sessions.is_review（迁移 0006）════')
{
  const { error } = await db.from('practice_sessions').select('is_review', { head: true, count: 'exact' })
  if (error) console.log(`🔴 缺失：code=${error.code} message=${error.message}`)
  else {
    console.log('✅ 列存在')
    const { count: tc } = await db.from('practice_sessions').select('*', { head: true, count: 'exact' })
    const { count: fc } = await db.from('practice_sessions').select('*', { head: true, count: 'exact' }).eq('is_review', false)
    const { count: rc } = await db.from('practice_sessions').select('*', { head: true, count: 'exact' }).eq('is_review', true)
    console.log(`   可过滤验证：总 ${tc} 行，is_review=false ${fc} 行，=true ${rc} 行`)
  }
}

// ── RPC 存在性（零写入：故意传错参名，读 PostgREST 的 hint）──────
console.log('\n════ RPC 存在性（不产生写入）════')
const RPCS = [
  ['get_dimension_scores', {}, true],
  ['get_dimension_progress', {}, true],
  ['bump_anon_restructure', { __qa_bogus: 1 }, false],
  ['bump_daily_usage', { __qa_bogus: 1 }, false],
]
for (const [fn, args, safeToCall] of RPCS) {
  const { data, error } = await db.rpc(fn, args)
  if (!error) { console.log(`✅ ${fn.padEnd(24)} 可调用，返回 ${Array.isArray(data) ? data.length + ' 行' : JSON.stringify(data)}`); continue }
  const m = `${error.message} ${error.hint ?? ''}`
  if (error.code === 'PGRST202') {
    // ⚠️ 此处【无法】判断存在性：PGRST202 的 message 无论函数存不存在都会回显函数名，
    //    已用 definitely_not_a_real_function_xyz 对照证伪（曾误报为 ✅）。
    //    真正的存在性证明见 verify-rpc-exists.mjs（用外键冲突 23503，零写入）。
    console.log(`⚪ ${fn.padEnd(24)} 本探测【无法判定】存在性（PGRST202 会回显任意函数名）→ 见 verify-rpc-exists.mjs`)
  } else {
    console.log(`🟡 ${fn.padEnd(24)} 调用报错 code=${error.code} message=${error.message.slice(0, 80)}`)
  }
}

if (missing.length) {
  console.log('\n🔴 仍缺失的对象：')
  for (const [t, mig, code, msg] of missing) console.log(`  - ${t}（迁移 ${mig}）code=${code} ${msg}`)
} else console.log('\n✅ 23 张表全部存在')
