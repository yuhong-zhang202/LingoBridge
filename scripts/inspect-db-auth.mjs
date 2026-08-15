/**
 * 只读侦察脚本 v2 — 先 signInAnonymously() 获得 authenticated 角色，
 * 再用已登录 session 读取各表真实行数。
 * 运行：node --env-file=.env.local scripts/inspect-db-auth.mjs
 * 只做 SELECT 查询，绝对不 insert / update / delete。
 *
 * ⚠️ 本脚本会在生产 auth.users 里真建一个匿名账号（用 service_role 会绕过 RLS、
 *    本脚本「用 authenticated 角色实测能读到什么」的目的就没了，故不能改）。
 *    建号走 scripts/lib/qa-anon-auth.mjs 打标记，事后用 scripts/cleanup-qa-anon.mjs 清理。
 */

import { createClient } from '@supabase/supabase-js'
import { signInAnonymouslyTagged } from './lib/qa-anon-auth.mjs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('❌ 缺少环境变量 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const sb = createClient(url, key)

// ── 工具 ──────────────────────────────────────────────────────────────────

async function countTable(table, filter = null) {
  let q = sb.from(table).select('*', { count: 'exact', head: true })
  if (filter) q = filter(q)
  const { count, error } = await q
  if (error) return { count: null, error: error.message }
  return { count, error: null }
}

async function sampleRows(table, columns, limit = 3, orderCol = null) {
  let q = sb.from(table).select(columns).limit(limit)
  if (orderCol) q = q.order(orderCol)
  const { data, error } = await q
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

function hr(label) {
  console.log('\n' + '─'.repeat(64))
  console.log(`  ${label}`)
  console.log('─'.repeat(64))
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 LingoBridge DB Inspect v2 — signInAnonymously\n')
  console.log(`URL: ${url}`)

  // ── Step 1: 匿名登录取得 authenticated session ──────────────────────────
  hr('Step 1 — signInAnonymously()')
  const { data: authData, error: authErr } = await signInAnonymouslyTagged(sb, 'inspect-db-auth')
  if (authErr) {
    console.error(`❌ 登录失败: ${authErr.message}`)
    process.exit(1)
  }
  const uid = authData?.user?.id ?? 'unknown'
  console.log(`✅ 已登录，uid: ${uid}`)
  console.log(`   role: ${authData?.user?.role ?? '?'}`)
  console.log(`   is_anonymous: ${authData?.user?.is_anonymous ?? '?'}`)

  // ── Step 2: dimensions ───────────────────────────────────────────────────
  hr('2. dimensions（期望 6 行，RLS = authenticated）')
  const dimCount = await countTable('dimensions')
  console.log(`行数: ${dimCount.error ? '❌ ' + dimCount.error : dimCount.count}`)
  if (!dimCount.error && dimCount.count > 0) {
    const { data, error } = await sampleRows('dimensions', 'id, name, sort_order', 10, 'sort_order')
    if (error) console.log(`  样本错误: ${error}`)
    else console.table(data)
  }

  // ── Step 3: observation_points ───────────────────────────────────────────
  hr('3. observation_points（期望 43+1=44 行，RLS = authenticated）')
  const opCount = await countTable('observation_points')
  console.log(`行数: ${opCount.error ? '❌ ' + opCount.error : opCount.count}`)

  if (!opCount.error && opCount.count > 0) {
    // mapped_question_count 已随迁移 0066 删列（从未被回写、值双向失真）；要「挂了几道题」查
    // question_observation_links 实算，别再 select 一个不存在的列（PostgREST 会整条查询报 42703）。
    const { data: opAll } = await sampleRows(
      'observation_points',
      'code, dimension_id, name, layer, rich_threshold',
      200,
      'sort_order',
    )
    if (opAll) {
      // 按维度分组
      const grouped = {}
      for (const op of opAll) {
        if (!grouped[op.dimension_id]) grouped[op.dimension_id] = []
        grouped[op.dimension_id].push(op.code)
      }
      console.log('\n各维度观察点数：')
      for (const [dim, codes] of Object.entries(grouped)) {
        console.log(`  ${dim.padEnd(14)} ${codes.length} 个  [${codes.join(', ')}]`)
      }
      // layer 分布
      const layerDist = {}
      for (const op of opAll) layerDist[op.layer] = (layerDist[op.layer] ?? 0) + 1
      console.log('\nlayer 分布:', layerDist)
      // 语料饱和阈值分布（rich_threshold 是 get_dimension_scores 的分母，删不得）
      const thDist = {}
      for (const op of opAll) thDist[op.rich_threshold] = (thDist[op.rich_threshold] ?? 0) + 1
      console.log('rich_threshold 分布:', thDist)
    }
  }

  // ── Step 4: questions ────────────────────────────────────────────────────
  hr('4. questions（期望 657 行，无 RLS）')
  const qCount = await countTable('questions')
  console.log(`总行数: ${qCount.error ? '❌ ' + qCount.error : qCount.count}`)

  if (!qCount.error && qCount.count > 0) {
    for (const part of [1, 2, 3]) {
      const r = await countTable('questions', q => q.eq('part', part))
      console.log(`  Part ${part}: ${r.error ? r.error : r.count}`)
    }
    const isNew  = await countTable('questions', q => q.eq('is_new', true))
    const topic  = await countTable('questions', q => q.eq('topic_only', true))
    const hasPar = await countTable('questions', q => q.not('parent_card_id', 'is', null))
    console.log(`  is_new=true: ${isNew.count}  |  topic_only=true: ${topic.count}  |  has parent: ${hasPar.count}`)
    // 样本
    const qs = await sampleRows('questions', 'part, topic, question_text, is_new, topic_only', 3, 'part')
    if (!qs.error) {
      console.log('\n样本 3 行：')
      console.table(qs.data.map(q => ({
        part: q.part,
        topic: q.topic.substring(0, 25),
        question_text: q.question_text.substring(0, 50),
        is_new: q.is_new,
        topic_only: q.topic_only,
      })))
    }
  }

  // ── Step 5: question_observation_links ───────────────────────────────────
  hr('5. question_observation_links（期望 277 行，无 RLS）')
  const qolCount = await countTable('question_observation_links')
  console.log(`总行数: ${qolCount.error ? '❌ ' + qolCount.error : qolCount.count}`)

  if (!qolCount.error && qolCount.count > 0) {
    const primary = await countTable('question_observation_links', q => q.eq('is_primary', true))
    console.log(`  is_primary=true: ${primary.count}`)
    // 观察点覆盖分布（取前500行分析）
    const { data: links } = await sampleRows(
      'question_observation_links', 'observation_point_id', 500,
    )
    if (links) {
      const dist = {}
      for (const row of links) {
        dist[row.observation_point_id] = (dist[row.observation_point_id] ?? 0) + 1
      }
      const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1])
      console.log(`\n覆盖的观察点 code 数: ${sorted.length}`)
      console.log('Top 10（按映射数降序）：')
      console.table(sorted.slice(0, 10).map(([code, cnt]) => ({ code, mappings: cnt })))
    }
  }

  // ── Step 6: corpus（当前匿名 user） ──────────────────────────────────────
  hr('6. corpus（RLS = 仅 owner，当前 uid 的语料）')
  const cCount = await countTable('corpus')
  console.log(`当前用户可见行数: ${cCount.error ? '❌ ' + cCount.error : cCount.count}`)

  // ── Step 7: corpus_point_links ───────────────────────────────────────────
  hr('7. corpus_point_links（RLS = 仅 owner）')
  const cplCount = await countTable('corpus_point_links')
  console.log(`当前用户可见行数: ${cplCount.error ? '❌ ' + cplCount.error : cplCount.count}`)

  // ── Step 8: profiles（当前匿名 user） ────────────────────────────────────
  hr('8. profiles（RLS = 仅 owner）')
  const pCount = await countTable('profiles')
  console.log(`当前用户可见行数: ${pCount.error ? '❌ ' + pCount.error : pCount.count}`)
  if (!pCount.error && pCount.count > 0) {
    const { data: profile } = await sampleRows('profiles', 'id, plan, display_name, created_at', 1)
    if (profile?.[0]) console.log('  profile row:', profile[0])
  }

  // ── Step 9: RPC ──────────────────────────────────────────────────────────
  hr('9. RPC get_dimension_scores（authenticated 调用）')
  const { data: rpcData, error: rpcErr } = await sb.rpc('get_dimension_scores')
  if (rpcErr) {
    console.log(`  ❌ 错误: ${rpcErr.message}`)
  } else {
    console.log(`  ✅ 返回 ${rpcData?.length ?? 0} 行`)
    if (rpcData?.length > 0) console.table(rpcData)
  }

  // ── 总结对比表 ────────────────────────────────────────────────────────────
  hr('总结 — 上轮(anon未登录) vs 本轮(authenticated)')

  const results = [
    ['dimensions',                 dimCount,  '6',   'authenticated'],
    ['observation_points',         opCount,   '44',  'authenticated'],
    ['questions',                  qCount,    '657', '无 RLS'],
    ['question_observation_links', qolCount,  '277', '无 RLS'],
    ['corpus',                     cCount,    '0',   '仅 owner'],
    ['corpus_point_links',         cplCount,  '0',   '仅 owner'],
    ['profiles',                   pCount,    '≥0',  '仅 owner'],
  ]

  console.log(
    '表名'.padEnd(33) +
    '上轮'.padEnd(8) +
    '本轮'.padEnd(8) +
    '期望'.padEnd(8) +
    'RLS'
  )
  console.log('─'.repeat(70))
  for (const [name, res, expected, rls] of results) {
    const prevVal = '0(RLS?)'
    const curVal  = res.error ? '❌err' : String(res.count)
    console.log(
      name.padEnd(33) +
      prevVal.padEnd(8) +
      curVal.padEnd(8) +
      expected.padEnd(8) +
      rls
    )
  }
  console.log('')
}

main().catch(err => {
  console.error('脚本执行失败:', err)
  process.exit(1)
})
