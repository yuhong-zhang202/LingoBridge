#!/usr/bin/env node
/**
 * @module   stability/probe-health-poller
 * @desc     【只读·不花钱】在 L3 并发压测期间持续轮询 /api/version，
 *           用于区分「Zeabur 网关超时」与「应用进程真挂了」：
 *             - 轮询全程 200 且延迟连续      → 进程活着 → 502/504 大概率是网关超时
 *             - 轮询出现连续失败后恢复       → 进程重启过 → 真崩溃/OOM 嫌疑
 *           不触发任何 AI 调用，不写任何业务数据。
 *
 * 用法：node scripts/stability/probe-health-poller.mjs --base-url <url> --seconds 90 [--interval 1000]
 */
import { parseArgs, requireArg } from './_lib.mjs'

const args = parseArgs()
const BASE = requireArg(args, 'base-url', '--base-url 必填').replace(/\/$/, '')
const SECONDS = Number(args.seconds ?? 90)
const INTERVAL = Number(args.interval ?? 1000)

const samples = []
const t0 = Date.now()
while (Date.now() - t0 < SECONDS * 1000) {
  const s = Date.now()
  let status = 0
  try {
    const ac = new AbortController()
    const to = setTimeout(() => ac.abort(), 10_000)
    const r = await fetch(`${BASE}/api/version`, { signal: ac.signal, cache: 'no-store' })
    clearTimeout(to)
    status = r.status
    await r.text()
  } catch { status = 0 }
  const ms = Date.now() - s
  samples.push({ t: new Date().toISOString(), offsetMs: s - t0, status, ms })
  console.log(`[poll +${String(s - t0).padStart(6)}ms] ${status} ${ms}ms`)
  const sleep = INTERVAL - (Date.now() - s)
  if (sleep > 0) await new Promise((r) => setTimeout(r, sleep))
}

const ok = samples.filter((x) => x.status === 200)
const bad = samples.filter((x) => x.status !== 200)
const lat = ok.map((x) => x.ms).sort((a, b) => a - b)
console.log('\n──── 健康轮询汇总 ────')
console.log(`样本 ${samples.length}｜200 ${ok.length}｜非200 ${bad.length}`)
if (lat.length) {
  console.log(`/api/version 延迟 P50=${lat[Math.floor(lat.length * 0.5)]}ms P95=${lat[Math.floor(lat.length * 0.95)]}ms max=${lat[lat.length - 1]}ms`)
}
if (bad.length) console.log(`非200 明细：${JSON.stringify(bad)}`)
console.log(`连续可用性：${bad.length === 0 ? '全程无中断（进程未重启）' : '出现中断 → 需人工看 Zeabur 面板确认是否重启'}`)
