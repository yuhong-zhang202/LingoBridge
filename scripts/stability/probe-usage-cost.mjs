#!/usr/bin/env node
/**
 * @module   stability/probe-usage-cost
 * @desc     【只读·不花钱】按时间窗口读 api_usage_logs，汇总本轮测试的真实记账费用。
 *           纯 SELECT，不写不删。用于测试后成本对账。
 * 用法：node --env-file=.env.local scripts/stability/probe-usage-cost.mjs --since <ISO> --until <ISO>
 */
import { createClient } from '@supabase/supabase-js'
import { parseArgs, requireArg, table, fail } from './_lib.mjs'

const args = parseArgs()
const SINCE = requireArg(args, 'since', '--since 必填（ISO 时间）')
const UNTIL = requireArg(args, 'until', '--until 必填（ISO 时间）')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) fail('缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')

const sb = createClient(url, key, { auth: { persistSession: false } })
const { data, error } = await sb
  .from('api_usage_logs')
  .select('service, endpoint, usage_amount, usage_unit, estimated_cost_cny, latency_ms, status, created_at')
  .gte('created_at', SINCE)
  .lte('created_at', UNTIL)
  .order('created_at', { ascending: true })

if (error) fail(`查询失败：${error.message}`)
console.log(`窗口 ${SINCE} ~ ${UNTIL}｜命中 ${data.length} 行\n`)

const byKey = {}
for (const r of data) {
  const k = `${r.service}｜${r.status}`
  byKey[k] ??= { n: 0, cost: 0, amount: 0, lat: [] }
  byKey[k].n++
  byKey[k].cost += Number(r.estimated_cost_cny ?? 0)
  byKey[k].amount += Number(r.usage_amount ?? 0)
  byKey[k].lat.push(Number(r.latency_ms ?? 0))
}
const log = (s) => console.log(s)
table(log, ['service｜status', '条数', '用量合计', '记账费用¥', '平均延迟ms'],
  Object.entries(byKey).map(([k, v]) => [k, v.n, v.amount.toFixed(2), v.cost.toFixed(4),
    Math.round(v.lat.reduce((a, b) => a + b, 0) / v.lat.length)]))
console.log(`\n窗口内总记账费用：¥${data.reduce((s, r) => s + Number(r.estimated_cost_cny ?? 0), 0).toFixed(4)}`)
