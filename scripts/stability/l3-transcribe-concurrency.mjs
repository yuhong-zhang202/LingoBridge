#!/usr/bin/env node
/**
 * @module   stability/l3-transcribe-concurrency
 * @desc     【L3 转写并发｜会花钱】同时 N 个 /api/transcribe，找 ffmpeg 转码在 2vCPU/2GB 上的真实拐点。
 *           这是信息量最高的一层：ffmpeg 转码是全站唯一的 CPU 密集步骤，并发下最先出问题。
 *
 *           ⚠️ 本层是【本方案里唯一对 AI 接口做并发】的例外，且刻意限死：
 *             - 单档并发上限 8，全脚本一次只跑【一档】（--concurrency），不自动升档
 *             - 音频 ≤15 秒 ≤300KB 硬检查
 *             - MAX_AI_CALLS 硬停
 *             - 交互确认
 *           不做「梯度找上限」式的无休止加压——找上限只在 L2 的免费接口上做。
 *
 * 用法（一次一档，跑完看指标再人工决定下一档）：
 *   node --env-file=.env.local scripts/stability/l3-transcribe-concurrency.mjs \
 *     --base-url https://<域名> --email <测试邮箱> --password <密码> \
 *     --audio ./scripts/stability/fixtures/tiny.wav --concurrency 3 [--max-ai-calls 8]
 *
 *   建议档序：1 → 3 → 5 → 8（每档之间停下看 Zeabur 内存曲线 + 进程有无重启）
 *
 * 判读陷阱（读码已确认，务必记住）：
 *   src/app/api/transcribe/route.ts 里的 `export const maxDuration = 60` 是 Vercel 语义，
 *   Zeabur 上【不生效】。并发 8 若出现 502/504，先怀疑 Zeabur 网关超时，不是应用挂了——
 *   用「进程有没有重启 + 内存曲线是否断崖」区分，别直接判定应用崩溃。
 *
 * 注册账号每日 transcribe 熔断上限 REG_TRANSCRIBE_DAILY_LIMIT=200，
 * 1+3+5+8=17 次远在其下；若出现 429 说明当日该账号已被别的测试用掉配额。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 【第二轮增补·2026-07-20】排队闸（ea63875）验收：HTTP 侧不可观测，必须走数据库side channel
 * ─────────────────────────────────────────────────────────────────────────
 * 第二轮的核心问题是「并发 4 够不够、45000292 有没有被拦住」。但读 src 确认：
 *   transcribe/route.ts 的 busyRes(reason) 注释写死「@param reason 仅用于服务端日志定位，
 *   **不回传给客户端**」——队列满 / 等待超时 / 上游 45000292 三种来源，
 *   客户端拿到的响应【逐字节相同】：503 + {code:'ASR_BUSY'} + Retry-After: 5。
 * ⇒ 光看 HTTP 响应【永远无法】回答「45000292 有没有再出现」。必须另找判别信号。
 *
 * 判别原理（依据 route.ts 的控制流，逐行核对过）：
 *   · 队列满 / 等待超时 → acquire 返回 !ok → 第 142 行直接 return busyRes
 *     ⇒ 在 bump 之前、在豆包调用之前 ⇒ 【不写 api_usage_logs、不计次】
 *   · 上游 45000292   → 已 acquire、已 bump、已真调豆包 → 豆包拒 → throw → catch
 *     ⇒ catch 里无差别 logApiUsage({status:'error'}) ⇒ 【写一行 error、且已计次】
 * 于是：
 *   E_db（窗口内本用户 doubao_asr 的 error 行数）≈ 45000292 穿透数
 *   B - E_db = 我方闸门主动拦下的数量（符合设计的背压）
 *   计次增量 bump_delta 应当 == 成功数 S + 穿透数 E_db（排队被拒者一次都不该扣）
 *
 * 这同时【顺带验了 ea63875 的另一条承诺】：「排队在计次之前，超时用户不被扣次数」。
 */
import { parseArgs, requireArg, makeLogger, makeChecks, timedFetch, assertTinyAudio, AiBudget, confirmCost, stats, table, fail, makeAuth } from './_lib.mjs'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const USAGE = `见文件头注释：--base-url --email --password --audio --concurrency 必填`
const args = parseArgs()
const BASE = requireArg(args, 'base-url', USAGE).replace(/\/$/, '')
// 凭据优先取环境变量（QA_TEST_EMAIL / QA_TEST_PASSWORD），命令行参数只作兜底。
// 与 l1-e2e 保持一致：密码不进 shell 历史、不进 ps 进程列表。
const EMAIL = process.env.QA_TEST_EMAIL || requireArg(args, 'email', USAGE)
const PASSWORD = process.env.QA_TEST_PASSWORD || requireArg(args, 'password', USAGE)
const AUDIO = requireArg(args, 'audio', USAGE)
const CONC = Number(requireArg(args, 'concurrency', USAGE))

if (!Number.isFinite(CONC) || CONC < 1 || CONC > 8) fail('--concurrency 必须是 1..8。本层硬上限 8（每提高一档都是真金白银 + 生产是 2vCPU/2GB）。')
const MAX_AI_CALLS = Number(args['max-ai-calls'] ?? CONC)
if (!Number.isFinite(MAX_AI_CALLS) || MAX_AI_CALLS < CONC || MAX_AI_CALLS > 10) fail(`--max-ai-calls 必须在 ${CONC}..10 之间`)

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
if (!SUPABASE_URL || !ANON_KEY) fail('缺少 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY，请用 node --env-file=.env.local 运行。')

// ── 安全阀 2：音频硬检查（先于任何网络请求）─────────────────
const audioInfo = assertTinyAudio(AUDIO)

const { log, finish } = makeLogger(`L3-transcribe-c${CONC}`)
log(`目标：${BASE}｜并发档：${CONC}｜本档请求数：${CONC}`)
log(`测试音频：${AUDIO} — ${audioInfo.bytes} 字节 / ${audioInfo.seconds.toFixed(2)} 秒（已通过 ≤300KB & ≤15s 硬检查）`)

// ── 安全阀 1 预算（单价依据 src/lib/api-logger.ts：doubao_asr_per_second = 0.003）──
const ASR_PER_S = 0.003
const est = CONC * audioInfo.seconds * ASR_PER_S
// 授权：不传 --i-approved-cost 时走原 TTY 交互；传了则与 est 交叉校验 + 跨档累计封顶
// （账本 l3-transcribe：1/3/5/8 四档共享同一额度池，见 _lib.mjs 安全阀 3 注释）
// --ledger：额度池名。默认沿用 'l3-transcribe'。
// 【为什么需要可覆盖】第一轮已在 'l3-transcribe' 池累计 ¥0.4139（cap 0.6）。第二轮是产品方
// 【另行批准】的新预算，若沿用同一池，累计 0.4139+0.48 会超 0.70 被拒跑 —— 那是把两轮预算
// 错当成一轮。正解是开新池，【绝不是删账本】（_lib.mjs 安全阀 3 明令禁止删账本）。
// 第一轮账本原样保留、未做任何修改。
const LEDGER = typeof args['ledger'] === 'string' ? args['ledger'] : 'l3-transcribe'
const approval = await confirmCost([
  `ASR 调用 ${CONC} 次 × ${audioInfo.seconds.toFixed(2)} 秒 × ¥${ASR_PER_S}/秒`,
  `成本阀 MAX_AI_CALLS=${MAX_AI_CALLS}（超出立即 exit(2)）`,
  `额度池（账本）：${LEDGER}`,
  `本档不自动升档；跑完请人工看 Zeabur 指标后再决定`,
], est, { approved: args['i-approved-cost'], ledger: LEDGER, tag: `c${CONC}` })

if (approval?.mode === 'approved') {
  log(`🔓 授权模式：经 --i-approved-cost=${approval.cap} 授权、非交互运行（人未坐在终端前）`)
  log(`   本额度累计预估：¥${approval.cumulative.toFixed(4)} / ¥${approval.cap.toFixed(4)}（含本次 ¥${est.toFixed(4)}）`)
}

const budget = new AiBudget(MAX_AI_CALLS, log)
const { check, report } = makeChecks(log)
const auth = makeAuth({ supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, log })
await auth.signIn(EMAIL, PASSWORD)
const token = await auth.getToken()

// 前置：确认同意记录在（否则全档 403，白跑但不花钱）
const c = await timedFetch(`${BASE}/api/consent`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }, 30_000)
check('同意记录就绪（否则 transcribe 会全 403）', c.status === 200, `status=${c.status}`)

const audioBuf = readFileSync(AUDIO)

// ── 数据库 side channel：跑之前先取基线 ──────────────────────
// 只读，不写不删。用 service_role 是因为 daily_usage_counts / api_usage_logs 都有 RLS。
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const dbOn = Boolean(SVC_KEY)
const sb = dbOn ? createClient(SUPABASE_URL, SVC_KEY, { auth: { persistSession: false } }) : null
const TEST_USER = auth.userId
if (!dbOn) {
  log('⚠️ 未提供 SUPABASE_SERVICE_ROLE_KEY —— 无法区分「我方闸门拦下」与「豆包 45000292 穿透」，')
  log('   本档只能给出 HTTP 层结论。第二轮的核心问题将【无法回答】。')
}

/** 读今日 transcribe 计次（判「排队被拒者是否被误扣次数」） */
async function readDailyCount() {
  if (!dbOn) return null
  const day = new Date().toISOString().slice(0, 10)
  const { data, error } = await sb.from('daily_usage_counts')
    .select('count').eq('user_id', TEST_USER).eq('kind', 'transcribe').eq('day', day).maybeSingle()
  if (error) { log(`   ⚠️ 读计次失败：${error.message}`); return null }
  return data?.count ?? 0
}

const bumpBefore = await readDailyCount()
log(`计次基线：今日 transcribe count = ${bumpBefore ?? 'N/A'}（user=${TEST_USER}）`)

async function oneTranscribe(i) {
  budget.spend(`transcribe#${i}`)
  const form = new FormData()
  form.append('audio', new Blob([audioBuf], { type: 'audio/wav' }), `tiny-${i}.wav`)
  const r = await timedFetch(`${BASE}/api/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }, 180_000)
  const retryAfter = r.headers.get('retry-after')
  log(`   #${i} → ${r.status} ${r.ms}ms ${r.status === 200 ? `text="${String(r.json?.text ?? '').slice(0, 40)}"` : `code=${r.json?.code ?? '-'} retry-after=${retryAfter ?? '-'} ${r.text.slice(0, 90)}`}`)
  return { i, ...r, retryAfter }
}

const windowStart = new Date(Date.now() - 2000).toISOString()  // 留 2s 余量防时钟漂移
const t0 = Date.now()
const results = await Promise.all(Array.from({ length: CONC }, (_, i) => oneTranscribe(i + 1)))
const wallMs = Date.now() - t0
const windowEnd = new Date(Date.now() + 2000).toISOString()

const okList = results.filter((r) => r.status === 200)
const busyList = results.filter((r) => r.status === 503)
const s = stats(results.map((r) => r.ms))
const statusCount = {}
for (const r of results) statusCount[r.status] = (statusCount[r.status] ?? 0) + 1

// ── 数据库 side channel：跑完取账 ────────────────────────────
// 等一下再查：logApiUsage 是 await 的，但 Supabase 写入到可读之间仍可能有极短延迟。
await new Promise((r) => setTimeout(r, 3000))
const bumpAfter = await readDailyCount()
const bumpDelta = (bumpBefore !== null && bumpAfter !== null) ? bumpAfter - bumpBefore : null

let dbRows = null, dbSuccess = null, dbError = null, dbCost = null
if (dbOn) {
  const { data, error } = await sb.from('api_usage_logs')
    .select('status, estimated_cost_cny, usage_amount, latency_ms, created_at, metadata')
    .eq('service', 'doubao_asr').eq('user_id', TEST_USER)
    .gte('created_at', windowStart).lte('created_at', windowEnd)
    .order('created_at', { ascending: true })
  if (error) log(`   ⚠️ 读 api_usage_logs 失败：${error.message}`)
  else {
    dbRows = data
    dbSuccess = data.filter((r) => r.status === 'success').length
    dbError = data.filter((r) => r.status === 'error').length
    dbCost = data.reduce((a, r) => a + Number(r.estimated_cost_cny ?? 0), 0)
  }
}

// 穿透判定：error 行 = 已 acquire、已 bump、已真调豆包但失败 ⇒ 45000292 的强候选
const penetrated = dbError                       // 我方没拦住、被豆包拒的数量
const gateBlocked = (penetrated !== null) ? busyList.length - penetrated : null  // 我方主动拦下的

// 排队等待时长：无法直接观测（服务端不回传），只能【推导】——
// 本档单请求耗时 － 无排队基线（c1 的 P50，由 --baseline-ms 传入）。标注为推导值，不冒充实测。
const BASELINE_MS = Number(args['baseline-ms'] ?? 0)
const waitList = BASELINE_MS > 0 ? okList.map((r) => Math.max(0, r.ms - BASELINE_MS)) : []
const w = waitList.length ? stats(waitList) : null

log('')
table(log, ['指标', '值'], [
  ['并发档', CONC],
  ['墙钟总耗时', `${wallMs}ms`],
  ['成功数（200）', `${okList.length}/${CONC}`],
  ['繁忙数（503 ASR_BUSY）', `${busyList.length}/${CONC}`],
  ['单请求 P50', `${s.p50}ms`],
  ['单请求 P95', `${s.p95}ms`],
  ['单请求 max', `${s.max}ms`],
  ['状态码分布', JSON.stringify(statusCount)],
  ['—— 数据库 side channel ——', ''],
  ['计次增量 bump', bumpDelta ?? 'N/A'],
  ['DB success 行', dbSuccess ?? 'N/A'],
  ['DB error 行（=45000292 穿透强候选）', dbError ?? 'N/A'],
  ['DB 记账费用¥', dbCost !== null ? dbCost.toFixed(4) : 'N/A'],
  ['我方闸门主动拦下', gateBlocked ?? 'N/A'],
  ['—— 排队等待（推导值）——', BASELINE_MS > 0 ? `基线 ${BASELINE_MS}ms` : '未传 --baseline-ms，跳过'],
  ['排队 P50', w ? `${w.p50}ms` : 'N/A'],
  ['排队 P95', w ? `${w.p95}ms` : 'N/A'],
  ['排队 max', w ? `${w.max}ms` : 'N/A'],
])

// ───────── 第二轮验收标准（与第一轮「找拐点」完全不同）─────────
// 第一轮：8 并发 5 成功 3 失败 = 撞豆包上限，结论「拐点在豆包侧」
// 第二轮：不应再出现 45000292；超出并发者应【排队后成功】或【503 ASR_BUSY】，而不是「转写失败」

// 🔴 本轮头号问题
if (dbOn && penetrated !== null) {
  check('🔴【核心】无 45000292 穿透（DB 无 error 行 ⇒ 闸门把并发压住了）', penetrated === 0,
    `DB error 行=${penetrated}；>0 说明并发 4 仍被打穿，需下调到 3 或加持锁内重试`)
} else {
  check('🔴【核心】无 45000292 穿透', false, '缺 service_role，未能验证 —— 本轮核心问题无法回答')
}

// 「不是转写失败」：500 才是产品要消灭的那个体验
check('无 500「转写失败」（超并发必须走 503 友好提示，不能报失败）', !statusCount['500'], JSON.stringify(statusCount))
check('每个请求非成功即繁忙（只允许 200 / 503）',
  results.every((r) => r.status === 200 || r.status === 503), JSON.stringify(statusCount))

// 503 的形状必须符合设计
if (busyList.length) {
  check('503 全部带 code=ASR_BUSY', busyList.every((r) => r.json?.code === 'ASR_BUSY'),
    JSON.stringify(busyList.map((r) => r.json?.code)))
  check('503 全部带 Retry-After: 5', busyList.every((r) => r.retryAfter === '5'),
    JSON.stringify(busyList.map((r) => r.retryAfter)))
}

// 计次准确性：排队被拒者一次都不该扣（ea63875 的明确承诺）
if (bumpDelta !== null && penetrated !== null) {
  check('计次准确：bump == 成功数 + 穿透数（排队被拒者零计次）',
    bumpDelta === okList.length + penetrated,
    `bump=${bumpDelta}，成功=${okList.length}，穿透=${penetrated}，我方拦下=${gateBlocked}（这部分必须不计次）`)
}

// side channel 自洽性校验：DB success 行必须与 HTTP 200 数一致。
// 不一致 = 我的判别模型本身有问题（比如窗口取窄了、有别的进程在用同一账号），
// 此时上面基于 DB 的结论都不可信 —— 宁可标红也不要拿着错模型下结论。
if (dbSuccess !== null) {
  check('side channel 自洽：DB success 行 == HTTP 200 数（否则判别模型不可信）',
    dbSuccess === okList.length, `DB success=${dbSuccess}，HTTP 200=${okList.length}`)
}

check('转写结果非空', okList.every((r) => typeof r.json?.text === 'string'), '')
check('单请求 P95 < 30s（超过即接近网关超时区）', s.p95 < 30_000, `实测 ${s.p95}ms`)
check('无 429（当日 transcribe 熔断未触发，上限 200）', !statusCount['429'], JSON.stringify(statusCount))
check('无 0（客户端超时/连接被切）', !statusCount['0'], JSON.stringify(statusCount))

if (dbOn && penetrated > 0) {
  log('')
  log(`🔴 检出 ${penetrated} 次 45000292 穿透 —— 「并发 4」不足以压住豆包侧计数回落的时序差。`)
  log('   按硬边界要求：停下报告，不自行升档。')
}
if (busyList.length && penetrated === 0) {
  log('')
  log(`✅ ${busyList.length} 个 503 全部是【我方闸门主动拦下】（DB 无 error 行、未计次、未花钱）—— 符合设计的背压。`)
}

// 判读提示
if (statusCount['502'] || statusCount['504'] || statusCount['0']) {
  log('')
  log('🔎 出现 502/504/连接中断 —— 判读顺序（勿直接判为「应用崩了」）：')
  log('   1) Zeabur 面板看进程是否重启（重启 = 真 OOM/崩溃；没重启 = 大概率网关超时）')
  log('   2) 看内存曲线是否触顶 2GB（ffmpeg 并发转码是唯一 CPU/内存密集步骤）')
  log('   3) transcribe 的 maxDuration=60 是 Vercel 语义，在 Zeabur 不生效，别当成应用侧超时保护')
  log('   4) 若确认是网关超时 → 这是「拐点」而非「故障」，记录该并发档为余量边界即可')
}
log('')
log('👉 升下一档前人工确认：Zeabur CPU/内存曲线、进程有无重启、/dashboard 花费增量是否与本档预估吻合。')

const rep = report()
log(`AI 调用计数：${JSON.stringify(budget.summary())}`)
finish({ layer: 'L3', concurrency: CONC, ai_calls: budget.used, estimated_cost_cny: Number(est.toFixed(4)),
  db_cost_cny: dbCost !== null ? Number(dbCost.toFixed(4)) : null,
  ok: okList.length, busy: busyList.length, penetrated_45000292: penetrated, gate_blocked: gateBlocked,
  bump_delta: bumpDelta, p50: s.p50, p95: s.p95, wait_p95: w ? w.p95 : null, failed: rep.failed,
  window: [windowStart, windowEnd] })
process.exit(rep.failed > 0 ? 1 : 0)
