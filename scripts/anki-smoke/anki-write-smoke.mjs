/**
 * anki-write-smoke —— Anki 写路径「真库冒烟」脚本（一次性测试用户 + 铁清理）。
 *
 * 背景：Anki 全套 schema（迁移 0030–0039）已应用到新加坡生产库，但【写路径事务正确性】
 *       尚未在真 PG 上跑过（本地无库、无独立 staging）。本脚本用一个「一次性、可识别、
 *       永不与真实用户冲突」的测试用户，脚本化跑一遍红队/待办点名的关键写路径，跑完把该
 *       测试用户的所有残留行删净。
 *
 * ⚠️ 它【会写生产库】（INSERT/UPDATE/DELETE），但【不调用任何付费 AI】——drain 状态机
 *    退化为「claim RPC + 直写状态」层面验证，绝不走 drain HTTP 端点 / 千问，故零 AI 费用。
 *
 * ── 隔离哨兵（sentinel，防误伤真实用户的唯一命门）──────────────────────────────
 *   测试用户 email 恒为  anki-smoke-<suffix>@smoke.invalid
 *     · `.invalid` 是 RFC 2606 保留 TLD，永不可能是真实用户邮箱；
 *     · 前缀 `anki-smoke-` 是本脚本专属。
 *   所有清理 DELETE 都以「user_id ∈ (email LIKE 'anki-smoke-%@smoke.invalid' 的 auth.users)」
 *   为条件——即便该子查询返回空集，DELETE 也只影响 0 行，【没有任何一条路径能命中真实用户数据】。
 *
 * ── 用户模型（为何必须建 auth.users）───────────────────────────────────────────
 *   profiles.id → auth.users(id)  强 FK（0001）；anki_cards / corpus / anki_generation_jobs
 *   / corpus_question_matches 的 user_id → profiles(id) 强 FK。故【无法用合成 UUID】满足外键，
 *   必须先在 auth.users 插一行（0001 的 handle_new_user 触发器会自动建对应 profiles 行）。
 *   删除时 auth.users → profiles → 各子表全链 on delete cascade，但清理仍【显式逐表按 sentinel 删】
 *   （防御纵深，即便某处 cascade 失效也删得净）。
 *
 * ── 用法 ───────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local scripts/anki-smoke/anki-write-smoke.mjs            # 打印计划（不连库）
 *   node --env-file=.env.local scripts/anki-smoke/anki-write-smoke.mjs plan       # 同上
 *   node --env-file=.env.local scripts/anki-smoke/anki-write-smoke.mjs run [suffix] [--yes] [--keep]
 *   node --env-file=.env.local scripts/anki-smoke/anki-write-smoke.mjs cleanup [suffix|--all] [--yes]
 *
 *   run     ：setup（造测试用户 + 语料）→ 逐条写路径断言 → finally 无条件 cleanup（除非 --keep）。
 *   cleanup ：独立可重跑的清理；即便 run 中途崩溃也能把该测试用户残留删净。
 *             不带 suffix 或带 --all ⇒ 清理所有 anki-smoke-% 测试用户。
 *   --yes   ：跳过交互确认（供主控在产品方点头后无人值守执行）。
 *   --keep  ：run 结束不清理（调试用，之后须手动 cleanup）。
 *
 * ⚠️ 不修改任何 src/ 产品代码；只读迁移/代码后按 schema 造/断言/清理。
 */
import pg from 'pg'
import { createInterface } from 'node:readline'

// ── sentinel 常量（写死，清理的命门）────────────────────────────────────────────
const EMAIL_DOMAIN = '@smoke.invalid'
const EMAIL_PREFIX = 'anki-smoke-'
const EMAIL_LIKE = `${EMAIL_PREFIX}%${EMAIL_DOMAIN}` // 'anki-smoke-%@smoke.invalid'
const CORPUS_MARK = '[ANKI-SMOKE] 冒烟测试语料，非真实用户数据。' // 语料 raw_text 里额外挂一个可读标记

/** 本脚本会触及的表（供 plan 打印）。 */
const TABLES_TOUCHED = {
  写: [
    'public.beta_allowlist (INSERT 1 行临时准入〔0023 触发器要求〕 / 清理 DELETE，按 email sentinel)',
    'auth.users            (INSERT 1 行测试用户 / 清理 DELETE)',
    'public.profiles       (触发器自动 INSERT / 清理 DELETE，按 sentinel)',
    'public.corpus         (INSERT 若干测试语料 / 部分测试直接 DELETE / 清理 DELETE)',
    'public.corpus_point_links (仅清理时按 corpus 归属 DELETE，测试不主动插)',
    'public.anki_cards     (RPC upsert / 直写 generated_answer|edited_answer|box / 清理 DELETE)',
    'public.anki_generation_jobs (RPC 入队/领取 · 直写 status · 插孤儿 job / 清理 DELETE)',
    'public.corpus_question_matches (仅清理时按 user_id DELETE，测试不主动插)',
  ],
  只读不写: [
    'public.questions       (只 SELECT 若干 part1/2 真题当靶子，绝不改/删)',
    'public.question_analyses(完全不碰——全站共享数据，不插不删)',
  ],
  调用的RPC: [
    'enqueue_anki_generation  (0033)',
    'swap_anki_corpus         (0037，含 0035 语义)',
    'unbind_anki_corpus       (0035)',
    'claim_anki_generation_jobs(0035，⚠️ 全局领取，见 guard)',
  ],
}

// ── CLI 解析 ────────────────────────────────────────────────────────────────────
function parseArgs() {
  const argv = process.argv.slice(2)
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'plan'
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const positional = argv.slice(1).filter((a) => !a.startsWith('--'))
  return {
    cmd,
    suffix: positional[0] || null,
    yes: flags.has('--yes'),
    keep: flags.has('--keep'),
    all: flags.has('--all'),
  }
}

function printPlan() {
  console.log('# anki-write-smoke · 执行计划（本次未连库）\n')
  console.log('隔离哨兵：测试用户 email =', `${EMAIL_PREFIX}<suffix>${EMAIL_DOMAIN}`)
  console.log('           清理条件 = user_id ∈ (email LIKE', `'${EMAIL_LIKE}')`, '——.invalid 保留域，永不撞真实用户\n')
  console.log('会【写】的表：')
  for (const t of TABLES_TOUCHED.写) console.log('  -', t)
  console.log('\n只【读】不写：')
  for (const t of TABLES_TOUCHED.只读不写) console.log('  -', t)
  console.log('\n调用的 RPC：')
  for (const t of TABLES_TOUCHED.调用的RPC) console.log('  -', t)
  console.log('\n覆盖的写路径断言：')
  console.log('  1) 懒物化 upsert 幂等（enqueue 重复调用不重复建行、不覆盖 box/generated_answer）')
  console.log('  2) swap_anki_corpus 换语料后 generated_answer + edited_answer 都清空、box/due_at 不动')
  console.log('  3a) unbind_anki_corpus 删对子：corpus_id→null + generated_answer→null + 撤在途 job，保留 SRS')
  console.log('  3b) 直接删 corpus 行：FK on delete set null 令 anki_cards/job 的 corpus_id 自动置 null，无悬挂引用')
  console.log('  4) drain 状态机（claim RPC）：pending→processing + attempts+1；15min 孤儿回收；新鲜 processing 不误抢')
  console.log('     ⚠️ 4 因 done 需真调千问 → 退化为「claim RPC + 直写 status」验证，不走 drain 端点、零 AI 费用')
  console.log('\n清理（cleanup 独立可重跑）：按上述 sentinel，逐表 DELETE')
  console.log('  beta_allowlist(按 email) → corpus_question_matches → anki_generation_jobs → anki_cards → corpus_point_links → corpus → profiles → auth.users')
  console.log('  （question_analyses / questions 全程不删）\n')
  console.log('执行：node --env-file=.env.local scripts/anki-smoke/anki-write-smoke.mjs run [suffix]')
  console.log('清理：node --env-file=.env.local scripts/anki-smoke/anki-write-smoke.mjs cleanup [--all]')
}

// ── 连接 ────────────────────────────────────────────────────────────────────────
function newClient() {
  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    console.error('✗ 缺少 SUPABASE_DB_URL。请用 node --env-file=.env.local 运行。')
    process.exit(1)
  }
  return new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
}

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans) }))
}

// ── 断言框架（不抛，跑完统一报表；末尾按是否有失败决定退出码）──────────────────
const results = []
// pass 由 expected===actual 自算（第二参 _ignored 是历史遗留、恒忽略）——避免调用点误传真值导致空过。
function check(name, _ignored, expected, actual) {
  const pass = String(expected) === String(actual)
  results.push({ name, pass, expected: String(expected), actual: String(actual) })
  console.log(`  ${pass ? '✓' : '✗'} ${name}` + (pass ? '' : `  期望=${expected} 实际=${actual}`))
}
function skip(name, why) {
  results.push({ name, pass: null, expected: '—', actual: `未验证：${why}` })
  console.log(`  ⊘ ${name}  未验证：${why}`)
}

async function one(client, sql, params) {
  const { rows } = await client.query(sql, params)
  return rows[0]
}
async function num(client, sql, params) {
  const r = await one(client, sql, params)
  return Number(Object.values(r)[0])
}

// ── auth.users 动态插入（跨 GoTrue 版本自适应）──────────────────────────────────
// 老版本里 confirmation_token/recovery_token/email_change 等曾是 NOT NULL 无默认；写死最小列集会撞。
// 故按【实际列】构造 INSERT：基础列给确定值，其余「NOT NULL 且无默认」的列按类型补安全值，
// 且只碰真实存在的列 —— 老版本自动补 ''，新版本这些列可空/有默认则跳过。彻底消除该风险点。
function defaultForType(dataType) {
  const t = String(dataType).toLowerCase()
  if (t.includes('json')) return `'{}'::jsonb`
  if (t.includes('bool')) return 'false'
  if (t.includes('timestamp') || t.includes('date') || t === 'time') return 'now()'
  if (t.includes('uuid')) return 'gen_random_uuid()'
  if (t.includes('int') || t.includes('numeric') || t.includes('double') || t.includes('real')) return '0'
  return `''` // text/varchar/character 等 → 空串（token 类列的安全值）
}
async function insertAuthUser(client, email) {
  const { rows: cols } = await client.query(
    `select column_name, data_type, is_nullable, column_default
       from information_schema.columns where table_schema='auth' and table_name='users'`,
  )
  const colSet = new Set(cols.map((c) => c.column_name))
  const base = {
    instance_id: `'00000000-0000-0000-0000-000000000000'`,
    aud: `'authenticated'`,
    role: `'authenticated'`,
    encrypted_password: `''`,
    email_confirmed_at: 'now()',
    created_at: 'now()',
    updated_at: 'now()',
    raw_app_meta_data: `'{"provider":"smoke"}'::jsonb`,
    raw_user_meta_data: `'{}'::jsonb`,
  }
  const names = []
  const exprs = []
  const params = []
  if (colSet.has('id')) { names.push('id'); exprs.push('gen_random_uuid()') }
  if (colSet.has('email')) { names.push('email'); params.push(email); exprs.push(`$${params.length}`) }
  for (const [name, expr] of Object.entries(base)) {
    if (!colSet.has(name) || names.includes(name)) continue
    names.push(name); exprs.push(expr)
  }
  // 补齐所有 NOT NULL 且无默认、尚未包含的列。
  for (const c of cols) {
    if (names.includes(c.column_name)) continue
    if (c.is_nullable === 'YES' || c.column_default !== null) continue
    names.push(c.column_name); exprs.push(defaultForType(c.data_type))
  }
  const { rows } = await client.query(
    `insert into auth.users (${names.join(', ')}) values (${exprs.join(', ')}) returning id`,
    params,
  )
  return rows[0].id
}

// ── setup：造测试用户 + 语料 ─────────────────────────────────────────────────────
async function setup(client, suffix) {
  const email = `${EMAIL_PREFIX}${suffix}${EMAIL_DOMAIN}`
  console.log(`\n[setup] 造测试用户 ${email}`)

  // 生产库启用了内测白名单触发器（0023 enforce_beta_allowlist）——非白名单邮箱插 auth.users 会被 raise。
  // 先把测试邮箱临时加进白名单（.invalid 保留域 + sentinel note），cleanup 按 email sentinel 删回。
  await client.query(
    `insert into public.beta_allowlist (email, note)
     values (lower($1), '[ANKI-SMOKE] 冒烟临时准入，跑完即删')
     on conflict (email) do nothing`,
    [email],
  )

  // 造 auth.users（按实际列动态插入，跨 GoTrue 版本自适应）；触发器自动建 profiles。
  const userId = await insertAuthUser(client, email)
  // 防御：即便触发器未生效也确保 profiles 存在。
  await client.query(`insert into public.profiles (id) values ($1) on conflict do nothing`, [userId])
  console.log(`[setup] userId=${userId}，profiles 已就绪`)

  // 取足够多的 part1/2 真题当靶子（只读，绝不改）。
  const { rows: qs } = await client.query(
    `select id, part from public.questions where part in (1,2) order by id limit 8`,
  )
  if (qs.length < 6) {
    throw new Error(`可用 part1/2 真题不足（需 ≥6，实得 ${qs.length}）——生产题库异常，中止。`)
  }

  // 造几条测试语料（source='text'，raw_text 挂可读标记；cleaned_text 不必，测试不 drain）。
  async function mkCorpus(label) {
    const r = await one(
      client,
      `insert into public.corpus (user_id, source, raw_text, status)
       values ($1, 'text', $2, 'restructured') returning id`,
      [userId, `${CORPUS_MARK} ${label}`],
    )
    return r.id
  }
  const corpus = {
    A: await mkCorpus('A'),
    B: await mkCorpus('B'),
    swapOld: await mkCorpus('swapOld'),
    swapNew: await mkCorpus('swapNew'),
    unbind: await mkCorpus('unbind'),
    del: await mkCorpus('del'),
    claim: await mkCorpus('claim'),
  }
  console.log(`[setup] 已建 ${Object.keys(corpus).length} 条测试语料`)

  return { userId, email, q: qs.map((x) => x.id), corpus }
}

// ── 测试 1：懒物化 upsert 幂等 ───────────────────────────────────────────────────
async function testEnqueueIdempotent(client, userId, qE, corpus) {
  console.log('\n[1] 懒物化 upsert 幂等（enqueue_anki_generation）')
  const c1 = await one(client, `select enqueue_anki_generation($1,$2,$3) as id`, [userId, qE, corpus.A])
  const cardId = c1.id
  check('首次入队物化 1 张卡', 1, 1,
    await num(client, `select count(*) from anki_cards where user_id=$1 and question_id=$2`, [userId, qE]))
  check('首次入队 1 条 active job', 1, 1,
    await num(client,
      `select count(*) from anki_generation_jobs where user_id=$1 and question_id=$2 and status in ('pending','processing')`,
      [userId, qE]))

  // 人为写入「已有状态」：generated_answer + 进阶 box。
  await client.query(`update anki_cards set generated_answer='KEEP', box=3 where id=$1`, [cardId])

  // 重复同参入队。
  const c2 = await one(client, `select enqueue_anki_generation($1,$2,$3) as id`, [userId, qE, corpus.A])
  check('重复入队返回同一卡行 id', true, cardId, c2.id === cardId ? cardId : c2.id)
  check('不产生重复卡行', 1, 1,
    await num(client, `select count(*) from anki_cards where user_id=$1 and question_id=$2`, [userId, qE]))
  check('不产生重复 active job', 1, 1,
    await num(client,
      `select count(*) from anki_generation_jobs where user_id=$1 and question_id=$2 and status in ('pending','processing')`,
      [userId, qE]))
  let row = await one(client, `select generated_answer, box, corpus_id from anki_cards where id=$1`, [cardId])
  check('重复入队不覆盖 generated_answer', 'KEEP', 'KEEP', row.generated_answer)
  check('重复入队不覆盖 box(SRS)', 3, 3, row.box)

  // 换 corpus 再入队：只换 corpus_id，不动已有状态；job 仍去重不新增。
  await one(client, `select enqueue_anki_generation($1,$2,$3) as id`, [userId, qE, corpus.B])
  row = await one(client, `select generated_answer, box, corpus_id from anki_cards where id=$1`, [cardId])
  check('换语料入队更新 corpus_id', corpus.B, corpus.B, row.corpus_id)
  check('换语料入队仍不动 generated_answer', 'KEEP', 'KEEP', row.generated_answer)
  check('换语料入队仍不动 box', 3, 3, row.box)
  check('换语料入队仍不重复 active job', 1, 1,
    await num(client,
      `select count(*) from anki_generation_jobs where user_id=$1 and question_id=$2 and status in ('pending','processing')`,
      [userId, qE]))
}

// ── 测试 2：swap_anki_corpus 换语料（清 generated + edited、不动 SRS）──────────────
async function testSwap(client, userId, qS, corpus) {
  console.log('\n[2] swap_anki_corpus 换语料原子清背面')
  const c = await one(client, `select enqueue_anki_generation($1,$2,$3) as id`, [userId, qS, corpus.swapOld])
  const cardId = c.id
  // 造「旧语料的旧产物」+ 推进 SRS。
  await client.query(
    `update anki_cards set generated_answer='GEN_OLD',
       edited_answer='[{"idx":0,"en":"EDIT_OLD"}]', box=4, due_at='2099-01-01T00:00:00Z' where id=$1`,
    [cardId],
  )
  const before = await one(client, `select box, due_at from anki_cards where id=$1`, [cardId])

  await client.query(`select swap_anki_corpus($1,$2,$3)`, [userId, qS, corpus.swapNew])
  const after = await one(client,
    `select corpus_id, generated_answer, edited_answer, box, due_at from anki_cards where id=$1`, [cardId])

  check('换语料后 corpus_id 指向新语料', corpus.swapNew, corpus.swapNew, after.corpus_id)
  check('换语料后 generated_answer 被清空', 'null', 'null', after.generated_answer === null ? 'null' : after.generated_answer)
  check('换语料后 edited_answer 被清空', 'null', 'null', after.edited_answer === null ? 'null' : after.edited_answer)
  check('换语料不动 box(SRS)', before.box, before.box, after.box)
  check('换语料不动 due_at(SRS)', new Date(before.due_at).getTime(), new Date(before.due_at).getTime(), new Date(after.due_at).getTime())
  // 原子性说明：swap 是单条 plpgsql RPC，PG 里天然单事务 —— 上面「新 corpus + 两背面全清」同时可见即证一致态。
  check('换语料后仍有 active job（已改指/兜底入队）', true, '≥1',
    (await num(client,
      `select count(*) from anki_generation_jobs where user_id=$1 and question_id=$2 and status in ('pending','processing')`,
      [userId, qS])) >= 1 ? '≥1' : '0')
}

// ── 测试 3a：unbind_anki_corpus 删对子 ───────────────────────────────────────────
async function testUnbind(client, userId, qU, corpus) {
  console.log('\n[3a] unbind_anki_corpus 删对子（清 generated + 撤 job，保留 SRS）')
  const c = await one(client, `select enqueue_anki_generation($1,$2,$3) as id`, [userId, qU, corpus.unbind])
  const cardId = c.id
  await client.query(`update anki_cards set generated_answer='GEN', box=2 where id=$1`, [cardId])
  check('unbind 前有 1 条 active job', 1, 1,
    await num(client,
      `select count(*) from anki_generation_jobs where user_id=$1 and question_id=$2 and status in ('pending','processing')`,
      [userId, qU]))

  await client.query(`select unbind_anki_corpus($1,$2)`, [userId, qU])
  const row = await one(client, `select corpus_id, generated_answer, box from anki_cards where id=$1`, [cardId])
  check('unbind 后 corpus_id 置 null', 'null', 'null', row.corpus_id === null ? 'null' : row.corpus_id)
  check('unbind 后 generated_answer 清空', 'null', 'null', row.generated_answer === null ? 'null' : row.generated_answer)
  check('unbind 保留 box(SRS)', 2, 2, row.box)
  check('unbind 撤掉在途 job（active=0）', 0, 0,
    await num(client,
      `select count(*) from anki_generation_jobs where user_id=$1 and question_id=$2 and status in ('pending','processing')`,
      [userId, qU]))
}

// ── 测试 3b：直接删 corpus 行 → FK on delete set null（无悬挂引用）─────────────────
async function testCorpusDeleteFk(client, userId, qD, corpus) {
  console.log('\n[3b] 直接删 corpus 行 → FK set null（anki_cards / job 的 corpus_id 自动置 null）')
  const c = await one(client, `select enqueue_anki_generation($1,$2,$3) as id`, [userId, qD, corpus.del])
  const cardId = c.id
  check('删 corpus 前 card.corpus_id = 该语料', corpus.del, corpus.del,
    (await one(client, `select corpus_id from anki_cards where id=$1`, [cardId])).corpus_id)

  // 镜像 corpus.ts deleteCorpus：先清 links 再删 corpus 行。
  await client.query(`delete from public.corpus_point_links where corpus_id=$1`, [corpus.del])
  await client.query(`delete from public.corpus where id=$1 and user_id=$2`, [corpus.del, userId])

  const card = await one(client, `select corpus_id from anki_cards where id=$1`, [cardId])
  check('删 corpus 后 anki_cards.corpus_id 自动 null（FK set null，无悬挂）', 'null', 'null',
    card.corpus_id === null ? 'null' : card.corpus_id)
  const job = await one(client,
    `select corpus_id from anki_generation_jobs where user_id=$1 and question_id=$2 order by created_at desc limit 1`,
    [userId, qD])
  check('删 corpus 后 job.corpus_id 自动 null（FK set null）', 'null', 'null',
    job && job.corpus_id === null ? 'null' : (job ? job.corpus_id : 'no-job'))
  // 备注（非断言）：裸删 corpus 不会清 generated_answer —— app 层设计是先 unbind 再删，见 corpus/route.ts。
}

// ── 测试 4：drain 状态机（claim RPC + 直写 status；不走 drain 端点、零 AI 费用）─────
async function testDrainStateMachine(client, userId, qC1, qC2, corpus) {
  console.log('\n[4] drain 状态机（claim_anki_generation_jobs RPC；不调千问）')

  // ⚠️ guard：claim RPC 是【全局】领取（不按 user 过滤），会把真实用户的 pending job 翻成 processing。
  //    仅当库里【除测试用户外无任何 job】时才敢跑，否则跳过（如实报未验证），绝不误伤真实数据。
  const foreign = await num(client,
    `select count(*) from anki_generation_jobs j
      where j.user_id not in (select id from auth.users where email like $1)`, [EMAIL_LIKE])
  if (foreign > 0) {
    skip('drain 状态机（claim/孤儿回收）', `库中存在 ${foreign} 条非测试 job，claim 全局领取会误伤，跳过`)
    return
  }

  // 4a pending → processing + attempts+1
  await client.query(
    `delete from anki_generation_jobs where user_id=$1`, [userId]) // 隔离：清掉前面测试遗留的 test-user job
  await client.query(`select enqueue_anki_generation($1,$2,$3)`, [userId, qC1, corpus.claim])
  const j = await one(client,
    `select id, attempts, status from anki_generation_jobs where user_id=$1 and question_id=$2
      order by created_at desc limit 1`, [userId, qC1])
  check('入队初态 = pending', 'pending', 'pending', j.status)
  await client.query(`select claim_anki_generation_jobs(50)`)
  const jAfter = await one(client, `select status, attempts from anki_generation_jobs where id=$1`, [j.id])
  check('claim 后 pending→processing', 'processing', 'processing', jAfter.status)
  check('claim 后 attempts+1', j.attempts + 1, j.attempts + 1, jAfter.attempts)

  // 模拟 drain 成功：直写 done（markDone 的等价）→ active 部分唯一索引释放 → 可重新入队。
  await client.query(`update anki_generation_jobs set status='done' where id=$1`, [j.id])
  await client.query(`select enqueue_anki_generation($1,$2,$3)`, [userId, qC1, corpus.claim])
  check('done 后可重新入队（active job = 1）', 1, 1,
    await num(client,
      `select count(*) from anki_generation_jobs where user_id=$1 and question_id=$2 and status in ('pending','processing')`,
      [userId, qC1]))

  // 4b 孤儿回收：processing 且 updated_at 早于 15min → 被重领；新鲜 processing 不被误抢。
  await client.query(`delete from anki_generation_jobs where user_id=$1`, [userId]) // 干净隔离
  const stale = await one(client,
    `insert into anki_generation_jobs (user_id, question_id, corpus_id, status, attempts, next_attempt_at, updated_at)
     values ($1,$2,$3,'processing',1, now() - interval '20 min', now() - interval '16 min') returning id`,
    [userId, qC2, corpus.claim])
  const fresh = await one(client,
    `insert into anki_generation_jobs (user_id, question_id, corpus_id, status, attempts, next_attempt_at, updated_at)
     values ($1,$2,$3,'processing',1, now(), now()) returning id`,
    [userId, qC1, corpus.claim])
  await client.query(`select claim_anki_generation_jobs(50)`)
  const staleAfter = await one(client, `select attempts, status from anki_generation_jobs where id=$1`, [stale.id])
  const freshAfter = await one(client, `select attempts, status from anki_generation_jobs where id=$1`, [fresh.id])
  check('孤儿(processing>15min)被重领 attempts 1→2', 2, 2, staleAfter.attempts)
  check('新鲜 processing 不被误抢 attempts 仍 1', 1, 1, freshAfter.attempts)
}

// ── cleanup：按 sentinel 逐表删净（独立可重跑）───────────────────────────────────
async function cleanup(client, { suffix, all }) {
  // 目标用户：带 suffix ⇒ 该 email；否则/--all ⇒ 所有 anki-smoke-% 测试用户。
  const emailCond = suffix && !all ? `email = $1` : `email like $1`
  const emailArg = suffix && !all ? `${EMAIL_PREFIX}${suffix}${EMAIL_DOMAIN}` : EMAIL_LIKE

  // 先删白名单临时准入行（与 auth.users 无 FK、按 email sentinel 独立删）——
  // 即便 setup 只加了白名单就失败、没造出 auth.users，这步也能兜住残留。
  const bl = await client.query(`delete from public.beta_allowlist where ${emailCond}`, [emailArg])
  console.log(`\n[cleanup] 删 beta_allowlist 临时准入: ${bl.rowCount} 行`)

  const { rows: users } = await client.query(
    `select id, email from auth.users where ${emailCond}`, [emailArg])
  console.log(`[cleanup] 匹配到 ${users.length} 个测试用户：`)
  for (const u of users) console.log(`  - ${u.email}  (${u.id})`)
  if (users.length === 0) {
    console.log('[cleanup] auth.users 侧无匹配（白名单已处理），无需进一步清理。')
    return { users: 0 }
  }
  const ids = users.map((u) => u.id)

  // 逐表按 user_id ∈ ids 删（防御纵深；即便 cascade 生效也不重复受害）。
  const del = async (label, sql, params) => {
    const r = await client.query(sql, params)
    console.log(`  删 ${label}: ${r.rowCount} 行`)
    return r.rowCount
  }
  await del('corpus_question_matches', `delete from public.corpus_question_matches where user_id = any($1)`, [ids])
  await del('anki_generation_jobs', `delete from public.anki_generation_jobs where user_id = any($1)`, [ids])
  await del('anki_cards', `delete from public.anki_cards where user_id = any($1)`, [ids])
  await del('corpus_point_links', `delete from public.corpus_point_links where corpus_id in (select id from public.corpus where user_id = any($1))`, [ids])
  await del('corpus', `delete from public.corpus where user_id = any($1)`, [ids])
  await del('profiles', `delete from public.profiles where id = any($1)`, [ids])
  // 末删 auth.users，双重条件（id ∈ ids 且 email 仍匹配 sentinel）——绝不误删。
  await del('auth.users', `delete from auth.users where id = any($1) and email like $2`, [ids, EMAIL_LIKE])
  console.log('[cleanup] 完成。question_analyses / questions 全程未触碰。')
  return { users: users.length }
}

// ── 报表 ────────────────────────────────────────────────────────────────────────
function report() {
  const pass = results.filter((r) => r.pass === true).length
  const fail = results.filter((r) => r.pass === false).length
  const skipped = results.filter((r) => r.pass === null).length
  console.log('\n──────────── 冒烟结果汇总 ────────────')
  console.log(`通过 ${pass} · 失败 ${fail} · 未验证 ${skipped}`)
  if (fail > 0) {
    console.log('\n失败项：')
    for (const r of results.filter((x) => x.pass === false)) {
      console.log(`  ✗ ${r.name}  期望=${r.expected} 实际=${r.actual}`)
    }
  }
  if (skipped > 0) {
    console.log('\n未验证项：')
    for (const r of results.filter((x) => x.pass === null)) console.log(`  ⊘ ${r.name}  ${r.actual}`)
  }
  return fail === 0
}

// ── 主流程 ──────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs()

  if (opts.cmd === 'plan' || opts.cmd === '--help') {
    printPlan()
    return
  }

  if (opts.cmd === 'cleanup') {
    const client = newClient()
    if (!opts.yes) {
      const scope = opts.suffix && !opts.all ? `${EMAIL_PREFIX}${opts.suffix}${EMAIL_DOMAIN}` : `所有 ${EMAIL_LIKE}`
      const ans = await confirm(`将从【生产库】删除测试用户（${scope}）及其全部残留行。确认？(yes/no) `)
      if (ans.trim().toLowerCase() !== 'yes') { console.log('已取消。'); return }
    }
    await client.connect()
    try { await cleanup(client, opts) } finally { await client.end() }
    return
  }

  if (opts.cmd === 'run') {
    const suffix = opts.suffix || String(Date.now()) // 脚本层用 Date.now 生成可识别后缀（非 workflow）
    const client = newClient()
    if (!opts.yes) {
      console.log('本次将对【生产库】执行写操作（INSERT/UPDATE/DELETE），但【不调用任何付费 AI】。')
      console.log(`测试用户：${EMAIL_PREFIX}${suffix}${EMAIL_DOMAIN}`)
      const ans = await confirm('确认在生产库跑冒烟并在结束时清理？(yes/no) ')
      if (ans.trim().toLowerCase() !== 'yes') { console.log('已取消。'); return }
    }
    await client.connect()
    let ctx = null
    try {
      ctx = await setup(client, suffix)
      const { userId, q, corpus } = ctx
      await testEnqueueIdempotent(client, userId, q[0], corpus)
      await testSwap(client, userId, q[1], corpus)
      await testUnbind(client, userId, q[2], corpus)
      await testCorpusDeleteFk(client, userId, q[3], corpus)
      await testDrainStateMachine(client, userId, q[4], q[5], corpus)
    } catch (e) {
      console.error('\n✗ 冒烟中途异常：', e instanceof Error ? e.message : e)
      results.push({ name: '冒烟主流程', pass: false, expected: '无异常', actual: String(e && e.message || e) })
    } finally {
      if (opts.keep) {
        console.log('\n[--keep] 跳过清理。请稍后手动：cleanup', suffix)
      } else {
        try {
          await cleanup(client, { suffix, all: false })
        } catch (e) {
          console.error('\n⚠️ 清理失败！请务必手动重跑 cleanup', suffix, '——', e instanceof Error ? e.message : e)
        }
      }
      const ok = report()
      await client.end()
      process.exit(ok ? 0 : 1)
    }
    return
  }

  console.error(`未知命令：${opts.cmd}（支持 plan / run / cleanup）`)
  process.exit(1)
}

main().catch((e) => { console.error('✗ 脚本异常：', e); process.exit(1) })
