#!/usr/bin/env node
/**
 * @module stability/verify-rpc-exists
 * @desc   【零写入·零 AI 成本】证明 bump_anon_restructure / bump_daily_usage 真实存在且可执行。
 *
 *         ⚠️ 为什么要专门写这个：verify-schema.mjs 里用「传错参名看报错」判存在是**假阳性**——
 *         PostgREST 的 PGRST202 消息无论函数存不存在都会回显函数名
 *         （已用 definitely_not_a_real_function_xyz 做对照证伪）。那两个 ✅ 已作废。
 *
 *         本脚本改用真实签名 + 一个【不存在于 profiles 的随机 uuid】：
 *           两函数的 user_id 都有 references public.profiles(id) 外键，
 *           → 函数若存在，会执行到 insert 并抛外键冲突 23503（语句回滚，零行落库）
 *           → 函数若不存在，得到 PGRST202
 *         两种结果泾渭分明，且都不产生持久写入。事后再复核目标表零残留。
 *
 * 用法：node --env-file=.env.local scripts/stability/verify-rpc-exists.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const GHOST = randomUUID()
console.log(`AI 调用数：0\n使用幽灵 uuid（确保不在 profiles 内）：${GHOST}\n`)

// 先确认这个 uuid 确实不在 profiles
const { count: pc } = await db.from('profiles').select('*', { head: true, count: 'exact' }).eq('id', GHOST)
console.log(`该 uuid 在 profiles 中的行数：${pc}（应为 0）\n`)

const CASES = [
  ['bump_anon_restructure', { p_user_id: GHOST }, 'anon_restructure_counts'],
  ['bump_daily_usage', { p_user_id: GHOST, p_kind: 'restructure' }, 'daily_usage_counts'],
]

for (const [fn, args, table] of CASES) {
  const { data, error } = await db.rpc(fn, args)
  if (!error) {
    console.log(`🟡 ${fn}：竟然成功返回 ${JSON.stringify(data)} —— 说明外键约束不在，需清理该行`)
    await db.from(table).delete().eq('user_id', GHOST)
    console.log(`   已清理 ${table} 中 user_id=${GHOST} 的行`)
    continue
  }
  if (error.code === '23503') {
    console.log(`✅ ${fn.padEnd(22)} 存在且已执行到 insert（外键冲突 23503 = 函数体真的跑了，语句回滚零落库）`)
  } else if (error.code === 'PGRST202') {
    console.log(`🔴 ${fn.padEnd(22)} 不存在：${error.message}`)
  } else {
    console.log(`🟡 ${fn.padEnd(22)} 其它错误 code=${error.code} message=${error.message}`)
  }
  const { count } = await db.from(table).select('*', { head: true, count: 'exact' }).eq('user_id', GHOST)
  console.log(`   复核 ${table} 中该 uuid 残留行数：${count}（应为 0）`)
}
