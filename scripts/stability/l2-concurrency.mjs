#!/usr/bin/env node
/**
 * @module   stability/l2-concurrency
 * @desc     【L2 并发｜零 AI 费用】只压【不花钱】的接口，分三个面：
 *             face=node   → GET /api/version         纯 Node 运行时，不碰 DB
 *             face=db     → GET /api/questions?mode=switch  Supabase 数据面（显式 no-store，绕不过 CDN）
 *             face=auth   → POST /api/events         带 token，每请求 1 次 auth.getUser → Supabase Auth 面
 *           ⚠️ 本层【绝不】压任何触发 AI 的接口。目标不是压崩，是证明对内测 3 req/s 有 10 倍余量。
 *
 * 用法（必须显式指定面与档位；不传就不跑，没有默认全套）：
 *   node --env-file=.env.local scripts/stability/l2-concurrency.mjs \
 *     --base-url https://<域名> --face node --concurrency 5 --duration 30
 *   auth 面另需：--email <测试邮箱> --password <密码>
 *
 * 梯度纪律（人工执行，脚本不自动升档）：
 *   每档跑完 → 看 Zeabur CPU/内存 + Supabase Auth 用量 → 人工决定是否升下一档。
 *   建议档位：1 → 3 → 5 → 10 → 20（并发连接数），每档 30s。
 *
 * 中止条件（脚本内置，命中即停止本档并以非零码退出）：
 *   - 错误率 > 5%
 *   - P95 > 3000ms
 *   - 出现任何 5xx
 *   - 出现 429（auth 面：Supabase Auth 限流）
 */
import { parseArgs, requireArg, makeLogger, makeChecks, timedFetch, stats, table, fail, makeAuth } from './_lib.mjs'

const USAGE = `见文件头注释：--base-url --face node|db|auth --concurrency N --duration 秒`
const args = parseArgs()
const BASE = requireArg(args, 'base-url', USAGE).replace(/\/$/, '')
const FACE = requireArg(args, 'face', USAGE)
const CONC = Number(requireArg(args, 'concurrency', USAGE))
const DURATION_S = Number(args.duration ?? 30)

if (!['node', 'db', 'auth'].includes(FACE)) fail('--face 只能是 node | db | auth')
if (!Number.isFinite(CONC) || CONC < 1 || CONC > 30) fail('--concurrency 必须是 1..30（>30 请先与产品方确认，2vCPU/2GB 小机器）')
if (!Number.isFinite(DURATION_S) || DURATION_S < 5 || DURATION_S > 300) fail('--duration 必须是 5..300 秒')

// 中止条件（写死，不接受命令行放宽）
const ABORT = { errorRatePct: 5, p95Ms: 3000 }

const { log, finish } = makeLogger(`L2-${FACE}-c${CONC}`)
log(`目标：${BASE}｜面：${FACE}｜并发：${CONC}｜时长：${DURATION_S}s`)
log('本层零 AI 调用：所压端点均不触发任何模型。')
log(`中止条件：错误率 > ${ABORT.errorRatePct}% ／ P95 > ${ABORT.p95Ms}ms ／ 任意 5xx ／ 任意 429`)

const { check, report } = makeChecks(log)

// ── 构造单次请求 ─────────────────────────────────────────────
let makeReq
if (FACE === 'node') {
  makeReq = () => timedFetch(`${BASE}/api/version`, {}, 15_000)
} else if (FACE === 'db') {
  makeReq = () => timedFetch(`${BASE}/api/questions?mode=switch`, {}, 20_000)
} else {
  const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!SUPABASE_URL || !ANON_KEY) fail('auth 面需要 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY，请用 node --env-file=.env.local 运行。')
  // 凭据优先从环境变量取（配合 node --env-file=.env.local），命令行参数仅作兜底。
  // 目的：密码不出现在 argv / shell history / ps 输出里。
  const email = args.email ? String(args.email) : (process.env.QA_TEST_EMAIL ?? '')
  const password = args.password ? String(args.password) : (process.env.QA_TEST_PASSWORD ?? '')
  if (!email || !password) fail('auth 面需要凭据：请在 .env.local 设 QA_TEST_EMAIL / QA_TEST_PASSWORD，并用 node --env-file=.env.local 运行。')
  const auth = makeAuth({ supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, log })
  await auth.signIn(email, password)
  const token = await auth.getToken()
  // /api/events 只写一行埋点、不碰 AI，是「带 token 且轻」的最佳探针：
  // 每次请求服务端都会做一次 getUser(token) → 直击 Supabase Auth 面。
  makeReq = () => timedFetch(`${BASE}/api/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-flow-id': `qa-l2-${Date.now()}` },
    body: JSON.stringify({ event: 'match.view_rendered', storyId: null, props: {} }),
  }, 20_000)
  log('⚠️ auth 面会往 flow_events 写入埋点行 → 测后按时间窗口 SQL 清理。')
}

// ── 恒定并发跑固定时长 ───────────────────────────────────────
const endAt = Date.now() + DURATION_S * 1000
const latencies = []
const statusCount = {}
let aborted = null

async function worker(id) {
  while (Date.now() < endAt && !aborted) {
    const r = await makeReq()
    latencies.push(r.ms)
    statusCount[r.status] = (statusCount[r.status] ?? 0) + 1
    if (r.status >= 500) aborted = `worker${id} 收到 ${r.status}（5xx）`
    if (r.status === 429) aborted = `worker${id} 收到 429（上游限流）`
  }
}

const t0 = Date.now()
await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)))
const elapsedS = (Date.now() - t0) / 1000

// ── 结果 ─────────────────────────────────────────────────────
const total = latencies.length
const okCount = Object.entries(statusCount).filter(([s]) => Number(s) >= 200 && Number(s) < 400).reduce((n, [, v]) => n + v, 0)
const errRate = total ? ((total - okCount) / total) * 100 : 100
const s = stats(latencies)
const rps = total / elapsedS

log('')
table(log, ['指标', '值'], [
  ['总请求数', total],
  ['实测吞吐 RPS', rps.toFixed(2)],
  ['成功率', `${(100 - errRate).toFixed(2)}%`],
  ['P50', `${s.p50}ms`],
  ['P95', `${s.p95}ms`],
  ['max', `${s.max}ms`],
  ['状态码分布', JSON.stringify(statusCount)],
])

check(`错误率 ≤ ${ABORT.errorRatePct}%`, errRate <= ABORT.errorRatePct, `实测 ${errRate.toFixed(2)}%`)
check(`P95 ≤ ${ABORT.p95Ms}ms`, s.p95 <= ABORT.p95Ms, `实测 ${s.p95}ms`)
check('无 5xx', !Object.keys(statusCount).some((k) => Number(k) >= 500), JSON.stringify(statusCount))
check('无 429', !statusCount['429'], JSON.stringify(statusCount))
check('吞吐 ≥ 30 RPS（内测目标 3 RPS 的 10 倍余量）', rps >= 30, `实测 ${rps.toFixed(2)} RPS —— 未达标不等于不可用，只说明余量小于 10 倍`)

if (aborted) log(`🛑 中止条件命中：${aborted}`)
log('👉 升下一档前请人工确认：Zeabur CPU/内存曲线是否平稳、进程有无重启、Supabase Auth 用量增量。脚本不会自动升档。')

const rep = report()
finish({ layer: `L2-${FACE}`, concurrency: CONC, ai_calls: 0, estimated_cost_cny: 0, rps: Number(rps.toFixed(2)), p95: s.p95, failed: rep.failed, aborted })
process.exit(rep.failed > 0 || aborted ? 1 : 0)
