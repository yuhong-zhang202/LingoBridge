/**
 * 一次性只读侦察脚本 — 摸清 Supabase 题库相关表的真实结构和数据量
 * 运行：node --env-file=.env.local scripts/inspect-db.mjs
 * 只做 SELECT / HEAD 查询，绝不 insert / update / delete
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('❌ 缺少环境变量 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const sb = createClient(url, key)

// ── 工具函数 ──────────────────────────────────────────────────────────────

/** 用 head:true 做精确行数统计 */
async function countTable(table) {
  const { count, error } = await sb
    .from(table)
    .select('*', { count: 'exact', head: true })
  if (error) return { count: null, error: error.message }
  return { count, error: null }
}

/** 取前 N 行样本 */
async function sample(table, columns = '*', limit = 3, order = null) {
  let q = sb.from(table).select(columns).limit(limit)
  if (order) q = q.order(order)
  const { data, error } = await q
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

function sep(label) {
  console.log('\n' + '─'.repeat(60))
  console.log(`  ${label}`)
  console.log('─'.repeat(60))
}

// ── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 LingoBridge DB Inspect — anon key，只读\n')
  console.log(`URL: ${url}`)

  // ── 1. dimensions ───────────────────────────────────────────────────────
  sep('1. dimensions（维度参考表）')
  const dimCount = await countTable('dimensions')
  console.log(`行数: ${dimCount.error ?? dimCount.count}`)
  const dims = await sample('dimensions', 'id, name, sort_order', 10, 'sort_order')
  if (dims.error) {
    console.log(`样本查询失败: ${dims.error}`)
  } else {
    console.table(dims.data)
  }

  // ── 2. observation_points ───────────────────────────────────────────────
  sep('2. observation_points（观察点，期望 43+1=44 行）')
  const opCount = await countTable('observation_points')
  console.log(`行数: ${opCount.error ?? opCount.count}`)

  // 按维度分组统计
  // mapped_question_count 已随迁移 0066 删列（从未被回写、值双向失真）；要「挂了几道题」查
  // question_observation_links 实算，别再 select 一个不存在的列（select 到不存在的列 PostgREST 会整条查询报 42703）。
  const opAll = await sample('observation_points', 'code, dimension_id, name, layer, rich_threshold, sort_order', 200, 'sort_order')
  if (opAll.error) {
    console.log(`样本查询失败: ${opAll.error}`)
  } else {
    // 按 dimension_id 分组
    const grouped = {}
    for (const op of opAll.data) {
      if (!grouped[op.dimension_id]) grouped[op.dimension_id] = []
      grouped[op.dimension_id].push(op.code)
    }
    console.log('\n各维度观察点数：')
    for (const [dim, codes] of Object.entries(grouped)) {
      console.log(`  ${dim.padEnd(15)} ${codes.length} 个  [${codes.join(', ')}]`)
    }

    // 打印 layer 分布
    const layerDist = {}
    for (const op of opAll.data) {
      layerDist[op.layer] = (layerDist[op.layer] ?? 0) + 1
    }
    console.log('\nlayer 分布：', layerDist)
  }

  // ── 3. questions ────────────────────────────────────────────────────────
  sep('3. questions（题目表）')
  const qCount = await countTable('questions')
  console.log(`总行数: ${qCount.error ?? qCount.count}`)

  if (!qCount.error && qCount.count > 0) {
    // 按 part 分组
    for (const part of [1, 2, 3]) {
      const { count, error } = await sb
        .from('questions')
        .select('*', { count: 'exact', head: true })
        .eq('part', part)
      console.log(`  Part ${part}: ${error ? error.message : count} 行`)
    }

    // topic_only / is_new 分布
    const { count: topicOnlyCount } = await sb
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('topic_only', true)
    const { count: isNewCount } = await sb
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('is_new', true)
    const { count: hasParentCount } = await sb
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .not('parent_card_id', 'is', null)
    console.log(`  topic_only=true: ${topicOnlyCount}  |  is_new=true: ${isNewCount}  |  有 parent_card_id: ${hasParentCount}`)

    // 样本 3 行
    console.log('\n样本 3 行：')
    const qSample = await sample(
      'questions',
      'id, part, topic, question_text, is_new, topic_only, parent_card_id',
      3,
      'part'
    )
    if (qSample.error) {
      console.log(`  错误: ${qSample.error}`)
    } else {
      console.table(qSample.data.map(q => ({
        part: q.part,
        topic: q.topic.substring(0, 30),
        question_text: q.question_text.substring(0, 50),
        is_new: q.is_new,
        topic_only: q.topic_only,
        has_parent: !!q.parent_card_id,
      })))
    }

    // topic 去重数
    const topicsRaw = await sample('questions', 'topic', 200)
    if (!topicsRaw.error) {
      const uniqueTopics = new Set(topicsRaw.data.map(r => r.topic))
      console.log(`\n唯一 topic 数（前 200 行采样）: ${uniqueTopics.size}`)
    }
  }

  // ── 4. question_observation_links ───────────────────────────────────────
  sep('4. question_observation_links（题目-观察点映射）')
  const qolCount = await countTable('question_observation_links')
  console.log(`总行数: ${qolCount.error ?? qolCount.count}`)

  if (!qolCount.error && qolCount.count > 0) {
    const { count: primaryCount } = await sb
      .from('question_observation_links')
      .select('*', { count: 'exact', head: true })
      .eq('is_primary', true)
    const { count: secondaryCount } = await sb
      .from('question_observation_links')
      .select('*', { count: 'exact', head: true })
      .eq('is_primary', false)
    console.log(`  is_primary=true: ${primaryCount}  |  is_primary=false: ${secondaryCount}`)

    // 观察点 code 分布（有多少题挂在哪个观察点）
    const qolSample = await sample('question_observation_links', 'observation_point_id, is_primary', 500)
    if (!qolSample.error) {
      const dist = {}
      for (const row of qolSample.data) {
        dist[row.observation_point_id] = (dist[row.observation_point_id] ?? 0) + 1
      }
      const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1])
      console.log(`\n观察点覆盖数（前 500 行，按映射数降序 Top 10）：`)
      console.table(sorted.slice(0, 10).map(([code, cnt]) => ({ code, mappings: cnt })))
      console.log(`覆盖到的不同观察点: ${sorted.length} 个`)
    }
  }

  // ── 5. corpus（预期 RLS 拦截，anon 读不到自己的行） ───────────────────
  sep('5. corpus（语料表，有 RLS）')
  const cCount = await countTable('corpus')
  console.log(`anon 可见行数: ${cCount.error ?? cCount.count}`)
  if (cCount.error) {
    console.log(`  → RLS 拦截或权限不足（正常）`)
  } else if (cCount.count === 0) {
    console.log(`  → 可访问但无数据（RLS 过滤 or 表为空）`)
  }

  // ── 6. profiles（预期 RLS 拦截） ─────────────────────────────────────
  sep('6. profiles（用户画像表，有 RLS）')
  const pCount = await countTable('profiles')
  console.log(`anon 可见行数: ${pCount.error ?? pCount.count}`)
  if (pCount.error) {
    console.log(`  → RLS 拦截或权限不足（正常）`)
  }

  // ── 7. corpus_point_links（预期 RLS 拦截） ────────────────────────────
  sep('7. corpus_point_links（语料-观察点映射，有 RLS）')
  const cplCount = await countTable('corpus_point_links')
  console.log(`anon 可见行数: ${cplCount.error ?? cplCount.count}`)
  if (cplCount.error) {
    console.log(`  → RLS 拦截或权限不足（正常）`)
  }

  // ── 8. 检查是否有 Postgres 函数（RPC） ───────────────────────────────
  sep('8. RPC get_dimension_scores（匿名调用预期报错）')
  const { data: rpcData, error: rpcErr } = await sb.rpc('get_dimension_scores')
  if (rpcErr) {
    console.log(`  anon 调用结果: 错误 — ${rpcErr.message} （正常，需 authenticated）`)
  } else {
    console.log(`  anon 调用成功，返回 ${rpcData?.length ?? 0} 行（注意检查 RLS）`)
  }

  // ── 总结 ─────────────────────────────────────────────────────────────
  sep('总结')
  console.log('表名                         anon 可见行数')
  for (const [table, result] of [
    ['dimensions',                 dimCount],
    ['observation_points',         opCount],
    ['questions',                  qCount],
    ['question_observation_links', qolCount],
    ['corpus',                     cCount],
    ['corpus_point_links',         cplCount],
    ['profiles',                   pCount],
  ]) {
    const val = result.error ? `❌ ${result.error}` : String(result.count)
    console.log(`  ${table.padEnd(30)} ${val}`)
  }
  console.log('')
}

main().catch(err => {
  console.error('脚本执行失败:', err)
  process.exit(1)
})
