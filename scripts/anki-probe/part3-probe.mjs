/**
 * Anki 卡背 · part3 专项例句探针（多题型 go/no-go）
 * 前轮 example-probe 只跑了 2 道观点类 part3（C1/C2）。本探针补 4 道不同追问类型
 *   （原因/比较/未来/权衡），验通用示范论据句在多题型上：论据贴合 / 常识不离谱 / 作文腔（Firstly/Moreover）/ 编假统计。
 * part3 无语料、无留空出口（每个论点都能论证）。SYSTEM_PART3 与 example-probe / part3-example-prompt.ts 同源。
 * 用法：node scripts/anki-probe/part3-probe.mjs
 * 产出：scripts/anki-probe/part3-report.md（供考官判）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

function loadEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}
const env = loadEnv('.env.local')
const API_KEY = env.DASHSCOPE_API_KEY
const BASE_URL = env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
if (!API_KEY) { console.error('缺 DASHSCOPE_API_KEY'); process.exit(1) }
const ENDPOINT = `${BASE_URL.replace(/\/$/, '')}/chat/completions`
const MODEL = 'qwen-plus'
const TEMPERATURE = 0.7

// ⚠️ 与 example-probe.mjs 的 SYSTEM_PART3 / src/lib/ai/part3-example-prompt.ts 逐字同源
const SYSTEM_PART3 = `你是为中国雅思考生服务的英语口语外教。给你：一道雅思口语 Part3 讨论题、以及为这道题准备的若干「答题角度」（立场/理由/延伸，每个有中文小标题 + 中文说明）。任务：为【每一个角度】各写【一句】可以直接开口念的短英文【示范论据句】，帮考生看到这个角度可以怎么用一句话论证或举例。

# 输出格式
严格输出一个 JSON 数组，长度 = 角度个数，逐点对应，形如 [{"idx":0,"en":"..."}]。不要输出 JSON 以外任何文字，不要 markdown 代码块包裹。

# 铁律（违反任一条算失败）
1. 每句 ≤22 词，是【说出来】的口语（可缩写、and/so/but 起句），不是作文。绝不用 Firstly / Moreover / Furthermore / In conclusion 这类书面连接词。
2. 每句必须真的在表达/支撑它对应的那个中文角度（扣住中文说明），不跑题、不循环论证、不说正确废话（禁 "it has both advantages and disadvantages" 这种零信息套话），要给一个具体、能被记住复用的角度。
3. 【不编造任何可核查的具体事实】：不给统计数字（如 "70% of people"）、不引具名研究（"a study by Harvard shows"）、不提具体新闻/机构/人物、不下绝对国别断言（"in China everyone…"）。论据只停留在一般性、经验性、能自圆其说的层面。宁可说得通用，也不编一个假数据撑场面。
4. 不要中式英语（想象母语者会怎么随口说这个观点）。
5. 纯英文正文，不用星号井号反引号破折号，不给词加粗，不整句加引号，不出现 band/IELTS/雅思/Part 这类词。
6. 【比较/权衡类题的「理由」必须论证本方立场】：若题目是比较、权衡类（哪个更好、利弊之类），写「理由」这一点时，理由必须支撑你在「立场」里选的那一方，别在理由里替对立面说话（会自相矛盾）；想讲对立面的好处、让步，放到「延伸」那一点去写。
7. 【不编第一人称具体亲历，可留第一人称观点/观察】：举例不要编造「我具体做过什么」的个人经历（写死的地点、时长、人设，例如 I used to spend two hours daily on the subway——别的考生没法照搬）；要举例时优先用假设框（imagine…）或泛化的第三人称（someone who…）。但 I think / I believe / I've noticed 这类表达观点和观察的第一人称是自然的、可以用。`

const FOCUS = [
  { title: '表明立场', desc: '先给出你对这个问题的看法/回答' },
  { title: '讲清理由', desc: '用一个主要理由把它讲透，能配一个例子最好' },
  { title: '延伸展开', desc: '补一个不同角度、让步、比较或推测' },
]
const userPart3 = (title, focus) =>
`题型：Part 3
英文题面：${title}

【论点】（为每一个生成一句示范论据句，idx 从 0 开始）
${focus.map((p, i) => `${i}. ${p.title}：${p.desc}`).join('\n')}

现在为每一个论点生成一句示范论据句，按 JSON 格式输出。`

// 4 道不同追问类型
const INPUTS = [
  { id: 'P-cause', type: '原因', title: 'Why do you think some people find it difficult to say sorry?' },
  { id: 'P-compare', type: '比较', title: 'Is it better to live in a big city or in the countryside?' },
  { id: 'P-future', type: '未来推测', title: 'How do you think the way people communicate will change in the future?' },
  { id: 'P-tradeoff', type: '权衡', title: 'What are the advantages and disadvantages of working from home?' },
]
const RUNS = [1, 2]

function machine(text) {
  const t = (text || '').trim()
  const words = (t.match(/\b[\w'-]+\b/g) || []).length
  const H1 = !/[一-鿿]/.test(t)
  const H3 = !/[—–]/.test(t)
  const H5 = (t.match(/[.!?]+/g) || []).length <= 1
  const H6 = words <= 22
  // 作文腔预筛（part3 专项）
  const writtenConnector = /\b(firstly|secondly|moreover|furthermore|in conclusion|henceforth)\b/i.test(t)
  // 假事实预筛
  const fakeFact = /\b\d+\s*%|\bpercent\b|\bstudy\b|\bresearch\b|\bsurvey\b|according to\b/i.test(t)
  return { words, H1, H3, H5, H6, writtenConnector, fakeFact }
}
function parseArr(raw) {
  let s = (raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const lb = s.indexOf('['), rb = s.lastIndexOf(']')
  if (lb >= 0 && rb > lb) s = s.slice(lb, rb + 1)
  return JSON.parse(s).map(x => ({ idx: Number(x.idx), en: String(x.en ?? '').trim() }))
}
async function gen(user) {
  const res = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: SYSTEM_PART3 }, { role: 'user', content: user }], temperature: TEMPERATURE, max_tokens: 400 }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).choices?.[0]?.message?.content?.trim() ?? ''
}

const tasks = []
for (const inp of INPUTS) for (const run of RUNS) tasks.push({ inp, run })
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]) } catch (e) { out[idx] = { error: String(e?.message || e) } } } }))
  return out
}

console.log(`跑 ${tasks.length} 个 part3 生成任务（4 题型 × 2 run）…`)
const results = await pool(tasks, 4, async ({ inp, run }) => {
  const raw = await gen(userPart3(inp.title, FOCUS))
  return { inp, run, raw, arr: parseArr(raw) }
})

const flag = b => (b ? '✓' : '✗')
let md = `# Anki 卡背 · part3 专项例句探针（多题型）

- 4 道不同追问类型（原因/比较/未来/权衡）× 2 run，通用示范论据句，qwen-plus temp ${TEMPERATURE}
- 前轮只跑 2 道观点类；本轮验 part3 论据在多题型上：论据贴合 / 常识不离谱 / 作文腔 / 编假统计
- 机器预筛：作文腔(Firstly/Moreover)⚠️、假事实(数字%/study/according to)⚠️ —— 命中即人工重点复核

> 人工判分（考官）：逐句 论据贴合 / 论证站得住 / 无作文腔 / 无编假统计 / 口语 / 中式

---
`
let writtenHits = 0, fakeHits = 0, total = 0, parseErr = 0
for (const inp of INPUTS) {
  md += `\n## ${inp.id}（${inp.type}）\n**题面**：${inp.title}\n\n`
  for (const run of RUNS) {
    const r = results.find(x => x.inp.id === inp.id && x.run === run)
    md += `**run${run}**：\n`
    if (!r || r.error) { md += `- ⚠️ ${r?.error || '失败'}\n`; continue }
    if (!r.arr?.length) { parseErr++; md += `- ⚠️ 解析失败：${r.raw.slice(0, 150)}\n`; continue }
    for (let i = 0; i < FOCUS.length; i++) {
      const ex = r.arr.find(e => e.idx === i)
      if (!ex) { md += `  - [${i}] ${FOCUS[i].title}：⚠️缺\n`; continue }
      const m = machine(ex.en); total++
      if (m.writtenConnector) writtenHits++
      if (m.fakeFact) fakeHits++
      const warn = (m.writtenConnector ? ' ⚠️作文腔' : '') + (m.fakeFact ? ' ⚠️假事实' : '')
      md += `  - **[${i}] ${FOCUS[i].title}**（${m.words}词｜H1${flag(m.H1)} H3${flag(m.H3)} H5${flag(m.H5)} H6${flag(m.H6)}${warn}）\n    > ${ex.en}\n`
    }
  }
  md += `\n**${inp.id} 判分**（考官填）：论据贴合 ☐　站得住 ☐　无作文腔 ☐　无假统计 ☐　口语 ☐　中式 ☐\n\n---\n`
}
md = md.replace('---\n', `- 例句 ${total} 句　机器预筛：作文腔命中 ${writtenHits}　假事实命中 ${fakeHits}　解析失败 ${parseErr}\n\n---\n`)

mkdirSync('scripts/anki-probe', { recursive: true })
writeFileSync('scripts/anki-probe/part3-report.md', md, 'utf8')
console.log(`完成：${total} 句，作文腔命中 ${writtenHits}，假事实命中 ${fakeHits}，解析失败 ${parseErr}`)
console.log('报告已写 scripts/anki-probe/part3-report.md')
