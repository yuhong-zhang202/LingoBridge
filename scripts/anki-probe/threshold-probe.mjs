/**
 * Anki 卡背 · 语料门槛「中间档」探针（定阈值用）
 * 目的：例句探针只有两锚点（~21字全编 / ~120字全过），40–100 中间地带无数据。
 *   本探针造 B1(道歉)/B2(放松) 两个 part2 题各 ~40/~60/~80 字三档语料，逐点生成例句，
 *   看忠料编造率随字数怎么变、拐点在哪 → 供 metric-designer 定门槛阈值。
 * 复用分点式忠料 prompt（与 example-probe 同源）。不分档。
 * 用法：node scripts/anki-probe/threshold-probe.mjs
 * 产出：scripts/anki-probe/threshold-report.md
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

// 与 example-probe.mjs 同源的 part1/2 忠料 prompt（⚠️ 改一处两处同改）
const SYSTEM_STORIED = `你是为中国雅思考生服务的英语口语外教。给你：一道雅思口语题、这道题的若干「答题侧重点」（每个点有中文小标题 + 中文说明）、以及用户用中文口述的真实经历（语料）。任务：为【每一个侧重点】各写【一句】可以直接开口念的短英文口语例句，示范这个点该怎么用一句话说出来。

# 输出格式
严格输出一个 JSON 数组，长度 = 侧重点个数，逐点对应，形如 [{"idx":0,"en":"..."},{"idx":1,"en":"..."}]。不要输出 JSON 以外的任何文字，不要用 markdown 代码块包裹。

# 铁律（违反任一条算失败）
1. 每点只写一句、口语、能直接念出来（可缩写、可 and/so/but/like 起句），不长难句、不作文腔、不书面连接词（moreover/furthermore）。part1 每句 ≤20 词，part2 ≤25 词。
2. 忠于语料，分两层：
   (事实层) 例句里的人物、地点、数字、时间、事件只能来自用户语料，绝不新增语料没提过的。【这个点的语料素材不够时，就把这句说得笼统一点，也绝不为了「把这个点填满」去编时间、地点、人物、细节】。宁可笼统，不可编造。
   (强度层) 不把语料已有的事实，渲染成语料没有的画面、比喻或情绪强度。
3. 不要中式英语（简单 ≠ 中式，想象母语者会怎么随口说这件事）。
4. 这一句要真的在示范「它那个侧重点」该怎么说，扣住这个点的中文说明，不要写成跟这个点无关的漂亮话，也不要几个点说重复的内容。
5. 纯英文正文，不用星号井号反引号破折号，不给词加粗，不整句加引号，不出现 band/IELTS/雅思/Part 这类词。

# 输出前自检：有没有语料里根本没有的地点/人名/数字/时间？有就删掉或改笼统。`

const userStoried = (part, title, focus, corpus) =>
`题型：Part ${part}
英文题面：${title}

【答题侧重点】（为每一个生成一句例句，idx 从 0 开始）
${focus.map((p, i) => `${i}. ${p.title}：${p.desc}`).join('\n')}

【用户中文口述语料】
${corpus}

现在为每一个侧重点生成一句短英文例句，按 JSON 格式输出。`

const B1_FOCUS = [
  { title: '交代背景', desc: '一句话带过是跟谁、因为什么事，别在时间和细节精确度上停留' },
  { title: '讲清重点', desc: '为什么会到需要道歉这一步，把起因或冲突讲清楚，这是最该展开的' },
  { title: '补得更完整', desc: '道歉之后的感受、关系有没有变化' },
]
const B2_FOCUS = [
  { title: '交代背景', desc: '一句话说清是什么地方、多久去一次' },
  { title: '讲清重点', desc: '它凭什么能让你放松，把具体做法和氛围讲透' },
  { title: '补得更完整', desc: '带给你的感受、和别处的不同' },
]
const B1_TITLE = 'Describe a time when you apologized to someone. You should say: who, what the situation was, why, and how you felt afterwards.'
const B2_TITLE = 'Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.'

// ── 三档字数语料（逐级增信息；实际有效字数由脚本算并标注）──
const INPUTS = [
  { id: 'B1-40', tier: 40, part: 2, topic: '道歉', title: B1_TITLE, focus: B1_FOCUS,
    corpus: '跟室友道歉那次，因为宿舍卫生分工闹得不愉快，我说了重话，第二天我主动道歉，关系反而更好了。' },
  { id: 'B1-60', tier: 60, part: 2, topic: '道歉', title: B1_TITLE, focus: B1_FOCUS,
    corpus: '我要说的是跟室友道歉那次，我俩因为宿舍卫生分工闹得不愉快，有次我当众说她从不收拾，话挺重的，第二天我主动道歉，她也放松了，关系反而更好。' },
  { id: 'B1-80', tier: 80, part: 2, topic: '道歉', title: B1_TITLE, focus: B1_FOCUS,
    corpus: '我要说的是跟室友道歉那次，我俩一直因为宿舍卫生分工不太愉快，我总觉得我干得多，有次没忍住当众说她从不收拾，她很受伤，后来我想其实她在忙考试，第二天我主动道歉，关系反而更好了。' },
  { id: 'B2-40', tier: 40, part: 2, topic: '放松', title: B2_TITLE, focus: B2_FOCUS,
    corpus: '我喜欢去我家附近的一个小公园，每天傍晚都会去，沿着湖边慢慢走一圈，戴着耳机听点歌，挺放松的。' },
  { id: 'B2-60', tier: 60, part: 2, topic: '放松', title: B2_TITLE, focus: B2_FOCUS,
    corpus: '我喜欢去我家附近的一个小公园，走路十分钟，每天傍晚都会去，沿着湖边慢慢走，戴耳机听歌，看看遛狗和跑步的人，那儿很安静，挺放松的。' },
  { id: 'B2-80', tier: 80, part: 2, topic: '放松', title: B2_TITLE, focus: B2_FOCUS,
    corpus: '我喜欢去我家附近的一个小公园，走路十分钟就到，每天傍晚都会去，沿着湖边慢慢走一圈，戴着耳机听点歌，看看遛狗和跑步的人，那儿有排老柳树特别安静，走完脑子就理顺了，比在家刷手机解乏。' },
]
const RUNS = [1, 2]

const effChars = s => (s.match(/[一-龥a-zA-Z0-9]/g) || []).length  // 有效字符（剔标点空格）

function machine(text, part) {
  const t = (text || '').trim()
  const words = (t.match(/\b[\w'-]+\b/g) || []).length
  const H1 = !/[一-鿿]/.test(t)
  const H2 = !/[#*`_]/.test(t) && !/^["'].*["']$/.test(t)
  const H3 = !/[—–]/.test(t)
  const H5 = (t.match(/[.!?]+/g) || []).length <= 1
  const H6 = words <= (part === 1 ? 20 : 25)
  const H7 = words >= 3
  return { words, H1, H2, H3, H5, H6, H7 }
}
function parseExamples(raw) {
  let s = (raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const lb = s.indexOf('['), rb = s.lastIndexOf(']')
  if (lb >= 0 && rb > lb) s = s.slice(lb, rb + 1)
  return JSON.parse(s).map(x => ({ idx: Number(x.idx), en: String(x.en ?? '').trim() }))
}
async function generate(system, user) {
  const res = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: TEMPERATURE, max_tokens: 400 }),
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

console.log(`跑 ${tasks.length} 个生成任务（中间档字数探针）…`)
const results = await pool(tasks, 4, async ({ inp, run }) => {
  const raw = await generate(SYSTEM_STORIED, userStoried(inp.part, inp.title, inp.focus, inp.corpus))
  return { inp, run, raw, examples: parseExamples(raw) }
})

const flag = b => (b ? '✓' : '✗')
let md = `# Anki 卡背 · 语料门槛中间档探针（定阈值用）

- 造 B1(道歉)/B2(放松) 两 part2 题各 ~40/~60/~80 字（有效字符）三档，逐点生成例句，看忠料编造随字数变化
- 对照锚点（前轮 example-probe）：~21字(B2thin) → 5/6 编；~120–150字 → 20/20 全过
- ⚠️ 判分重点：**每档每点是否编造语料没有的做法/频率/对比/氛围**，找"编造消失"的字数拐点

> 人工判分：逐条标 忠料事实层 pass/fail + 编造点；按字数档汇总编造率。

---
`
for (const inp of INPUTS) {
  const ec = effChars(inp.corpus)
  md += `\n## ${inp.id}（目标~${inp.tier}字 · 实际 ${ec} 有效字 · Part2·${inp.topic}）\n`
  md += `**语料**：${inp.corpus}\n\n`
  for (const run of RUNS) {
    const r = results.find(x => x.inp.id === inp.id && x.run === run)
    md += `**run${run}**：\n`
    if (!r || r.error) { md += `- ⚠️ ${r?.error || '失败'}\n`; continue }
    if (!r.examples?.length) { md += `- ⚠️ 解析失败：${r.raw.slice(0, 150)}\n`; continue }
    for (let i = 0; i < inp.focus.length; i++) {
      const ex = r.examples.find(e => e.idx === i)
      if (!ex) { md += `  - [${i}] ${inp.focus[i].title}：⚠️缺\n`; continue }
      const m = machine(ex.en, 2)
      md += `  - **[${i}] ${inp.focus[i].title}**（${m.words}词｜H1${flag(m.H1)} H3${flag(m.H3)} H5${flag(m.H5)} H6${flag(m.H6)}）\n    > ${ex.en}\n`
    }
  }
  md += `\n**${inp.id} 判分**（人填）：[0]背景 ☐　[1]重点 ☐　[2]补完整 ☐　编造点：____\n\n---\n`
}
mkdirSync('scripts/anki-probe', { recursive: true })
writeFileSync('scripts/anki-probe/threshold-report.md', md, 'utf8')
console.log('完成，报告已写 scripts/anki-probe/threshold-report.md')
console.log('各输入实际有效字数：', INPUTS.map(i => `${i.id}=${effChars(i.corpus)}`).join('  '))
