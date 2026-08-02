#!/usr/bin/env node
/**
 * @module   stability/_lib
 * @desc     【稳定性测试·公共库】四层测试脚本共用的安全阀与工具：
 *           成本阀（MAX_AI_CALLS 硬停）、音频体积/时长硬检查、交互确认、
 *           GoTrue 登录/刷新取 JWT、时间窗口日志、时延统计。
 *           本目录下【只读产品、不改产品】；任何脚本都不得 import src/ 下的服务端代码。
 * @author   LingoBridge
 * @created  2026-07-19
 *
 * 依赖：仅 Node 内置模块 + @supabase/supabase-js（已在 package.json）。不引入新技术栈。
 */
import { readFileSync, statSync, mkdirSync, appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildQaAnonMetadata } from '../lib/qa-anon-auth.mjs'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const OUT_DIR = join(HERE, 'out')

// ─────────────────────────────────────────────────────────────
// 安全阀 1：音频硬限制（不可放宽 —— MAX_AUDIO_BYTES 是 10MB，
// 一个大文件单次 ASR 就能烧掉几块钱，故本地再压一道 300KB / 15 秒）
// ─────────────────────────────────────────────────────────────
export const MAX_AUDIO_BYTES_TEST = 300 * 1024
export const MAX_AUDIO_SECONDS_TEST = 15

/**
 * 测试音频硬检查：必须是 WAV、≤300KB、≤15 秒，任一不满足直接退出进程。
 * 只接受 WAV 是刻意的 —— WAV 能从文件头精确算出时长，webm/mp4 不解码算不出，
 * 「算不出时长」等于「时长闸形同虚设」，宁可拒跑。
 * @param path  音频文件绝对路径
 * @returns     { bytes, seconds, sampleRate, channels }
 */
export function assertTinyAudio(path) {
  let st
  try { st = statSync(path) } catch { fail(`测试音频不存在：${path}`) }
  if (!st.isFile()) fail(`测试音频不是文件：${path}`)
  if (st.size > MAX_AUDIO_BYTES_TEST) {
    fail(`测试音频 ${st.size} 字节 > 上限 ${MAX_AUDIO_BYTES_TEST} 字节（300KB）。拒绝运行，请换更短的样本。`)
  }
  const buf = readFileSync(path)
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    fail('测试音频必须是 WAV（RIFF/WAVE）—— 只有 WAV 能从文件头精确核算时长，其它格式一律拒跑。')
  }
  // 遍历 chunk 找 fmt 与 data，算精确时长
  let pos = 12, sampleRate = 0, channels = 0, bitsPerSample = 0, dataBytes = 0, byteRate = 0
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(pos + 10)
      sampleRate = buf.readUInt32LE(pos + 12)
      byteRate = buf.readUInt32LE(pos + 16)
      bitsPerSample = buf.readUInt16LE(pos + 22)
    } else if (id === 'data') {
      dataBytes = Math.min(size, buf.length - pos - 8)
    }
    pos += 8 + size + (size % 2)
  }
  const rate = byteRate || (sampleRate * channels * bitsPerSample) / 8
  if (!rate || !dataBytes) fail('WAV 头解析失败（缺 fmt/data chunk），无法核算时长 → 拒跑。')
  const seconds = dataBytes / rate
  if (seconds > MAX_AUDIO_SECONDS_TEST) {
    fail(`测试音频 ${seconds.toFixed(2)} 秒 > 上限 ${MAX_AUDIO_SECONDS_TEST} 秒。拒绝运行。`)
  }
  return { bytes: st.size, seconds, sampleRate, channels }
}

// ─────────────────────────────────────────────────────────────
// 安全阀 2：AI 调用计数上限（超出立即 process.exit，不是告警）
// ─────────────────────────────────────────────────────────────
export class AiBudget {
  /**
   * @param max        本次运行允许的 AI 调用【请求】次数上限
   * @param logger     日志函数
   */
  constructor(max, logger) {
    this.max = max
    this.used = 0
    this.log = logger
    this.byKind = {}
  }
  /** 每次即将发出会触发 AI 的请求前调用；超限硬停整个进程。 */
  spend(kind, n = 1) {
    this.used += n
    this.byKind[kind] = (this.byKind[kind] ?? 0) + n
    if (this.used > this.max) {
      this.log(`🛑 成本阀触发：AI 请求数 ${this.used} 超过 MAX_AI_CALLS=${this.max}，立即中止。`)
      this.log(`   分项：${JSON.stringify(this.byKind)}`)
      process.exit(2)
    }
    this.log(`   [成本阀] ${kind} → 累计 ${this.used}/${this.max}`)
  }
  summary() { return { used: this.used, max: this.max, byKind: this.byKind } }
}

// ─────────────────────────────────────────────────────────────
// 安全阀 3：花钱脚本必须获得授权才能跑，两条路径二选一
//
//   路径 A（默认）：TTY 交互确认 —— 人坐在终端前输确认词。
//   路径 B（2026-07-19 新增）：`--i-approved-cost=<金额上限>`
//        语义 = 「产品方已在上游批准了这个金额，脚本可非交互运行」。
//        这是安全阀的【改造】不是【拆除】—— 授权是「有额度上限的预批准」，
//        而不是「跳过检查」。三重约束缺一不可：
//          1) 交叉校验：脚本自算的预估费用 > 传入上限 → 直接 fail 拒绝启动（不是警告）
//          2) 累计账本：同一 --ledger 下多次运行【累加】计费，累计预估超上限同样拒跑。
//             没有这一条，「全套授权 ¥0.60」会被 4 次分档运行各花 ¥0.60 变成 ¥2.40。
//          3) 日志留痕：以授权方式运行时，在日志头部醒目记录授权额度与非交互事实
//        TTY 路径【保留】—— 不传 --i-approved-cost 时行为与改造前完全一致。
// ─────────────────────────────────────────────────────────────
const CONFIRM_WORD = '确认花钱'

/**
 * 读取/累加授权账本。账本记录同一授权额度下已预估花掉多少，实现跨进程累计封顶。
 * @param ledgerPath  账本文件绝对路径
 * @returns  已累计的预估费用（人民币）
 */
function readLedgerTotal(ledgerPath) {
  try {
    const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean)
    return lines.reduce((sum, l) => {
      try { return sum + Number(JSON.parse(l).est ?? 0) } catch { return sum }
    }, 0)
  } catch { return 0 }
}

/**
 * 打印预计调用次数与预估费用，取得授权后放行。
 * @param lines  费用明细行（数组，逐行打印）
 * @param est    预估总费用（人民币）
 * @param opts   { approved?: string|number, ledger?: string, tag?: string }
 *               approved — 来自 --i-approved-cost 的金额上限；缺省则走 TTY 交互
 *               ledger   — 累计账本名（同名账本共享同一额度池）
 *               tag      — 本次运行的标识，写进账本便于对账
 */
export async function confirmCost(lines, est, opts = {}) {
  console.log('\n──────── 本次运行将产生真实 AI 费用 ────────')
  for (const l of lines) console.log('  ' + l)
  console.log(`  本次预估费用：约 ¥${est.toFixed(4)}（估算，实际以 /dashboard 成本看板为准）`)

  const rawApproved = opts.approved
  if (rawApproved !== undefined && rawApproved !== null && rawApproved !== '' && rawApproved !== true) {
    const cap = Number(rawApproved)
    if (!Number.isFinite(cap) || cap <= 0) {
      fail(`--i-approved-cost 必须是正数金额（收到：${rawApproved}）。`)
    }
    const ledgerPath = join(OUT_DIR, `${opts.ledger ?? 'approved-cost'}.ledger.jsonl`)
    const prior = readLedgerTotal(ledgerPath)
    const cumulative = prior + est

    console.log('────────────────────────────────────────────')
    console.log(`  🔓 非交互授权运行：--i-approved-cost=${cap}`)
    console.log(`     账本：${ledgerPath}`)
    console.log(`     本额度已累计预估：¥${prior.toFixed(4)} ＋ 本次 ¥${est.toFixed(4)} ＝ ¥${cumulative.toFixed(4)} / 上限 ¥${cap.toFixed(4)}`)

    // 交叉校验（硬拒绝，不是警告）
    if (est > cap) {
      fail(`拒绝启动：本次预估 ¥${est.toFixed(4)} 已超过授权上限 ¥${cap.toFixed(4)}。未发出任何请求。`)
    }
    if (cumulative > cap) {
      fail(`拒绝启动：累计预估 ¥${cumulative.toFixed(4)}（含历史 ¥${prior.toFixed(4)}）超过授权上限 ¥${cap.toFixed(4)}。\n` +
           `若确需继续，应由产品方重新授权更高额度，而不是删账本。未发出任何请求。`)
    }

    mkdirSync(OUT_DIR, { recursive: true })
    appendFileSync(ledgerPath, JSON.stringify({
      ts: new Date().toISOString(), tag: opts.tag ?? '', est: Number(est.toFixed(6)), cap, cumulative: Number(cumulative.toFixed(6)),
    }) + '\n')
    console.log(`  ✅ 经 --i-approved-cost=${cap} 授权、非交互运行（已记入账本）`)
    console.log('────────────────────────────────────────────')
    return { mode: 'approved', cap, prior, cumulative }
  }

  console.log('────────────────────────────────────────────')
  if (!process.stdin.isTTY) {
    fail('非交互终端（无 TTY）→ 拒绝无人值守运行花钱脚本。\n' +
         '如已获产品方批准，请显式传 --i-approved-cost=<金额上限>（会与预估费用交叉校验并累计封顶）。')
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ans = await new Promise((res) => rl.question(`输入「${CONFIRM_WORD}」继续，其它任意键取消：`, res))
  rl.close()
  if (ans.trim() !== CONFIRM_WORD) fail('未确认，已取消。未发出任何请求。')
  return { mode: 'tty' }
}

// ─────────────────────────────────────────────────────────────
// 参数解析（每个脚本都必须显式传参，没有「跑全套」的默认行为）
// ─────────────────────────────────────────────────────────────
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1)
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i]
    else out[a.slice(2)] = true
  }
  return out
}

export function requireArg(args, name, usage) {
  const v = args[name]
  if (v === undefined || v === true || v === '') fail(`缺少必填参数 --${name}\n${usage}`)
  return String(v)
}

export function fail(msg) {
  console.error(`\n❌ ${msg}\n`)
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────
// 日志：所有输出带 ISO 时间戳；开跑/收工各打一条时间窗口，供成本对账
// ─────────────────────────────────────────────────────────────
export function makeLogger(layer) {
  mkdirSync(OUT_DIR, { recursive: true })
  const startedAt = new Date()
  const file = join(OUT_DIR, `${layer}-${startedAt.toISOString().replace(/[:.]/g, '-')}.log`)
  const write = (line) => {
    const s = `[${new Date().toISOString()}] ${line}`
    console.log(s)
    appendFileSync(file, s + '\n')
  }
  write(`════ ${layer} 开始 ════`)
  write(`测试时间窗口·起：${startedAt.toISOString()}（本地 ${startedAt.toLocaleString('zh-CN')}）`)
  return {
    log: write,
    file,
    startedAt,
    finish(extra = {}) {
      const endedAt = new Date()
      write(`测试时间窗口·止：${endedAt.toISOString()}（本地 ${endedAt.toLocaleString('zh-CN')}）`)
      write(`⏱ 对账用时间窗口：${startedAt.toISOString()} ~ ${endedAt.toISOString()}`)
      if (Object.keys(extra).length) write(`收尾信息：${JSON.stringify(extra)}`)
      write(`日志文件：${file}`)
      write(`════ ${layer} 结束 ════`)
      return { startedAt, endedAt }
    },
  }
}

// ─────────────────────────────────────────────────────────────
// GoTrue 登录 / 刷新（登录是客户端直连 Supabase Auth，不经本站 API）
// token 默认 1 小时过期，长跑脚本用 getToken() 自动续。
// ─────────────────────────────────────────────────────────────
export function makeAuth({ supabaseUrl, anonKey, log }) {
  let session = null
  let expiresAtMs = 0

  async function post(path, body) {
    const r = await fetch(`${supabaseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => ({}))
    return { status: r.status, body: j }
  }

  return {
    /** 邮箱密码登录，成功后缓存 session */
    async signIn(email, password) {
      const { status, body } = await post('/auth/v1/token?grant_type=password', { email, password })
      if (status !== 200 || !body.access_token) fail(`登录失败（${status}）：${body.error_description ?? body.msg ?? JSON.stringify(body)}`)
      session = body
      expiresAtMs = Date.now() + (body.expires_in ?? 3600) * 1000
      log(`登录成功：user=${body.user?.id} anonymous=${body.user?.is_anonymous ?? false}`)
      return body.access_token
    },
    /**
     * 匿名会话（用于测同意闸 / 匿名配额）
     * @param  scriptName  建号脚本名（必填），写进 user_metadata 供事后识别/清理，
     *                     同一脚本内多处建号要带段名区分（如 'l1-e2e:consent'）。
     *                     GoTrue 的 POST /auth/v1/signup 的 `data` 字段即 user_metadata，
     *                     与 supabase-js signInAnonymously({options:{data}}) 走同一个端点同一个字段。
     * @sideEffect         在 auth.users 里真建一个匿名账号（带标记，见 scripts/lib/qa-anon-auth.mjs）
     */
    async signInAnonymously(scriptName) {
      const { status, body } = await post('/auth/v1/signup', { data: buildQaAnonMetadata(scriptName) })
      if (status !== 200 || !body.access_token) fail(`匿名登录失败（${status}）：${JSON.stringify(body)}`)
      log(`匿名会话建立：user=${body.user?.id}`)
      return { token: body.access_token, userId: body.user?.id }
    },
    /** 注册（用于验白名单闸：非名单邮箱应被 DB 触发器挡下） */
    async signUp(email, password) {
      return post('/auth/v1/signup', { email, password })
    },
    /** 取当前 token，剩余不足 5 分钟自动 refresh */
    async getToken() {
      if (!session) fail('尚未登录')
      if (Date.now() > expiresAtMs - 5 * 60 * 1000 && session.refresh_token) {
        const { status, body } = await post('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
        if (status === 200 && body.access_token) {
          session = body
          expiresAtMs = Date.now() + (body.expires_in ?? 3600) * 1000
          log('token 已自动 refresh')
        } else log(`⚠️ token refresh 失败（${status}），继续用旧 token`)
      }
      return session.access_token
    },
    get userId() { return session?.user?.id ?? null },
  }
}

// ─────────────────────────────────────────────────────────────
// 请求与统计
// ─────────────────────────────────────────────────────────────
/** 发一个请求并计时；永不抛异常（网络错误也记成一条结果），便于并发统计。 */
export async function timedFetch(url, init = {}, timeoutMs = 90_000) {
  const t0 = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal })
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON（HTML 错误页等）保留原文 */ }
    return { ok: r.ok, status: r.status, ms: Date.now() - t0, json, text, headers: r.headers }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, json: null, text: String(e?.name === 'AbortError' ? 'TIMEOUT' : e), headers: new Headers() }
  } finally {
    clearTimeout(timer)
  }
}

export function stats(msList) {
  if (msList.length === 0) return { n: 0 }
  const a = [...msList].sort((x, y) => x - y)
  const p = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))]
  return {
    n: a.length,
    min: a[0],
    p50: p(0.5),
    p95: p(0.95),
    max: a[a.length - 1],
    avg: Math.round(a.reduce((s, v) => s + v, 0) / a.length),
  }
}

/** 断言器：只记录，不中断（一层跑完统一给结论）。返回 assert 与 report。 */
export function makeChecks(log, { failFast = false } = {}) {
  const results = []
  return {
    check(name, pass, detail = '') {
      results.push({ name, pass: !!pass, detail })
      log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
      // failFast：花钱的分段里，一步失败就立刻停，绝不带着已知故障继续往下烧钱。
      // 尤其防「前一跳挂了、后面 practice 三轮照跑」这种白烧。
      if (!pass && failFast) {
        log(`\n🛑 fail-fast：上述断言失败，立即中止，不再发出任何后续（可能花钱的）请求。`)
        log(`   已执行的检查：${results.length} 项，其中失败 ${results.filter((r) => !r.pass).length} 项。`)
        process.exit(1)
      }
      return !!pass
    },
    report() {
      const failed = results.filter((r) => !r.pass)
      log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
      if (failed.length) {
        log('未通过项：')
        for (const f of failed) log(`  ❌ ${f.name} — ${f.detail}`)
      }
      return { total: results.length, failed: failed.length, results }
    },
  }
}

/** 打印一张简单的等宽表格到日志 */
export function table(log, headers, rows) {
  const all = [headers, ...rows.map((r) => r.map(String))]
  const w = headers.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)))
  const line = (r) => '| ' + r.map((c, i) => String(c ?? '').padEnd(w[i])).join(' | ') + ' |'
  log(line(headers))
  log('|' + w.map((n) => '-'.repeat(n + 2)).join('|') + '|')
  for (const r of rows) log(line(r.map(String)))
}
