#!/usr/bin/env node
/**
 * @module   stability/l0-smoke
 * @desc     【L0 冒烟｜零 AI 费用】部署可用性 + 鉴权闸未被绕开。
 *           全部请求要么无 token（预期 401），要么打不花钱的读接口。
 *           为什么无 token 请求一定不花钱：读码确认所有 AI 路由的第一句都是
 *           requireUser*，鉴权失败在 formData/AI 调用之前就 return 401。
 *
 * 用法（必须显式给 --base-url，没有默认值、没有「跑全套」）：
 *   node scripts/stability/l0-smoke.mjs --base-url https://<生产域名>
 *   可选：--expect-version 0.x.y   （比对 /api/version 与本地 changelog 是否同一版）
 *
 * 通过标准（数字化）：
 *   - 静态首页 + /api/version + /api/questions 全部 200
 *   - 12 个需鉴权端点无 token 一律 401（出现任何 200/500 = 🔴 阻断）
 *   - 响应体不含 service_role / 密钥变量名 / 堆栈
 *   - /api/version P95 < 800ms（首轮实测后可校准）
 */
import { parseArgs, requireArg, makeLogger, makeChecks, timedFetch, stats, table } from './_lib.mjs'

const USAGE = `用法：node scripts/stability/l0-smoke.mjs --base-url https://<域名> [--expect-version 0.x.y]`
const args = parseArgs()
const BASE = requireArg(args, 'base-url', USAGE).replace(/\/$/, '')
const EXPECT_VERSION = typeof args['expect-version'] === 'string' ? args['expect-version'] : null

const { log, finish } = makeLogger('L0-smoke')
const { check, report } = makeChecks(log)
log(`目标：${BASE}`)
log('本层零 AI 调用：全部请求为无 token（预期 401）或不触发模型的读接口。')

// ── 1. 静态可用性 ────────────────────────────────────────────
const home = await timedFetch(`${BASE}/`, { redirect: 'manual' }, 20_000)
check('首页可访问', home.status === 200 || (home.status >= 300 && home.status < 400), `status=${home.status} ${home.ms}ms`)

// ── 2. /api/version：版本号 + 不缓存 ─────────────────────────
const verSamples = []
let lastVer = null
for (let i = 0; i < 10; i++) {
  const r = await timedFetch(`${BASE}/api/version`, {}, 15_000)
  verSamples.push(r.ms)
  if (i === 0) {
    check('/api/version 200', r.status === 200, `status=${r.status}`)
    check('/api/version 返回 version 字段', typeof r.json?.version === 'string', `body=${r.text.slice(0, 120)}`)
    check('/api/version 带 no-store（旧标签页检测依赖它）',
      (r.headers.get('cache-control') ?? '').includes('no-store'),
      `cache-control=${r.headers.get('cache-control')}`)
    lastVer = r.json?.version ?? null
  }
}
const vs = stats(verSamples)
check('/api/version P95 < 800ms', vs.p95 < 800, `P50=${vs.p50}ms P95=${vs.p95}ms max=${vs.max}ms`)
if (EXPECT_VERSION) {
  check('线上版本 == 期望版本（确认部署已生效）', lastVer === EXPECT_VERSION, `线上=${lastVer} 期望=${EXPECT_VERSION}`)
} else {
  log(`ℹ️ 线上版本号 = ${lastVer}（未传 --expect-version，跳过比对；建议传，否则「部署没生效」这类问题测不出来）`)
}

// ── 3. 题库读接口（走 Supabase 数据面，不花 AI 钱）────────────
const q1 = await timedFetch(`${BASE}/api/questions?part=1`, {}, 20_000)
check('/api/questions?part=1 返回非空数组', q1.status === 200 && Array.isArray(q1.json?.questions) && q1.json.questions.length > 0,
  `status=${q1.status} n=${q1.json?.questions?.length ?? 'n/a'} ${q1.ms}ms`)

const sw = []
for (let i = 0; i < 3; i++) {
  const r = await timedFetch(`${BASE}/api/questions?mode=switch`, {}, 20_000)
  sw.push(r)
}
check('/api/questions?mode=switch 全部 200', sw.every((r) => r.status === 200), sw.map((r) => r.status).join(','))
check('mode=switch 显式 no-store', (sw[0].headers.get('cache-control') ?? '').includes('no-store'),
  `cache-control=${sw[0].headers.get('cache-control')}`)
const ids = sw.map((r) => r.json?.question?.id).filter(Boolean)
log(`ℹ️ 三次随机切题 id：${ids.join(', ')}（全同不一定是 bug，题池小就会撞；仅记录不断言）`)

const badObs = await timedFetch(`${BASE}/api/questions?mode=by-observation`, {}, 15_000)
check('缺 obs 参数 → 400', badObs.status === 400, `status=${badObs.status}`)

// ── 4. 鉴权闸：无 token 一律 401（这是本层最重要的断言）──────
// 覆盖【全部】需鉴权端点。少测一个就等于给 AI 接口留一条免鉴权白嫖路径。
const GUARDED = [
  ['POST', '/api/transcribe', null],                   // 花钱·ASR
  ['POST', '/api/restructure', { rawText: 'x' }],       // 花钱·qwen-flash
  ['POST', '/api/corpus', { rawText: 'x' }],
  ['POST', '/api/matching', { corpusId: 'x' }],         // 花钱·qwen-plus ×2
  // ⚠️ 这两个是 POST（commit 0ab7e60，2026-07-20 起）。此前是 GET，产品方改成 POST 的原因是
  // GET 在 HTTP 语义上安全/可缓存，浏览器预取、爬虫、链接预览会自行发起，而这两个端点
  // 扣额度 + 真实调付费 AI —— 那些无意的 GET 会直接烧钱。契约以 route.ts 的 export 为准。
  // 历史教训（台账 120）：方法写错会拿到 405，而 405 是 Next.js 在【路由层】就拒了、
  // 【根本没走到鉴权】，却极易被记成「鉴权断言通过」。下面第 4.1 节的 405 对照就是为此设的。
  ['POST', '/api/analysis', { questionId: 'x' }],          // 花钱
  ['POST', '/api/analysis/phrases', { questionId: 'x' }],  // 花钱
  ['POST', '/api/pronounce', { intended: 'a', heard: 'b' }], // 花钱
  ['POST', '/api/practice', { messages: [] }],          // 花钱
  ['POST', '/api/practice/polish', { sentence: 'a' }],  // 花钱
  ['POST', '/api/consent', {}],
  ['POST', '/api/events', { event: 'match.view_rendered' }],
  ['POST', '/api/account/delete', {}],
  ['GET',  '/api/dashboard', null],
]
const rows = []
for (const [method, path, body] of GUARDED) {
  const r = await timedFetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }, 20_000)
  rows.push([`${method} ${path}`, r.status, `${r.ms}ms`, r.status === 401 ? 'OK' : '⚠️'])
  check(`无 token ${method} ${path} → 401`, r.status === 401, `实际 status=${r.status} body=${r.text.slice(0, 100)}`)
}
log('')
table(log, ['端点', 'status', '耗时', '判定'], rows)

// ── 4.1 方法契约 A/B 对照：光看「被拒了」区分不出是路由层拒的还是鉴权层拒的 ──
// 上面那轮无 token 请求若拿到 401，只能证明「这个方法走到了鉴权」；若哪天产品把方法改回去，
// 上面会变成 405，而 405 同样是「非 200」—— 断言写成「不得 200」就会假通过。
// 故这里做同路径的 A/B：正确方法 → 401（走到鉴权），错误方法 → 405（路由层拒）。
// 两个方向都对上，才能说「脚本用的方法和产品实现的方法一致」。全程无 token、零 AI 调用、零成本。
const METHOD_CONTRACT = [
  ['/api/analysis', 'POST', 'GET'],
  ['/api/analysis/phrases', 'POST', 'GET'],
]
for (const [path, good, bad] of METHOD_CONTRACT) {
  const okRes = await timedFetch(`${BASE}${path}`, {
    method: good, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ questionId: 'x' }),
  }, 20_000)
  check(`方法契约 ${good} ${path} → 401（说明该方法确实存在且走到了鉴权，不是 405）`,
    okRes.status === 401, `实际 status=${okRes.status}（405=路由不认这个方法，脚本契约已过期）`)

  const badRes = await timedFetch(`${BASE}${path}`, { method: bad }, 20_000)
  check(`方法契约 ${bad} ${path} → 405（旧方法必须已被路由层拒绝，否则仍可被预取烧钱）`,
    badRes.status === 405, `实际 status=${badRes.status}`)
}

// ── 5. 伪造 token：必须 401，不能 500，也不能放行 ────────────
for (const [method, path] of [['GET', '/api/dashboard'], ['POST', '/api/transcribe']]) {
  const r = await timedFetch(`${BASE}${path}`, { method, headers: { authorization: 'Bearer not-a-real-jwt' } }, 20_000)
  check(`伪造 token ${method} ${path} → 401（非 500/200）`, r.status === 401, `status=${r.status}`)
}

// ── 6. 泄漏体检：错误响应里不许出现内部信息 ───────────────────
const leakProbe = await timedFetch(`${BASE}/api/matching`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json',
}, 15_000)
const LEAK_PATTERNS = ['service_role', 'SUPABASE_SERVICE_ROLE_KEY', 'DASHSCOPE_API_KEY', 'DOUBAO_ASR_ACCESS_TOKEN', 'at async', 'node_modules']
const hit = LEAK_PATTERNS.filter((p) => leakProbe.text.includes(p))
check('错误响应不泄漏密钥变量名 / 堆栈', hit.length === 0, hit.length ? `命中：${hit.join(',')}` : `status=${leakProbe.status}`)

const r = report()
finish({ layer: 'L0', ai_calls: 0, estimated_cost_cny: 0, failed: r.failed })
process.exit(r.failed > 0 ? 1 : 0)
