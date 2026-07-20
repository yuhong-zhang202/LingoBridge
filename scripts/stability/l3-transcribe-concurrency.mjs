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
 */
import { parseArgs, requireArg, makeLogger, makeChecks, timedFetch, assertTinyAudio, AiBudget, confirmCost, stats, table, fail, makeAuth } from './_lib.mjs'
import { readFileSync } from 'node:fs'

const USAGE = `见文件头注释：--base-url --email --password --audio --concurrency 必填`
const args = parseArgs()
const BASE = requireArg(args, 'base-url', USAGE).replace(/\/$/, '')
const EMAIL = requireArg(args, 'email', USAGE)
const PASSWORD = requireArg(args, 'password', USAGE)
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
const approval = await confirmCost([
  `ASR 调用 ${CONC} 次 × ${audioInfo.seconds.toFixed(2)} 秒 × ¥${ASR_PER_S}/秒`,
  `成本阀 MAX_AI_CALLS=${MAX_AI_CALLS}（超出立即 exit(2)）`,
  `本档不自动升档；跑完请人工看 Zeabur 指标后再决定`,
], est, { approved: args['i-approved-cost'], ledger: 'l3-transcribe', tag: `c${CONC}` })

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

async function oneTranscribe(i) {
  budget.spend(`transcribe#${i}`)
  const form = new FormData()
  form.append('audio', new Blob([audioBuf], { type: 'audio/wav' }), `tiny-${i}.wav`)
  const r = await timedFetch(`${BASE}/api/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }, 180_000)
  log(`   #${i} → ${r.status} ${r.ms}ms ${r.status === 200 ? `text="${String(r.json?.text ?? '').slice(0, 40)}"` : r.text.slice(0, 120)}`)
  return { i, ...r }
}

const t0 = Date.now()
const results = await Promise.all(Array.from({ length: CONC }, (_, i) => oneTranscribe(i + 1)))
const wallMs = Date.now() - t0

const okList = results.filter((r) => r.status === 200)
const s = stats(results.map((r) => r.ms))
const statusCount = {}
for (const r of results) statusCount[r.status] = (statusCount[r.status] ?? 0) + 1

log('')
table(log, ['指标', '值'], [
  ['并发档', CONC],
  ['墙钟总耗时', `${wallMs}ms`],
  ['成功数', `${okList.length}/${CONC}`],
  ['单请求 P50', `${s.p50}ms`],
  ['单请求 P95', `${s.p95}ms`],
  ['单请求 max', `${s.max}ms`],
  ['状态码分布', JSON.stringify(statusCount)],
])

check('本档 100% 成功（200）', okList.length === CONC, `${okList.length}/${CONC}，状态码 ${JSON.stringify(statusCount)}`)
check('转写结果非空', okList.every((r) => typeof r.json?.text === 'string'), '')
check('单请求 P95 < 30s（超过即接近网关超时区）', s.p95 < 30_000, `实测 ${s.p95}ms`)
check('无 5xx', !Object.keys(statusCount).some((k) => Number(k) >= 500), JSON.stringify(statusCount))
check('无 429（当日 transcribe 熔断未触发，上限 200）', !statusCount['429'], JSON.stringify(statusCount))
check('无 0（客户端超时/连接被切）', !statusCount['0'], JSON.stringify(statusCount))

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
finish({ layer: 'L3', concurrency: CONC, ai_calls: budget.used, estimated_cost_cny: Number(est.toFixed(4)), p95: s.p95, failed: rep.failed })
process.exit(rep.failed > 0 ? 1 : 0)
