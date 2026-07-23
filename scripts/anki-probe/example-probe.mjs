/**
 * Anki 卡背 · 分点式「例句」探针（go/no-go 用，v0.3 新形态）
 * 验核心假设：分点式为每个侧重点各生成一句短英文例句时，语料薄的点会不会「为填格子而编造」。
 *   - part1/2（有语料）：忠料 prompt（空点要求笼统、绝不编）——含一条【薄素材】样本专门压测。
 *   - part3（无语料）：通用示范论据句 prompt（不审忠料，审论据贴合+常识）。
 * 不分档（v0.3 拍板）。一次调用产出该题所有点的例句 JSON。qwen-plus。
 * 用法：node scripts/anki-probe/example-probe.mjs
 * 产出：scripts/anki-probe/example-report.md（供考官 + metric-designer 判忠料/对点/口语）
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

// ── part1/2 忠料 prompt（metric-designer 骨架，v0.3 §3）──
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

// ── part3 论据 prompt（无语料，通用示范句；metric-designer part3 专项红线）──
const SYSTEM_PART3 = `你是为中国雅思考生服务的英语口语外教。给你：一道雅思口语 Part3 讨论题、以及为这道题准备的若干「答题角度」（立场/理由/延伸，每个有中文小标题 + 中文说明）。任务：为【每一个角度】各写【一句】可以直接开口念的短英文【示范论据句】，帮考生看到这个角度可以怎么用一句话论证或举例。

# 输出格式
严格输出一个 JSON 数组，长度 = 角度个数，逐点对应，形如 [{"idx":0,"en":"..."}]。不要输出 JSON 以外任何文字，不要 markdown 代码块包裹。

# 铁律（违反任一条算失败）
1. 每句 ≤22 词，是【说出来】的口语（可缩写、and/so/but 起句），不是作文。绝不用 Firstly / Moreover / Furthermore / In conclusion 这类书面连接词。
2. 每句必须真的在表达/支撑它对应的那个中文角度（扣住中文说明），不跑题、不循环论证、不说正确废话（禁 "it has both advantages and disadvantages" 这种零信息套话），要给一个具体、能被记住复用的角度。
3. 【不编造任何可核查的具体事实】：不给统计数字（如 "70% of people"）、不引具名研究（"a study by Harvard shows"）、不提具体新闻/机构/人物、不下绝对国别断言（"in China everyone…"）。论据只停留在一般性、经验性、能自圆其说的层面。宁可说得通用，也不编一个假数据撑场面。
4. 不要中式英语（想象母语者会怎么随口说这个观点）。
5. 纯英文正文，不用星号井号反引号破折号，不给词加粗，不整句加引号，不出现 band/IELTS/雅思/Part 这类词。`

const userStoried = (part, title, focus, corpus) =>
`题型：Part ${part}
英文题面：${title}

【答题侧重点】（为每一个生成一句例句，idx 从 0 开始）
${focus.map((p, i) => `${i}. ${p.title}：${p.desc}`).join('\n')}

【用户中文口述语料】
${corpus}

现在为每一个侧重点生成一句短英文例句，按 JSON 格式输出。`

const userPart3 = (title, focus) =>
`题型：Part 3
英文题面：${title}

【论点】（为每一个生成一句示范论据句，idx 从 0 开始）
${focus.map((p, i) => `${i}. ${p.title}：${p.desc}`).join('\n')}

现在为每一个论点生成一句示范论据句，按 JSON 格式输出。`

// ── 输入 ──
const FP_P1 = (a, b) => [{ title: a[0], desc: a[1] }, { title: b[0], desc: b[1] }]
const FP_P2 = (a, b, c) => [{ title: a[0], desc: a[1] }, { title: b[0], desc: b[1] }, { title: c[0], desc: c[1] }]

const STORIED = [
  { id: 'A1', part: 1, topic: '作息', title: 'Do you usually go to bed early or late?',
    focus: FP_P1(['怎么起手', '开门见山先说你是早睡还是晚睡，一句话把习惯说清楚'], ['收在哪', '挑一个真实小细节点一下（什么时候脑子最清醒/早上起不起得来）']),
    corpus: '我是典型的夜猫子，一般都过了十二点才睡，晚上十点以后脑子反而最清醒，重要的事我都留到深夜做。早上基本起不来，闹钟得响好几个才爬得起来，上午整个人是懵的。' },
  { id: 'A2', part: 1, topic: '室内vs户外', title: 'Do you prefer spending your free time indoors or outdoors?',
    focus: FP_P1(['怎么起手', '直接说你更喜欢待在室内还是户外，一句话给出偏好'], ['收在哪', '用一个真实小场景点一下为什么']),
    corpus: '我其实更喜欢待在家里。一到周末我就想窝在家，泡杯茶，打开一局策略游戏能玩一下午，中间连水都忘了喝。那种不用理任何人、完全按自己节奏来的感觉特别舒服，出门反而觉得累。' },
  { id: 'B1', part: 2, topic: '道歉经历', title: 'Describe a time when you apologized to someone. You should say: who, what the situation was, why, and how you felt afterwards.',
    focus: FP_P2(['交代背景', '一句话带过是跟谁、因为什么事，别在时间和细节精确度上停留'], ['讲清重点', '为什么会到需要道歉这一步，把起因或冲突讲清楚，这是最该展开的'], ['补得更完整', '道歉之后的感受、关系有没有变化']),
    corpus: '我要说的是跟我室友道歉那次。我俩之前一直因为宿舍卫生的分工闹得不太愉快，我总觉得我干得多。有次我没忍住，当着别人的面说她从来不收拾，话说得挺重的。她当时没吭声，但我看得出来她很受伤，那天晚上气氛特别僵。后来我冷静下来想，其实她那段时间在准备考试特别忙，是我太计较了。第二天我主动跟她说了对不起，还说以后分工的事我们好好商量。她一下子就放松了，说其实她也有做得不好的地方。那次之后我俩反而比以前更聊得开了，我也学会了有情绪先别急着开口。' },
  { id: 'B2', part: 2, topic: '放松的地方', title: 'Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.',
    focus: FP_P2(['交代背景', '一句话说清是什么地方、多久去一次'], ['讲清重点', '它凭什么能让你放松，把具体做法和氛围讲透'], ['补得更完整', '带给你的感受、和别处的不同']),
    corpus: '我最喜欢去的地方是家附近一个不大的公园，走路十分钟就到，我基本每天傍晚都会去。我一般什么也不干，就沿着湖边慢慢走一圈，戴着耳机听点歌，看看遛狗的和跑步的人。那儿有一排很老的柳树，风一吹特别安静。忙了一天之后去那儿走走，脑子里乱七八糟的事好像慢慢就理顺了，整个人会松下来。比起在家躺着刷手机，我觉得那种放空反而更解乏。' },
  // ⚠️ 薄素材压测样本：语料只覆盖「地点+放松」，"讲清重点(具体做法/氛围)"和"多久去/和别处不同"几乎无素材，
  //    看模型会不会为填 3 个格子编造具体做法（听歌/柳树/湖）、频率（每天傍晚）等语料没有的事实。
  { id: 'B2thin', part: 2, topic: '放松的地方(薄素材)', title: 'Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.',
    focus: FP_P2(['交代背景', '一句话说清是什么地方、多久去一次'], ['讲清重点', '它凭什么能让你放松，把具体做法和氛围讲透'], ['补得更完整', '带给你的感受、和别处的不同']),
    corpus: '我喜欢去我家附近的一个公园放松，感觉挺好的。' },
]

const PART3 = [
  { id: 'C1', title: 'Do you think people apologize enough these days?',
    focus: FP_P2(['表明立场', '先给出你的观点：现代人道歉够不够'], ['讲清理由', '用一个理由支撑你的立场'], ['延伸对比', '和过去对比，或补一个不同角度']) },
  { id: 'C2', title: 'Is it important for a city to protect its old buildings?',
    focus: FP_P2(['表明立场', '先给出你的观点：老建筑该不该保护'], ['讲清理由', '用一个理由支撑你的立场'], ['延伸对比', '补一个让步或不同角度']) },
]

const RUNS = [1, 2]

// ── 单句机器硬规则 ──
function machine(text, part) {
  const t = (text || '').trim()
  const words = (t.match(/\b[\w'-]+\b/g) || []).length
  const H1 = !/[一-鿿]/.test(t)                                  // 纯英文
  const H2 = !/[#*`_]/.test(t) && !/^["'].*["']$/.test(t)         // 无 markdown / 整句引号包裹
  const H3 = !/[—–]/.test(t)                                      // 无破折号
  const H4 = !(/\b(band|ielts|fluency|lexical)\b/i.test(t) || /雅思/.test(t) || /\bpart\s*[123]\b/i.test(t)) // 无泄漏
  const sentences = (t.match(/[.!?]+/g) || []).length
  const H5 = sentences <= 1                                       // 单句（≤1 个句末标点）
  const cap = part === 1 ? 20 : 25
  const H6 = words <= cap                                         // 长度上限
  const H7 = words >= 3                                           // 非空
  const allPass = H1 && H2 && H3 && H4 && H5 && H7                // H6 长度计入但不一票否决
  return { words, sentences, H1, H2, H3, H4, H5, H6, H7, allPass, cap }
}

// ── 解析 JSON（容错：剥 markdown fence / 取第一个数组）──
function parseExamples(raw) {
  let s = (raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const lb = s.indexOf('['), rb = s.lastIndexOf(']')
  if (lb >= 0 && rb > lb) s = s.slice(lb, rb + 1)
  const arr = JSON.parse(s)
  return arr.map(x => ({ idx: Number(x.idx), en: String(x.en ?? '').trim() }))
}

async function generate(system, user, maxTokens) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: TEMPERATURE, max_tokens: maxTokens }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return { text: (data.choices?.[0]?.message?.content ?? '').trim(), usage: data.usage }
}

// ── 组装任务 ──
const tasks = []
for (const inp of STORIED) for (const run of RUNS) tasks.push({ kind: 'storied', inp, run })
for (const inp of PART3) for (const run of RUNS) tasks.push({ kind: 'part3', inp, run })

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]) } catch (e) { out[idx] = { error: String(e?.message || e) } } }
  }))
  return out
}

console.log(`跑 ${tasks.length} 个生成任务（qwen-plus, temp ${TEMPERATURE}, 并发 4）…`)
const results = await pool(tasks, 4, async (t) => {
  if (t.kind === 'storied') {
    const { text, usage } = await generate(SYSTEM_STORIED, userStoried(t.inp.part, t.inp.title, t.inp.focus, t.inp.corpus), 400)
    return { ...t, text, usage, examples: parseExamples(text) }
  } else {
    const { text, usage } = await generate(SYSTEM_PART3, userPart3(t.inp.title, t.inp.focus), 400)
    return { ...t, text, usage, examples: parseExamples(text) }
  }
})

// ── 汇总 + report ──
let pTok = 0, cTok = 0, errs = 0, parseErrs = 0, exampleCount = 0, hardPass = 0
const flag = b => (b ? '✓' : '✗')
let md = `# Anki 卡背 · 分点式例句探针（go/no-go 判分用）

- 模型 \`qwen-plus\` · temperature ${TEMPERATURE} · 每题 N=2 · 不分档（v0.3）
- part1/2 审【忠料事实层/强度层 · 对点 · 口语 · 中式】；part3 审【论据贴合 · 常识不离谱 · 对点 · 口语 · 中式】（part3 无语料、不审忠料）
- 机器列：H1纯英文 H2无md H3无破折号 H4无泄漏 H5单句 H6长度≤上限 H7非空（H6 不一票否决）
- ⚠️ 重点看 **B2thin（薄素材）**：语料只有「公园+放松」，看 3 个点会不会为填格子编造做法/频率/氛围。

> 人工判分：逐条盲判每句例句是否 ① 忠料事实层(part1/2) ② 对准它那个点 ③ 口语可念 ④ 非中式；part3 换 ① 论据贴合 ② 常识不离谱。

---
`

function renderTask(r) {
  if (r.error) return `- ⚠️ 生成失败：${r.error}\n`
  let out = ''
  const focus = r.inp.focus
  if (!r.examples || r.examples.length === 0) { parseErrs++; return `- ⚠️ JSON 解析失败，原文：${r.text.replace(/\n+/g, ' ').slice(0, 200)}\n` }
  for (let i = 0; i < focus.length; i++) {
    const ex = r.examples.find(e => e.idx === i)
    if (!ex) { out += `  - [${i}] ${focus[i].title}：⚠️ 缺此点\n`; continue }
    const m = machine(ex.en, r.inp.part || 3)
    exampleCount++; if (m.allPass) hardPass++
    out += `  - **[${i}] ${focus[i].title}**（${m.words}词｜H1${flag(m.H1)} H2${flag(m.H2)} H3${flag(m.H3)} H4${flag(m.H4)} H5${flag(m.H5)} H6${flag(m.H6)} H7${flag(m.H7)}）\n`
    out += `    > ${ex.en}\n`
  }
  return out
}

md += `## Part 1 / Part 2（有语料，审忠料）\n`
for (const inp of STORIED) {
  md += `\n### 输入 ${inp.id}（Part ${inp.part}·${inp.topic}）\n`
  md += `**题面**：${inp.title}\n\n**中文语料**：${inp.corpus}\n\n`
  for (const run of RUNS) {
    const r = results.find(x => x.kind === 'storied' && x.inp.id === inp.id && x.run === run)
    md += `**run${run}**：\n${renderTask(r)}\n`
    if (r && !r.error) { pTok += r.usage?.prompt_tokens || 0; cTok += r.usage?.completion_tokens || 0 } else errs++
  }
  md += `\n**${inp.id} 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐\n\n---\n`
}

md += `\n## Part 3（无语料，审论据贴合+常识）\n`
for (const inp of PART3) {
  md += `\n### 输入 ${inp.id}（Part 3·讨论题）\n`
  md += `**题面**：${inp.title}\n\n`
  for (const run of RUNS) {
    const r = results.find(x => x.kind === 'part3' && x.inp.id === inp.id && x.run === run)
    md += `**run${run}**：\n${renderTask(r)}\n`
    if (r && !r.error) { pTok += r.usage?.prompt_tokens || 0; cTok += r.usage?.completion_tokens || 0 } else errs++
  }
  md += `\n**${inp.id} 判分**（人填）：论据贴合 ☐　常识不离谱 ☐　对点 ☐　口语 ☐　中式 ☐\n\n---\n`
}

md = md.replace('---\n', `- 例句总数 ${exampleCount}　机器硬规则通过 ${hardPass}/${exampleCount}　生成失败 ${errs}　解析失败 ${parseErrs}\n- token：prompt ${pTok} + completion ${cTok} = ${pTok + cTok}\n\n---\n`)

mkdirSync('scripts/anki-probe', { recursive: true })
writeFileSync('scripts/anki-probe/example-report.md', md, 'utf8')
console.log(`完成：例句 ${exampleCount} 句，机器通过 ${hardPass}/${exampleCount}，生成失败 ${errs}，解析失败 ${parseErrs}`)
console.log(`token 合计 ${pTok + cTok}（prompt ${pTok} + completion ${cTok}）`)
console.log(`报告已写 scripts/anki-probe/example-report.md`)
