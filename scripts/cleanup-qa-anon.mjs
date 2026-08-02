#!/usr/bin/env node
/**
 * @module   cleanup-qa-anon
 * @desc     清理【开发/QA 脚本建的匿名账号】—— 只删 user_metadata 里带 lb_qa_script 标记的匿名账号，
 *           使脚本账号不再无差别混进「匿名用户数 / 留存漏斗」统计。
 *
 *           用法（默认 dry-run，只列不删）：
 *             node --env-file=.env.local scripts/cleanup-qa-anon.mjs
 *             node --env-file=.env.local scripts/cleanup-qa-anon.mjs --script probe-allowlist-errmsg
 *           真删（必须显式加 --yes）：
 *             node --env-file=.env.local scripts/cleanup-qa-anon.mjs --yes
 *
 *           环境变量：NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（脚本内不打印其值）。
 *
 *           ⚠️【删的是生产 auth 账号，三条不可动摇的纪律】
 *           1. 默认 dry-run。不加 --yes 绝不删任何东西。
 *           2. 判据【只认 lb_qa_script 标记】，绝不用「匿名 + 无业务数据」这类推断 ——
 *              真实流失用户正是「匿名 + 无业务数据」，按推断删就把漏斗要研究的那批人删了。
 *           3. 每个账号在删除前【逐个重新拉取并复核】标记仍在（列表快照可能已过期）。
 *
 *           ⚠️【历史账号无法回溯】标记从 2026-08-03 起才写。此前脚本建的匿名账号
 *              raw_user_meta_data 全是 `{}`，与真实匿名用户【无法区分】，本脚本查不到、
 *              也不该去猜。跑完本脚本 ≠ 库里就干净了。详见 docs/QA脚本匿名账号-标记与清理.md。
 *
 *           清理范围的取舍（不照搬 src/app/api/account/delete/route.ts）：
 *           · profiles / anon_restructure_counts —— 不显式删。二者有 on delete cascade 外键链
 *             （anon_restructure_counts.user_id → profiles.id → auth.users.id），admin.deleteUser 会带走。
 *           · consent_records —— 显式删。该表【故意不建外键】（见 migration 0022），cascade 碰不到它，
 *             脚本账号跑同意闸时会留下行。
 *           · llm_raw_logs / asr_raw_logs —— 显式删。同样无外键；quota-anon 段会真调一次整理，
 *             留下的是脚本自造的测试文本，留在留证表里只会污染离线复盘取样。
 *           · api_usage_logs —— 【刻意不动】。这些是真花掉的钱，删或置 null 都会让成本账目失真；
 *             该表无外键、不随删号 cascade，行会保留（user_id 指向已删的脚本账号，不涉及自然人）。
 *           · 头像 storage / beta_allowlist / revoked_users —— 不做。脚本账号不传头像、不绑邮箱，
 *             且脚本进程早已结束，无 token 吊销必要。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
import { createClient } from '@supabase/supabase-js'
import { QA_SCRIPT_META_KEY, QA_AT_META_KEY, isQaScriptUser, qaScriptNameOf } from './lib/qa-anon-auth.mjs'

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const CONFIRM = argv.includes('--yes')
const SCRIPT_FILTER = (() => {
  const i = argv.indexOf('--script')
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  const kv = argv.find((a) => a.startsWith('--script='))
  return kv ? kv.slice('--script='.length) : null
})()

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`用法：
  node --env-file=.env.local scripts/cleanup-qa-anon.mjs            # dry-run（默认）：只列不删
  node --env-file=.env.local scripts/cleanup-qa-anon.mjs --script <脚本名>  # 只看/只删某个脚本建的号
  node --env-file=.env.local scripts/cleanup-qa-anon.mjs --yes      # 真删（唯一会删数据的开关）

判据：user_metadata.${QA_SCRIPT_META_KEY} 有值 且 is_anonymous=true 且未绑邮箱/手机。
历史（2026-08-03 之前）脚本账号无标记，本脚本查不到、也不会猜。`)
  process.exit(0)
}

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!URL || !SRK) {
  console.error('❌ 缺少环境变量 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（请带 --env-file=.env.local）')
  process.exit(1)
}

const admin = createClient(URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } })
const log = (s) => console.log(s)

// ── 1) 全量列出 auth 用户 ────────────────────────────────────────────────────

/**
 * 分页拉全部 auth 用户
 * @returns  User[]（GoTrue admin 列表返回的原始对象）
 */
async function listAllUsers() {
  const PER_PAGE = 200
  const all = []
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) throw new Error(`listUsers 第 ${page} 页失败：${error.message}`)
    const batch = data?.users ?? []
    all.push(...batch)
    if (batch.length < PER_PAGE) break
  }
  return all
}

/**
 * 表格化输出
 * @param  rows  [列1, 列2, …][]
 */
function printTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length)))
  const line = (cells) => '  ' + cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ')
  log(line(headers))
  log('  ' + widths.map((w) => '─'.repeat(w)).join('  '))
  for (const r of rows) log(line(r))
}

// ── 2) 逐个账号的关联数据清理（删号前）────────────────────────────────────────

/**
 * 删除脚本账号的无外键关联行（cascade 碰不到的那几张表）
 * @param  uid  用户 id
 * @returns     [表名, 删除结果说明][]（供打印；抛错则由调用方计为失败）
 * @sideEffect  删库行（仅限传入 uid 的行）
 */
async function deleteOrphanRows(uid) {
  const notes = []
  // consent_records：migration 0022 故意不建外键，删号不 cascade，必须显式删
  const { error: cErr } = await admin.from('consent_records').delete().eq('user_id', uid)
  if (cErr) throw new Error(`consent_records 删除失败：${cErr.message}`)
  notes.push('consent_records ✓')
  // llm_raw_logs / asr_raw_logs：migration 0020，同样无外键。表可能未建（老环境）→ 视为无事可做
  for (const t of ['llm_raw_logs', 'asr_raw_logs']) {
    const { error } = await admin.from(t).delete().eq('user_id', uid)
    if (error) {
      // 42P01 = 表不存在：该环境没开留证，不算失败
      if (error.code === '42P01') { notes.push(`${t} —（表不存在，跳过）`); continue }
      throw new Error(`${t} 删除失败：${error.message}`)
    }
    notes.push(`${t} ✓`)
  }
  return notes
}

/**
 * 业务数据兜底检查：脚本账号理应没有语料，有就说明这号不是我以为的那个 —— 跳过不删
 * @param  uid  用户 id
 * @returns     corpus 行数
 */
async function corpusCount(uid) {
  const { count, error } = await admin.from('corpus').select('id', { head: true, count: 'exact' }).eq('user_id', uid)
  if (error) throw new Error(`corpus 计数失败：${error.message}`)
  return count ?? 0
}

// ── main ────────────────────────────────────────────────────────────────────

log('🧹 cleanup-qa-anon —— 清理带 lb_qa_script 标记的脚本匿名账号')
log(`模式：${CONFIRM ? '⚠️ 真删（--yes）' : 'dry-run（默认，不删任何东西）'}`)
if (SCRIPT_FILTER) log(`过滤：只处理 ${QA_SCRIPT_META_KEY} = "${SCRIPT_FILTER}" 的账号`)

const users = await listAllUsers()
log(`\nauth.users 总数：${users.length}`)

const targets = users.filter((u) => isQaScriptUser(u) && (!SCRIPT_FILTER || qaScriptNameOf(u) === SCRIPT_FILTER))

// 带标记却不满足「匿名且未绑邮箱」的账号：一律不碰，但要报出来 ——
// 数量异常（例如全部账号都落到这里）往往意味着 is_anonymous 字段没返回，而不是真的没有可清的号。
const taggedButSkipped = users.filter((u) => qaScriptNameOf(u) !== null && !isQaScriptUser(u))
if (taggedButSkipped.length > 0) {
  log(`⚠️ 有 ${taggedButSkipped.length} 个账号带 ${QA_SCRIPT_META_KEY} 标记但【不满足匿名/未绑邮箱】，本脚本不碰：`)
  for (const u of taggedButSkipped.slice(0, 10)) {
    log(`   uid=${u.id} is_anonymous=${u.is_anonymous} email=${u.email ? '有' : '无'} tag=${qaScriptNameOf(u)}`)
  }
}

const anonTotal = users.filter((u) => u.is_anonymous === true).length
const anonTagged = users.filter((u) => isQaScriptUser(u)).length
const anonUntagged = anonTotal - anonTagged
log(`匿名账号总数：${anonTotal}（其中带脚本标记 ${anonTagged} 个）`)
log(`⚠️ 无标记的匿名账号 ${anonUntagged} 个 —— 含【真实用户】与【2026-08-03 之前的历史脚本账号】，`)
log('   二者 metadata 都是空的、无法区分，本脚本一律不碰（宁可留脏数据，不可误删真实用户）。')

if (targets.length === 0) {
  log('\n✅ 没有可清理的脚本账号。')
  process.exit(0)
}

// ── 报告：按脚本分组 ─────────────────────────────────────────────────────────
const groups = new Map()
for (const u of targets) {
  const name = qaScriptNameOf(u)
  if (!groups.has(name)) groups.set(name, [])
  groups.get(name).push(u)
}
const times = targets.map((u) => u.created_at).filter(Boolean).sort()

log(`\n将处理 ${targets.length} 个脚本匿名账号：`)
printTable(
  ['建号脚本', '个数', '最早创建', '最晚创建'],
  [...groups.entries()].map(([name, list]) => {
    const ts = list.map((u) => u.created_at).filter(Boolean).sort()
    return [name, list.length, ts[0] ?? '?', ts[ts.length - 1] ?? '?']
  }),
)
log(`\n整体时间跨度：${times[0] ?? '?'} ~ ${times[times.length - 1] ?? '?'}`)

for (const [name, list] of groups) {
  const shown = list.slice(0, 30).map((u) => u.id).join(', ')
  log(`  ${name}（${list.length}）：${shown}${list.length > 30 ? ` … 还有 ${list.length - 30} 个` : ''}`)
}

if (!CONFIRM) {
  log('\n🔒 dry-run：一个账号都没删。核对上表无误后，加 --yes 再跑一次才会真删。')
  process.exit(0)
}

// ── 真删 ────────────────────────────────────────────────────────────────────
log('\n════ 开始删除（每个账号删前逐个复核标记）════')
let deleted = 0
const skipped = []
const failed = []

for (const t of targets) {
  const uid = t.id
  try {
    // 复核 1：重新拉取该账号（列表是快照，期间可能已变化 —— 例如账号已绑邮箱转为真实用户）
    const { data: got, error: getErr } = await admin.auth.admin.getUserById(uid)
    if (getErr) throw new Error(`复核读取失败：${getErr.message}`)
    const fresh = got?.user
    if (!fresh) { skipped.push([uid, '账号已不存在']); continue }
    if (!isQaScriptUser(fresh)) {
      skipped.push([uid, `复核不通过（标记/匿名状态已变）：is_anonymous=${fresh.is_anonymous} tag=${qaScriptNameOf(fresh) ?? '无'}`])
      continue
    }
    if (SCRIPT_FILTER && qaScriptNameOf(fresh) !== SCRIPT_FILTER) { skipped.push([uid, '复核后脚本名不匹配']); continue }

    // 复核 2：脚本账号不该有业务数据；有就停手交人判断（宁可漏删）
    const cc = await corpusCount(uid)
    if (cc > 0) { skipped.push([uid, `有 ${cc} 条语料，疑非脚本账号，跳过`]); continue }

    await deleteOrphanRows(uid)
    const { error: delErr } = await admin.auth.admin.deleteUser(uid)
    if (delErr) throw new Error(`deleteUser 失败：${delErr.message}`)
    deleted++
    log(`  🧹 已删 uid=${uid}（${qaScriptNameOf(fresh)} @ ${fresh.user_metadata?.[QA_AT_META_KEY] ?? '?'}）`)
  } catch (e) {
    failed.push([uid, e instanceof Error ? e.message : String(e)])
    log(`  ❌ 失败 uid=${uid}：${e instanceof Error ? e.message : String(e)}`)
  }
}

log('\n════ 结果 ════')
log(`已删除：${deleted} / 目标 ${targets.length}`)
if (skipped.length > 0) { log(`跳过 ${skipped.length} 个：`); printTable(['uid', '原因'], skipped) }
if (failed.length > 0) { log(`失败 ${failed.length} 个：`); printTable(['uid', '错误'], failed) }
log('提示：api_usage_logs 里这些账号的费用行【刻意保留】，删了会让成本账目失真。')
process.exit(failed.length > 0 ? 1 : 0)
