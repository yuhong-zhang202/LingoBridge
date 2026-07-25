#!/usr/bin/env node
/**
 * @module   stability/l1-e2e
 * @desc     【L1 端到端｜会花钱】主链路 + 白名单准入 + 同意闸 + 越权 + 配额 + 存档不重复计费 + 删号。
 *           三道安全阀齐备：MAX_AI_CALLS 硬停 / 音频 ≤15s ≤300KB 硬检查 / 交互确认。
 *
 * 用法（分段可选，默认只跑 core，没有「跑全套」）：
 *   node --env-file=.env.local scripts/stability/l1-e2e.mjs \
 *     --base-url https://<域名> --email <测试邮箱> --password <密码> \
 *     --audio ./scripts/stability/fixtures/tiny.wav \
 *     --parts core,archive,authz,consent,quota-anon \
 *     [--max-ai-calls 25] [--cleanup] [--allowlist-probe]
 *
 * 段说明：
 *   core        主链路：转写→整理→建语料→匹配→分析→词组→发音→练习3轮→润色（花钱）
 *   archive     匹配存档命中不重复计费（第二次 matching 必须 servedFrom=cache 且 0 AI）
 *   authz       越权：访问不属于自己的 corpusId → 403（不花钱）
 *   consent     同意闸：新匿名会话未签同意时 restructure/transcribe 必须 403（不花钱，闸在 AI 前）
 *   quota-anon  匿名 restructure 每日 5 次上限，第 6 次 402（花钱但极便宜，qwen-flash 短文本）
 *   cleanup     删号（--cleanup 独立开关，不在 parts 里）
 *
 * 环境变量（只读变量名，脚本内不打印任何值）：
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
import { parseArgs, requireArg, makeLogger, makeChecks, timedFetch, assertTinyAudio, AiBudget, confirmCost, fail, table, makeAuth } from './_lib.mjs'
import { readFileSync } from 'node:fs'

const USAGE = `见文件头注释：--base-url --email --password --audio 必填`
const args = parseArgs()
const BASE = requireArg(args, 'base-url', USAGE).replace(/\/$/, '')
// 凭据优先取环境变量（QA_TEST_EMAIL / QA_TEST_PASSWORD），命令行参数只作兜底。
// 这样密码不会出现在 shell 历史与 ps 进程列表里；且避免 .env.local 里带引号/含 # 的值被 shell 拼错。
const EMAIL = process.env.QA_TEST_EMAIL || requireArg(args, 'email', USAGE)
const PASSWORD = process.env.QA_TEST_PASSWORD || requireArg(args, 'password', USAGE)
const AUDIO = requireArg(args, 'audio', USAGE)
const PARTS = String(args.parts ?? 'core').split(',').map((s) => s.trim()).filter(Boolean)
const MAX_AI_CALLS = Number(args['max-ai-calls'] ?? 25)
const DO_CLEANUP = args.cleanup === true || args.cleanup === 'true'
const DO_ALLOWLIST_PROBE = args['allowlist-probe'] === true || args['allowlist-probe'] === 'true'

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
if (!SUPABASE_URL || !ANON_KEY) fail('缺少 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY，请用 node --env-file=.env.local 运行。')
// 允许传 0：跑纯零成本段时把预算钉死为 0，任何一次 spend() 都会立刻 exit(2)——比「相信自己读对了代码」更硬。
if (!Number.isFinite(MAX_AI_CALLS) || MAX_AI_CALLS < 0 || MAX_AI_CALLS > 40) fail('--max-ai-calls 必须是 0..40 的数字（上限 40 是本层的硬天花板）。')

// ── 安全阀 2：音频硬检查（先于任何网络请求）─────────────────
const audioInfo = assertTinyAudio(AUDIO)

const { log, finish } = makeLogger('L1-e2e')
log(`目标：${BASE}`)
log(`测试音频：${AUDIO} — ${audioInfo.bytes} 字节 / ${audioInfo.seconds.toFixed(2)} 秒 / ${audioInfo.sampleRate}Hz ×${audioInfo.channels}（已通过 ≤300KB & ≤15s 硬检查）`)
log(`分段：${PARTS.join(',')}${DO_CLEANUP ? ' + cleanup' : ''}`)

// ── 安全阀 1 的预算表（单价依据 src/lib/api-logger.ts 的 API_PRICING）──
const P = { asr_per_s: 0.003, flash_per_1k: 0.0008, plus_in_per_1m: 0.8, plus_out_per_1m: 2.0 }
const plus = (inTok, outTok) => (inTok / 1e6) * P.plus_in_per_1m + (outTok / 1e6) * P.plus_out_per_1m
const estLines = []
let est = 0
if (PARTS.includes('core')) {
  const asr = audioInfo.seconds * P.asr_per_s
  const restructure = (600 / 1000) * P.flash_per_1k
  const matching = plus(2500, 150) + plus(9000, 900)      // 萃取 + 重排（重排 prompt 含全部候选题干）
  const analysis = plus(2500, 600), phrases = plus(2500, 600), pronounce = plus(1200, 400), polish = plus(1200, 400)
  const practice = 3 * (plus(3000, 500) * 2)              // 每轮最多 2 次 qwen-plus（脚手架分析 + 教练回复）
  const sub = asr + restructure + matching + analysis + phrases + pronounce + polish + practice
  est += sub
  estLines.push(`core：ASR 1 次（${audioInfo.seconds.toFixed(1)}s）≈¥${asr.toFixed(4)}；qwen 文本 ~11 次 ≈¥${(sub - asr).toFixed(4)}`)
}
if (PARTS.includes('archive')) estLines.push('archive：1 次 matching（预期读档命中，0 次模型调用）≈¥0')
if (PARTS.includes('authz')) estLines.push('authz：0 次 AI（403 在 AI 之前）≈¥0')
if (PARTS.includes('consent')) estLines.push('consent：0 次 AI（同意闸在 AI 之前）≈¥0')
if (PARTS.includes('quota-anon')) {
  const sub = 5 * (300 / 1000) * P.flash_per_1k
  est += sub
  estLines.push(`quota-anon：qwen-flash 5 次短文本 ≈¥${sub.toFixed(4)}（第 6 次预期 402、不产生费用）`)
}
estLines.push(`成本阀 MAX_AI_CALLS=${MAX_AI_CALLS}（超出立即 exit(2)）`)

// ── 安全阀 2.5：方法契约预检（零成本、无 token，早于任何花钱与人工确认）──────
// 为什么要有这一道：台账 120 记的同型事故已第三次 —— 产品把 analysis/phrases 从 GET 改成 POST
// （0ab7e60），脚本没跟上。照旧脚本跑，会在【花掉 ASR + matching 的钱之后】才在 analysis 这跳拿 405 挂掉。
// 契约不符必须在花第一分钱之前暴露，所以这一段放在 confirmCost 之前。
//
// 判据用 A/B 对照，而不是单看「有没有被拒」：
//   正确方法 + 无 token → 401：证明该方法存在，且请求走到了鉴权层（≠ 被路由层拒）
//   错误方法 + 无 token → 405：证明旧方法确实已下线
// 只看 401 不够：路由整个坏掉/被删也可能给出非 200；只看 405 也不够：那区分不出「方法错」和「路由没了」。
// 全程不带 token、不带有效 questionId，鉴权在一切业务逻辑之前 → 0 次 AI 调用、0 元、不消耗任何额度。
async function preflightMethodContract() {
  const CONTRACT = [
    { path: '/api/analysis', method: 'POST', legacy: 'GET', body: { questionId: 'preflight' } },
    { path: '/api/analysis/phrases', method: 'POST', legacy: 'GET', body: { questionId: 'preflight' } },
  ]
  log('\n── 方法契约预检（无 token / 零成本 / 早于花钱确认）──')
  const bad = []
  for (const c of CONTRACT) {
    const good = await timedFetch(`${BASE}${c.path}`, {
      method: c.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(c.body),
    }, 20_000)
    const legacy = await timedFetch(`${BASE}${c.path}`, { method: c.legacy }, 20_000)
    log(`   ${c.method} ${c.path} → ${good.status}（期望 401）｜ ${c.legacy} → ${legacy.status}（期望 405）`)
    if (good.status === 405) {
      bad.push(`${c.method} ${c.path} 拿到 405 —— 产品已不接受 ${c.method}，脚本契约过期。请重读 src/app${c.path}/route.ts 的 export。`)
    } else if (good.status !== 401) {
      bad.push(`${c.method} ${c.path} 拿到 ${good.status}，期望 401 —— 可能是路由异常或鉴权闸失效，两种都不该继续花钱。`)
    }
    if (legacy.status !== 405) {
      bad.push(`${c.legacy} ${c.path} 拿到 ${legacy.status}，期望 405 —— 旧方法可能仍可达（会被浏览器预取/爬虫无意触发烧钱）。`)
    }
  }
  if (bad.length) {
    log('')
    bad.forEach((b) => log(`🔴 ${b}`))
    fail('方法契约预检未通过 —— 已在花掉任何 AI 费用之前中止。上面每条都要先核对路由源码再重跑。')
  }
  log('   ✅ 契约一致（正确方法走到鉴权、旧方法已被路由层拒绝）')
}
// core / authz 两段都要打 analysis，跑它们之前必须先过契约预检。
if (PARTS.includes('core') || PARTS.includes('authz')) await preflightMethodContract()

// ── 安全阀 3：交互确认 ────────────────────────────────────────
// 只有【会花钱的段】才要求人工确认；纯零成本段（authz/consent/archive）免确认，以便无 TTY 环境跑。
// 判定不看 est 数值（浮点 0 不可靠），而是白名单式看「有没有选中会调 AI 的段」——宁可多问一次，不可少问一次。
const SPENDING_PARTS = ['core', 'quota-anon']
const willSpend = PARTS.some((p) => SPENDING_PARTS.includes(p))
if (willSpend) {
  // ⚠️ 必须把 --i-approved-cost 透传给 confirmCost —— 漏传会让该授权参数被静默忽略、
  // 本层永远只能交互式运行（L3 一直是对的，L1 此前漏了）。ledger 分账本记，避免与 L3 额度互串。
  // --ledger 可指定账本池名（缺省 'l1-e2e'）。每一轮新授权应开新池：额度是「本轮新预算」，
  // 与上一轮的已花额度不共享；沿用旧池会把历史累计算进来、导致新授权被误判超额而拒跑。
  // 注意：这不是绕过封顶——新池仍受本次 --i-approved-cost 全额约束，且旧池记录一条不删。
  await confirmCost(estLines, est, { approved: args['i-approved-cost'], ledger: String(args.ledger ?? 'l1-e2e'), tag: PARTS.join(',') })
} else {
  console.log(`\n本次分段（${PARTS.join(',')}）不含任何会调用 AI 的段 → 预估 ¥0，跳过花钱确认。`)
  console.log('（依据：各路由的 consent 闸与 assertCorpusOwner 均在 bumpDailyUsage 与模型调用之前）\n')
}

const budget = new AiBudget(MAX_AI_CALLS, log)
// --fail-fast：一步失败即中止（花钱分段强烈建议开）。默认关，保持零成本段「一次跑完看全貌」的行为。
const FAIL_FAST = args['fail-fast'] === true || args['fail-fast'] === 'true'
if (FAIL_FAST) log('fail-fast：已开启 —— 任一断言失败立即 exit(1)，不再发出后续请求。')
const { check, report } = makeChecks(log, { failFast: FAIL_FAST })
const auth = makeAuth({ supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, log })
const timings = []

/** 带 token 调本站 API */
async function api(path, { method = 'POST', body, token, isForm = false, aiKind = null, timeout = 90_000 } = {}) {
  if (aiKind) budget.spend(aiKind)
  const headers = { authorization: `Bearer ${token}` }
  let payload = body
  if (!isForm && body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  const r = await timedFetch(`${BASE}${path}`, { method, headers, body: payload }, timeout)
  timings.push([path, r.status, `${r.ms}ms`])
  log(`   → ${method} ${path} ${r.status} ${r.ms}ms`)
  return r
}

/** 读 /dashboard 汇总花费（用作「存档命中不重复计费」的证据；需测试账号是 ADMIN_EMAILS 之一，否则跳过）*/
async function readCost(token) {
  const r = await timedFetch(`${BASE}/api/dashboard`, { headers: { authorization: `Bearer ${token}` } }, 30_000)
  if (r.status !== 200) return null
  return r.json
}

await auth.signIn(EMAIL, PASSWORD)
let token = await auth.getToken()

// 同意记录（幂等：多签一条无害），后续所有 AI 接口都依赖它
const consentRes = await api('/api/consent', { body: {}, token })
check('POST /api/consent 成功（同意记录已落库）', consentRes.status === 200, `status=${consentRes.status}`)

let corpusId = null
let firstMatch = null

// ══════════════ core：主链路 ══════════════
if (PARTS.includes('core')) {
  // 1) 转写（唯一一次 ASR）
  const form = new FormData()
  form.append('audio', new Blob([readFileSync(AUDIO)], { type: 'audio/wav' }), 'tiny.wav')
  const tr = await api('/api/transcribe', { body: form, token, isForm: true, aiKind: 'transcribe(ASR)', timeout: 120_000 })
  check('转写 200 且返回 text', tr.status === 200 && typeof tr.json?.text === 'string', `status=${tr.status} text=${String(tr.json?.text).slice(0, 60)}`)

  // 2) 整理（qwen-flash）。用固定短文本，不用转写结果——转写内容不可控，短文本可复现且省钱。
  const RAW = '上周末我和朋友去了城郊的一个小湖，我们租了一条船在湖上划了大概一个小时。天气很好，风也不大，我第一次自己掌舵，一开始有点紧张，后来慢慢就习惯了。回来的路上我们在湖边的小店吃了面。'
  const rs = await api('/api/restructure', { body: { rawText: RAW }, token, aiKind: 'restructure(qwen-flash)' })
  check('整理 200 且返回 cleanedText', rs.status === 200 && typeof rs.json?.cleanedText === 'string', `status=${rs.status}`)
  const cleaned = rs.json?.cleanedText ?? RAW

  // 3) 建语料（不花钱）
  const cp = await api('/api/corpus', { body: { source: 'text', rawText: RAW }, token })
  check('建语料 200 且返回 corpus.id', cp.status === 200 && !!cp.json?.corpus?.id, `status=${cp.status}`)
  corpusId = cp.json?.corpus?.id ?? null

  // 4) 写回 cleaned_text —— ⚠️ 这一步产品里走【客户端 RLS 直连】(updateCorpusCleaned)，本站 API 没有对应端点。
  //    /api/matching 读的是 cleaned_text，不写这步匹配必然 400。故脚本用用户 token 直连 PostgREST，模拟浏览器。
  if (corpusId) {
    const up = await timedFetch(`${SUPABASE_URL}/rest/v1/corpus?id=eq.${corpusId}`, {
      method: 'PATCH',
      headers: { apikey: ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ cleaned_text: cleaned, status: 'restructured' }),
    }, 30_000)
    check('cleaned_text 写回成功（客户端 RLS 路径）', up.status === 200 && Array.isArray(up.json) && up.json.length === 1, `status=${up.status}`)
  }

  // 5) 匹配（内部 2 次 qwen-plus）
  if (corpusId) {
    const m = await api('/api/matching', { body: { corpusId }, token, aiKind: 'matching(qwen-plus×2)', timeout: 120_000 })
    budget.spend('matching(第2次qwen-plus)') // 一个请求两次模型调用，成本阀按模型调用数计
    check('匹配 200', m.status === 200, `status=${m.status}`)
    check('首次匹配 servedFrom=fresh', m.json?.servedFrom === 'fresh', `servedFrom=${m.json?.servedFrom}`)
    check('匹配返回题目数组', Array.isArray(m.json?.questions), `n=${m.json?.questions?.length}`)
    firstMatch = m.json
  }

  const qid = firstMatch?.questions?.[0]?.id ?? null
  check('匹配至少产出 1 道题（后续分析/词组依赖它）', !!qid, `questionId=${qid}`)

  if (qid && corpusId) {
    // ⚠️ 契约以路由源码为准（2026-07-20 复核 commit 0ab7e60 后的实现，逐字段核对）：
    //   两者都是 POST + JSON body（此前是 GET + query，产品方因「GET 会被预取/爬虫无意触发烧钱」改掉）。
    //   字段：questionId（必填，缺则 400）、storyId（可选，参数名不是 corpusId）、story（正文兜底）、
    //   phrases 另收 level —— 雅思分数档字符串，路由内 `str(body.level) || '6.0'`，不是 CEFR 的 'B2'。
    const an = await api('/api/analysis',
      { body: { questionId: qid, storyId: corpusId }, token, aiKind: 'analysis(qwen-plus)' })
    check('侧重点分析 200', an.status === 200, `status=${an.status} body=${an.text.slice(0, 120)}`)

    const ph = await api('/api/analysis/phrases',
      { body: { questionId: qid, storyId: corpusId, level: '6.0' }, token, aiKind: 'phrases(qwen-plus)' })
    check('换词组 200', ph.status === 200, `status=${ph.status} body=${ph.text.slice(0, 120)}`)
  }

  const pr = await api('/api/pronounce', { body: { intended: 'thought', heard: 'taught' }, token, aiKind: 'pronounce(qwen-plus)' })
  check('发音提示 200', pr.status === 200, `status=${pr.status}`)

  // 练习 3 轮：每轮内部最多 2 次 qwen-plus（脚手架分析 + 教练回复）
  const msgs = []
  for (let i = 1; i <= 3; i++) {
    msgs.push({ role: 'user', content: `This is my practice answer number ${i}. I went to a lake with my friend last weekend.` })
    const p = await api('/api/practice', { body: { messages: msgs, storyId: corpusId, questionId: firstMatch?.questions?.[0]?.id }, token, aiKind: `practice轮${i}(qwen-plus×≤2)`, timeout: 120_000 })
    budget.spend(`practice轮${i}(第2次qwen-plus)`)
    check(`练习第 ${i} 轮 200`, p.status === 200, `status=${p.status} body=${p.text.slice(0, 120)}`)
    const reply = p.json?.reply ?? p.json?.message ?? ''
    if (reply) msgs.push({ role: 'assistant', content: String(reply) })
  }

  const po = await api('/api/practice/polish', { body: { sentence: 'I very like the lake because it is very beautiful.' }, token, aiKind: 'polish(qwen-plus)' })
  check('润色 200', po.status === 200, `status=${po.status}`)
}

// ══════════════ archive：存档命中不重复计费 ══════════════
if (PARTS.includes('archive')) {
  if (!corpusId) {
    log('⚠️ archive 段需要 core 段产生的 corpusId；本次未跑 core → 该段【未验证】，可用 --corpus-id 传入已有语料后重跑。')
    check('存档命中不重复计费', false, '未验证：缺 corpusId（非失败，是没测到）')
  } else {
    // core 段刚打完一批 usage 日志，写入可能略滞后于 HTTP 响应。
    // 先静置再取 before 快照，否则「迟到的 core 日志」会被算进读档的增量里，造成假 🔴。
    log('   …静置 8s，等 core 段的 api_usage_logs 落库，再取成本基线')
    await new Promise((r) => setTimeout(r, 8000))
    const before = await readCost(token)
    const m2 = await api('/api/matching', { body: { corpusId }, token, timeout: 60_000 }) // 刻意不 spend：预期 0 次模型调用
    check('二次匹配 200', m2.status === 200, `status=${m2.status}`)
    check('二次匹配 servedFrom=cache（读档命中）', m2.json?.servedFrom === 'cache', `servedFrom=${m2.json?.servedFrom}`)
    const sameCount = JSON.stringify(m2.json?.questions?.map((q) => q.id)) === JSON.stringify(firstMatch?.questions?.map((q) => q.id))
    check('读档结果与首次完全一致（冻结生效）', sameCount, '题目 id 序列比对')
    log('   …二次匹配后再静置 8s，给「万一真的调了模型」的日志留出落库时间（否则零增量可能是假象）')
    await new Promise((r) => setTimeout(r, 8000))
    const after = await readCost(token)
    if (before && after) {
      // 主证据用「调用条数」而非金额：金额经 r2 四舍五入，一次极便宜的调用可能显示为 0 增量；
      // allTimeCalls 是 api_usage_logs 的原始行数，多一次模型调用必然 +1，藏不住。
      const dCalls = after.allTimeCalls - before.allTimeCalls
      const dCost = Number((after.allTimeCost - before.allTimeCost).toFixed(4))
      log(`   成本快照 before：calls=${before.allTimeCalls} cost=¥${before.allTimeCost} today=¥${before.todayCost}/${before.todayCalls}次`)
      log(`   成本快照 after ：calls=${after.allTimeCalls} cost=¥${after.allTimeCost} today=¥${after.todayCost}/${after.todayCalls}次`)
      log(`   增量：调用 +${dCalls} 条，费用 +¥${dCost}`)
      check('读档命中未新增 AI 调用（api_usage_logs 行数零增长）', dCalls === 0, `Δcalls=${dCalls}（>0 即 🔴 读档仍在调模型）`)
      check('读档命中未新增费用（累计花费零增长）', dCost === 0, `Δcost=¥${dCost}`)
      const b = JSON.stringify(before), a = JSON.stringify(after)
      if (b !== a) log('   ⚠️ 看板整体快照有差异但调用数/费用无增量 —— 多为并发窗口内其他统计字段抖动，非计费问题。')
    } else {
      log('⚠️ /api/dashboard 非 200（测试账号不在 ADMIN_EMAILS？）→ 「读档不计费」只由 servedFrom=cache 间接佐证，【未用成本看板实证】。')
      check('读档命中未新增费用（看板实证）', false, '未验证：dashboard 不可读')
    }
  }
}

// ══════════════ authz：越权 ══════════════
if (PARTS.includes('authz')) {
  const FAKE = '00000000-0000-0000-0000-000000000000'
  // ⚠️ 接口契约以路由源码为准（2026-07-20 复核，commit 0ab7e60 后）：
  //   /api/matching         POST，JSON body { corpusId }
  //   /api/analysis         POST，JSON body { questionId, storyId? }        ← 参数名是 storyId，不是 corpusId
  //   /api/analysis/phrases POST，JSON body { questionId, storyId?, level? } ← level 默认 '6.0'
  // 三者的 assertCorpusOwner 都在 bumpDailyUsage 与任何模型调用之前 → 本段 0 次 AI、且不消耗每日额度。
  const r1 = await api('/api/matching', { body: { corpusId: FAKE }, token })
  check('越权 POST /api/matching → 403（不得 200/500）', r1.status === 403, `status=${r1.status} body=${r1.text.slice(0, 120)}`)
  for (const path of ['/api/analysis', '/api/analysis/phrases']) {
    const r = await api(path, { body: { questionId: 'qa-authz-probe', storyId: FAKE }, token })
    // 405 单列：它意味着方法契约又漂了，此时「非 200」是路由层拒的，不能算越权防护通过。
    check(`越权 POST ${path} → 403（不得 200/500/405）`, r.status === 403, `status=${r.status} body=${r.text.slice(0, 120)}`)
  }
}

// ══════════════ consent：同意闸 ══════════════
if (PARTS.includes('consent')) {
  const anon = await auth.signInAnonymously()
  // 新匿名会话没有 consent_records → 所有 AI 出口必须 403 CONSENT_REQUIRED，且不产生任何 AI 费用
  const r1 = await timedFetch(`${BASE}/api/restructure`, {
    method: 'POST', headers: { authorization: `Bearer ${anon.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ rawText: '一段用于验证同意闸的短文本。' }),
  }, 30_000)
  check('未同意匿名会话 → /api/restructure 403', r1.status === 403, `status=${r1.status}`)
  check('403 带 code=CONSENT_REQUIRED', r1.json?.code === 'CONSENT_REQUIRED', `code=${r1.json?.code}`)

  const form = new FormData()
  form.append('audio', new Blob([readFileSync(AUDIO)], { type: 'audio/wav' }), 'tiny.wav')
  const r2 = await timedFetch(`${BASE}/api/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${anon.token}` }, body: form }, 30_000)
  check('未同意匿名会话 → /api/transcribe 403（录音未外发）', r2.status === 403, `status=${r2.status}`)

  const r3 = await timedFetch(`${BASE}/api/corpus`, {
    method: 'POST', headers: { authorization: `Bearer ${anon.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ rawText: 'x' }),
  }, 30_000)
  check('未同意匿名会话 → /api/corpus 403', r3.status === 403, `status=${r3.status}`)
}

// ══════════════ quota-anon：匿名 restructure 每日上限 ══════════════
if (PARTS.includes('quota-anon')) {
  const anon = await auth.signInAnonymously()
  const c = await timedFetch(`${BASE}/api/consent`, { method: 'POST', headers: { authorization: `Bearer ${anon.token}`, 'content-type': 'application/json' }, body: '{}' }, 30_000)
  check('匿名可签同意', c.status === 200, `status=${c.status}`)
  const seen = []
  for (let i = 1; i <= 6; i++) {
    if (i <= 5) budget.spend(`anon restructure #${i}(qwen-flash)`)
    const r = await timedFetch(`${BASE}/api/restructure`, {
      method: 'POST', headers: { authorization: `Bearer ${anon.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: `匿名配额测试第 ${i} 次，这是一段很短的中文文本。` }),
    }, 60_000)
    seen.push([i, r.status, r.json?.code ?? ''])
    log(`   匿名整理 #${i} → ${r.status} ${r.json?.code ?? ''}`)
    if (r.status === 402) break
  }
  table(log, ['第几次', 'status', 'code'], seen)
  const last = seen[seen.length - 1]
  check('匿名 restructure 第 6 次触发 402 QUOTA_EXCEEDED（ANON_RESTRUCTURE_LIMIT=5）',
    last[0] === 6 && last[1] === 402 && last[2] === 'QUOTA_EXCEEDED', `实际：第 ${last[0]} 次 ${last[1]} ${last[2]}`)
}

// ══════════════ allowlist-probe：白名单准入 ══════════════
if (DO_ALLOWLIST_PROBE) {
  const probe = `qa-probe-${Date.now()}@example.com`
  const r = await auth.signUp(probe, `Aa1!${Date.now()}`)
  check('非白名单邮箱注册被拒（DB 触发器 enforce_beta_allowlist_trg）', r.status >= 400, `status=${r.status} body=${JSON.stringify(r.body).slice(0, 160)}`)
  if (r.status < 400) log('🔴 白名单闸未挡住新注册 —— 请立刻人工确认 beta_allowlist 表内容与触发器是否存在，并把该账号删掉。')
}

// ══════════════ cleanup：删号 ══════════════
if (DO_CLEANUP) {
  token = await auth.getToken()
  const d = await api('/api/account/delete', { body: {}, token })
  check('删号 200', d.status === 200 && d.json?.ok === true, `status=${d.status}`)
  log('⚠️ 提醒：api_usage_logs 只做去标识化、行会保留 → 本次测试费用会永久留在成本看板。请按下方时间窗口登记对账。')
  log('⚠️ 提醒：删号不会把邮箱从 beta_allowlist 移除，需手工在 Supabase 删该行。')
  log('⚠️ 提醒：consent / quota 段建的匿名会话未删号，需按时间窗口用 SQL 清理（auth.users 中 is_anonymous=true 且 created_at 落在窗口内）。')
}

log('')
table(log, ['请求', 'status', '耗时'], timings)
const rep = report()
log(`AI 调用计数：${JSON.stringify(budget.summary())}`)
finish({ layer: 'L1', ai_calls: budget.used, estimated_cost_cny: Number(est.toFixed(4)), failed: rep.failed, cleaned_up: DO_CLEANUP })
process.exit(rep.failed > 0 ? 1 : 0)
