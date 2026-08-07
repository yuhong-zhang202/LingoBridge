/**
 * backfill-note-segments —— 一次性批量：把老格式（单段话）的收藏卡 note 用 AI 重生成为
 * 【两段式（语法 / 词组）】契约格式，与前端 PolishNote 解析器一致。
 *
 * 背景：saved_phrases 里早期收藏的卡，note 是一整段自然语言说明（如「修正了重复词、单复数…」），
 * 没有「语法」「词组」段标记，前端两段式渲染吃不下、只能整段兜底展示。本脚本给这批老卡
 * 按每卡的 original→optimized 真实差异，重新生成两段式 note。
 *
 * 安全护栏（务必遵守）：
 * · 默认 dry-run —— 只把 {id, original, optimized, 旧note, 新note, status} 落到
 *   scripts/data/backfill-notes-dryrun.json 供人审阅，【绝不写库】。
 * · 仅当带 --commit 才 UPDATE saved_phrases.note，且只更新本轮成功生成的条目；commit 前打印将更新条数。
 * · 幂等：只处理「仍是老格式」的卡（note 非空、且 parseNote 解析不出两段契约）。已是两段式的卡跳过。
 * · 容错：单条 LLM 失败 / 生成结果不合契约 → 标 needs-manual、跳过、不中断整批、不写坏数据。
 *
 * 忠实原则：prompt 只让模型解释【这次真实发生】的 original→optimized 差异，原句没有的错误绝不硬安。
 *
 * 用法：
 *   dry-run（默认，安全）：node --env-file=.env.local scripts/data/backfill-note-segments.mjs
 *   写库（人审后再跑）：    node --env-file=.env.local scripts/data/backfill-note-segments.mjs --commit
 *
 * 依赖环境变量：SUPABASE_DB_URL / DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL（同产品运行时，见 .env.local）。
 *
 * 注意：本脚本自包含（直连 pg + fetch 调 DashScope OpenAI 兼容端点），不 import 任何产品代码——
 * src/lib/llm.ts 带 'server-only' 且走 @/ 路径别名，.mjs 无法直接引用；下方 parseNoteContract
 * 是 src/lib/polish-note.ts parseNote 判定逻辑的镜像，仅用于「是否解析出两段」的合法性校验。
 */
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_FILE = join(__dirname, 'backfill-notes-dryrun.json')
const MODEL = 'qwen-plus' // 对齐 src/lib/constants.ts 的 MODEL_PRACTICE
const MAX_ATTEMPTS = 2

// —— 契约判定（镜像 src/lib/polish-note.ts）：判断一段 note 是否为两段式契约 —— //
const GRAMMAR_HEADS = new Set(['语法', '语法：', '语法:'])
const PHRASE_HEADS = new Set(['词组', '词组：', '词组:', '词组表达优化', '表达'])

/**
 * 把 note 解析为两段结构；不合契约（无任何段头 / 解析后两段皆空）返回 null。
 * @param {string} note  待判定的 note 字符串
 * @returns {{grammar: string[], phrase: string[]} | null}
 */
function parseNoteContract(note) {
  if (typeof note !== 'string') return null
  const lines = note.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const hasHead = lines.some((l) => GRAMMAR_HEADS.has(l) || PHRASE_HEADS.has(l))
  if (!hasHead) return null
  const grammar = []
  const phrase = []
  let current = null
  for (const line of lines) {
    if (GRAMMAR_HEADS.has(line)) { current = 'grammar'; continue }
    if (PHRASE_HEADS.has(line)) { current = 'phrase'; continue }
    if (current === null) continue
    ;(current === 'grammar' ? grammar : phrase).push(line)
  }
  if (grammar.length === 0 && phrase.length === 0) return null
  return { grammar, phrase }
}

/**
 * 对已合契约的 note 再做语义 lint，拦截契约明令禁止、但契约「能否解析出两段」判定漏过的坏账：
 * · X→X 空账（原片段==改法，契约白纸黑字「绝不写 X → X」）；
 * · 占位符伪改法（改法是 (removed) / removed / 删除 之类、并非 optimized 里真实出现的词）。
 * 命中即判本条需人工（不静默写坏数据）。错贴语法类型这类语义问题无法可靠机械识别，留给人审。
 * @param {string} note  已过 parseNoteContract 的 note
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function lintNote(note) {
  const PLACEHOLDER = /^[（(]?\s*(removed|remove|删除|删去|无|n\/?a)\s*[)）.]*$/i
  const parsed = parseNoteContract(note)
  if (parsed === null) return { ok: false, reason: '不合两段式契约' }
  const check = (line, isGrammar) => {
    const idx = line.search(/→|->/)
    if (idx < 0) return null // 无箭头行由契约解析兜底，不在此拦
    const arrowLen = line[idx] === '→' ? 1 : 2
    let left = line.slice(0, idx).trim()
    const right = line.slice(idx + arrowLen).trim()
    if (isGrammar) {
      const c = left.search(/：|:/) // 语法段去掉「类型：」前缀再比原片段
      if (c >= 0) left = left.slice(c + 1).trim()
    }
    if (left.length > 0 && left === right) return `X→X 空账（${left} → ${right}）`
    if (PLACEHOLDER.test(right)) return `改法为占位符、非真实改写（… → ${right}）`
    return null
  }
  for (const line of parsed.grammar) { const r = check(line, true); if (r) return { ok: false, reason: r } }
  for (const line of parsed.phrase) { const r = check(line, false); if (r) return { ok: false, reason: r } }
  return { ok: true }
}

// —— LLM 提示词：给定 original + optimized，只解释真实发生的改动，输出两段式契约 note —— //
const SYSTEM = `你是英语口语表达优化说明生成器。用户会给你一句原句(original)和它的优化句(optimized)。这两句都已给定，你【不需要】再优化，只需对照两句，用中文写一份说明，列出这次【真实发生】的改动。

严格输出 JSON（不要 markdown、不要解释、前后不得有任何多余文字）：
{ "note": "按下方契约格式组织的中文说明" }

【note 契约格式 —— 务必照此结构】
note 是【单个字符串】，内部用换行把内容组织成最多两段（JSON 里换行写成 \\n）。两段都是【可选】，有内容才写：
- 语法段：先单独一行短标记「语法」，其后每行一条，格式 \`类型：原片段 → 改法\`。类型是 2-4 字中文类别（时态 / 单复数 / 主谓一致 / 冠词 / 介词 / 搭配 …）；【同一类的多处错误合并成一行】，一类只占一行。
- 词组段：先单独一行短标记「词组」，其后每行一条，格式 \`原片段 → 改法\`（无类型前缀），一个表达一行。

【硬规则】
- 只写【真实发生】的改动：原片段=original 里真实出现的词、改法=optimized 里真实出现的词。某个词在 optimized 里没变，就绝不写「X → X」这种空账。
- 【绝不编造】：original 里不存在的错误、optimized 里不存在的改法，一律不许写。忠于两句的真实差异。
- 若某段没有对应改动，就【整段都不写】（连段标记也不写）。但至少要写出一段（这批卡都确有改动才被选中）。
- 箭头一律用真箭头字符 →（U+2192），不要用 -> 或破折号。
- 英文原词 / 替换词用中文引号「」包裹。
- 字符串值内部禁止英文双引号 "，如需引用一律用「」。

【示例】
original: I very like coffee and I drink two cup every day
optimized: I really enjoy coffee, and I drink two cups every day
输出：{ "note": "语法\\n单复数：two cup → two cups\\n词组\\nvery like → really enjoy" }`

/**
 * 调一次 DashScope（OpenAI 兼容 /chat/completions），返回文本内容。
 * @param {string} baseUrl  DASHSCOPE_BASE_URL
 * @param {string} apiKey   DASHSCOPE_API_KEY
 * @param {{role: string, content: string}[]} messages
 * @returns {Promise<string>}  模型文本输出
 */
async function callDashScope(baseUrl, apiKey, messages) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, messages }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`DashScope HTTP ${res.status}`)
    const data = await res.json()
    return data?.choices?.[0]?.message?.content?.trim() ?? ''
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 花括号切片取 JSON（对前后废话 / markdown 健壮）。
 * @param {string} raw
 * @returns {string}
 */
function extractJson(raw) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  return start >= 0 && end > start ? raw.slice(start, end + 1) : ''
}

/**
 * 为一张卡生成两段式 note；最多 MAX_ATTEMPTS 轮。成功返回合契约的 note，失败返回 null。
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string} original
 * @param {string} optimized
 * @returns {Promise<{note: string} | {error: string}>}
 */
async function generateNote(baseUrl, apiKey, original, optimized) {
  const userMsg = `original: ${original}\noptimized: ${optimized}`
  let messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: userMsg },
  ]
  let lastErr = '未知'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw = ''
    try {
      raw = await callDashScope(baseUrl, apiKey, messages)
    } catch (e) {
      lastErr = `调用失败：${e instanceof Error ? e.message : String(e)}`
      continue
    }
    const jsonText = extractJson(raw)
    let parsed
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      lastErr = 'JSON 解析失败'
      messages = [...messages, { role: 'assistant', content: raw },
        { role: 'user', content: '你上次输出无法解析为合法 JSON。只输出 { "note": "..." } 本身，字符串内换行写成 \\n，内部引用一律用「」不用英文双引号。' }]
      continue
    }
    const note = parsed?.note
    if (typeof note !== 'string' || note.trim().length === 0) {
      lastErr = 'note 字段缺失或为空'
      messages = [...messages, { role: 'assistant', content: raw },
        { role: 'user', content: '请重新输出 { "note": "..." }，note 必须是非空的两段式契约字符串。' }]
      continue
    }
    const lint = lintNote(note)
    if (!lint.ok) {
      lastErr = `生成结果不合契约：${lint.reason}`
      messages = [...messages, { role: 'assistant', content: raw },
        { role: 'user', content: `你的 note 不合契约（${lint.reason}）。必须至少含一段（段以单独一行「语法」或「词组」开头）；每行改动用真箭头 → 连接；【绝不写 X → X 这种没改动的空账】，也不许用 (removed) 之类占位符——只写 original→optimized 里真实发生的差异。请重出。` }]
      continue
    }
    return { note }
  }
  return { error: lastErr }
}

async function main() {
  const commit = process.argv.includes('--commit')
  const dbUrl = process.env.SUPABASE_DB_URL
  const apiKey = process.env.DASHSCOPE_API_KEY
  const baseUrl = process.env.DASHSCOPE_BASE_URL
  if (!dbUrl) { console.error('✗ 缺少 SUPABASE_DB_URL'); process.exit(1) }
  if (!apiKey || !baseUrl) { console.error('✗ 缺少 DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL'); process.exit(1) }

  console.log(`模式：${commit ? '⚠️  COMMIT（将写库）' : 'dry-run（只生成审阅文件，不写库）'}`)

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()

  const results = []
  try {
    // 拉出所有 note 非空且 original/optimized 齐全的卡，老格式判定放到 JS 里（用契约解析器，幂等）
    const { rows } = await client.query(
      `SELECT id, original, optimized, note FROM saved_phrases
       WHERE note IS NOT NULL AND btrim(note) <> ''
         AND original IS NOT NULL AND btrim(original) <> ''
         AND optimized IS NOT NULL AND btrim(optimized) <> ''
       ORDER BY created_at`,
    )
    const oldCards = rows.filter((r) => parseNoteContract(r.note) === null)
    console.log(`库内候选 ${rows.length} 张（note 非空+原句优化句齐全），其中老格式 ${oldCards.length} 张待处理。\n`)

    for (const card of oldCards) {
      process.stdout.write(`处理 ${card.id} … `)
      const gen = await generateNote(baseUrl, apiKey, card.original, card.optimized)
      if ('note' in gen) {
        results.push({ id: card.id, status: 'ok', original: card.original, optimized: card.optimized, oldNote: card.note, newNote: gen.note })
        console.log('✓')
      } else {
        results.push({ id: card.id, status: 'needs-manual', reason: gen.error, original: card.original, optimized: card.optimized, oldNote: card.note, newNote: null })
        console.log(`✗ 需人工（${gen.error}）`)
      }
    }

    const okList = results.filter((r) => r.status === 'ok')
    const manualList = results.filter((r) => r.status === 'needs-manual')

    // 落审阅文件（成功 + 需人工都写进去，方便人一次看全）
    writeFileSync(OUT_FILE, JSON.stringify({
      generatedAt: new Date().toISOString(),
      mode: commit ? 'commit' : 'dry-run',
      total: oldCards.length,
      ok: okList.length,
      needsManual: manualList.length,
      items: results,
    }, null, 2), 'utf-8')
    console.log(`\n审阅文件已写入：${OUT_FILE}`)
    console.log(`统计：成功 ${okList.length} / 需人工 ${manualList.length} / 共 ${oldCards.length}`)

    if (!commit) {
      console.log('\n[dry-run] 未写库。人审通过后加 --commit 重跑写库。')
      return
    }

    // —— commit 分支：只写成功生成的条目 —— //
    if (okList.length === 0) { console.log('\n没有可写库的成功条目，结束。'); return }
    console.log(`\n⚠️  即将 UPDATE saved_phrases.note，共 ${okList.length} 条…`)
    let updated = 0
    for (const r of okList) {
      const res = await client.query('UPDATE saved_phrases SET note = $1 WHERE id = $2', [r.newNote, r.id])
      updated += res.rowCount ?? 0
    }
    console.log(`✓ 已更新 ${updated} 条。需人工 ${manualList.length} 条未动。`)
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error('✗ backfill-note-segments 异常：', e instanceof Error ? e.message : e); process.exit(1) })
