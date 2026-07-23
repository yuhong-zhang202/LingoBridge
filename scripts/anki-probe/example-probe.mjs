/**
 * Anki 卡背 · 分点式「例句 + 留空出口」探针（go/no-go 用，v0.3 新形态）
 * 验核心假设：给模型一个明确的【留空出口】（某侧重点语料没素材 → en=null、noMaterial=true，不编）后，
 *   ① 会编的薄素材点（B2thin 全部 / B2-40 / B2-60 的「补完整」点）现在是【正确留空】还是【仍编】？
 *   ② 完整语料的点（A1/A2/B1/B2）有没有被【误留空】（该生成的被标 noMaterial）？
 *   - part1/2（有语料）：忠料 + 留空出口 prompt（SYSTEM_STORIED，与生产 anki-answer-prompt.ts 同源）。
 *   - part3（无语料）：通用示范论据句 prompt（不审忠料、无留空出口——每个论点都能论证，不涉及素材缺失）。
 * 不分档（v0.3 拍板）。一次调用产出该题所有点的 JSON。qwen-plus。
 * 用法：node scripts/anki-probe/example-probe.mjs
 * 产出：scripts/anki-probe/example-report.md（供考官 + metric-designer 判忠料/对点/口语/留空是否有效）
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

// ── part1/2 忠料 + 留空出口 prompt ──
// ⚠️ 同源硬约束：本 SYSTEM_STORIED 与生产 src/lib/ai/anki-answer-prompt.ts 的 ANKI_ANSWER_SYSTEM
//    【逐字一致】，改一处必改两处。单测 anki-answer.test.ts 读本文件抽出 SYSTEM_STORIED 与生产常量比对，
//    不一致即测试红（物理锚点互锁，不靠人记得）。
const SYSTEM_STORIED = `你是一位为中国雅思考生服务的英语口语外教。给你：一道雅思口语题、这道题的若干「答题侧重点」（每个点有中文小标题 + 中文说明），以及用户用中文口述的真实经历（语料）。任务：为【每一个侧重点】判断用户语料里有没有讲到这个点需要的素材，有就写【一句】可以直接开口念的短英文口语例句示范这个点该怎么说，没有就把这个点【留空】。

# 输出格式
严格输出一个 JSON 对象，形如 {"points":[{"idx":0,"en":"...","noMaterial":false},{"idx":1,"en":null,"noMaterial":true}]}。points 数组长度 = 侧重点个数，逐点对应，idx 从 0 开始。每个元素二选一：
- 这个点有素材：{"idx":i,"en":"一句短英文例句","noMaterial":false}
- 这个点没素材：{"idx":i,"en":null,"noMaterial":true}
不要输出 JSON 以外的任何文字，不要用 markdown 代码块包裹。

# 留空出口（最重要，动笔前先读这条）
分点式最容易犯的错，是为了「把每个格子都填满」而编造语料里根本没有的事实。所以你有一个明确的、被鼓励使用的出口：
- 对每一个侧重点，先问自己：用户这条语料里，到底讲没讲到这个点需要的素材？
- 【讲到了】→ 写一句忠于语料的例句（noMaterial 填 false）。
- 【没讲到】→ 输出 en 为 null、noMaterial 为 true，把这个点留空。标 noMaterial 是完全正确、被允许的做法，不是失败，你不会因为留空被扣分；反倒是硬编一句去填满它才算失败。
- 尤其「补得更完整」「和别处的不同」「对比」「评价」这类点，用户语料里常常根本没讲到，这种时候就大方留空，绝不硬凑。
原则：这个点可以留空，但绝不能编。宁可留空，不可编造。

# 写例句时的铁律（违反任一条算失败）
1. 每点只写一句、口语、能直接念出来（可缩写，可 and / so / but / like 起句），不长难句、不作文腔、不书面连接词（moreover、furthermore）。每句 ≤22 词。
2. 忠于语料，分两层：
   (事实层) 例句里的人物、地点、数字、时间、事件只能来自用户语料，绝不新增语料没提过的。这个点的素材不够，就按上面的留空出口把它留空，绝不为填满而编。
   (强度层) 不把语料里已有的事实，渲染成语料没有的画面、比喻或情绪强度。
3. 不要中式英语（简单 ≠ 中式，想象母语者会怎么随口说这件事）。
4. 这一句要真的在示范「它那个侧重点」该怎么说，扣住这个点的中文说明，不写成跟这个点无关的漂亮话，也不要几个点内容重复。
5. 纯英文正文，不用星号井号反引号破折号，不给词加粗，不整句加引号，不出现 band / IELTS / 雅思 / Part 这类词。

# 输出前自检：每个 en 非空的点，句子里有没有语料根本没有的地点、人名、数字、时间、做法？有就改笼统；改不动、本就没素材的，就把这个点留空（en 设为 null、noMaterial 设为 true）。`

// ── part3 论据 prompt（无语料，通用示范句；metric-designer part3 专项红线；不涉留空出口）──
const SYSTEM_PART3 = `你是为中国雅思考生服务的英语口语外教。给你：一道雅思口语 Part3 讨论题、以及为这道题准备的若干「答题角度」（立场/理由/延伸，每个有中文小标题 + 中文说明）。任务：为【每一个角度】各写【一句】可以直接开口念的短英文【示范论据句】，帮考生看到这个角度可以怎么用一句话论证或举例。

# 输出格式
严格输出一个 JSON 数组，长度 = 角度个数，逐点对应，形如 [{"idx":0,"en":"..."}]。不要输出 JSON 以外任何文字，不要 markdown 代码块包裹。

# 铁律（违反任一条算失败）
1. 每句 ≤22 词，是【说出来】的口语（可缩写、and/so/but 起句），不是作文。绝不用 Firstly / Moreover / Furthermore / In conclusion 这类书面连接词。
2. 每句必须真的在表达/支撑它对应的那个中文角度（扣住中文说明），不跑题、不循环论证、不说正确废话（禁 "it has both advantages and disadvantages" 这种零信息套话），要给一个具体、能被记住复用的角度。
3. 【不编造任何可核查的具体事实】：不给统计数字（如 "70% of people"）、不引具名研究（"a study by Harvard shows"）、不提具体新闻/机构/人物、不下绝对国别断言（"in China everyone…"）。论据只停留在一般性、经验性、能自圆其说的层面。宁可说得通用，也不编一个假数据撑场面。
4. 不要中式英语（想象母语者会怎么随口说这个观点）。
5. 纯英文正文，不用星号井号反引号破折号，不给词加粗，不整句加引号，不出现 band/IELTS/雅思/Part 这类词。`

// ⚠️ userStoried 结构与生产 anki-answer-prompt.ts 的 ankiAnswerUserPrompt 保持一致（同源，靠结构对齐）。
const userStoried = (part, title, focus, corpus) =>
`题型：Part ${part}
英文题面：${title}

【答题侧重点】（为每一个判断有没有素材，有就生成一句例句、没有就留空，idx 从 0 开始）
${focus.map((p, i) => `${i}. ${p.title}：${p.desc}`).join('\n')}

【用户中文口述语料】
${corpus}

现在为每一个侧重点判断并输出，按 JSON 格式输出。`

const userPart3 = (title, focus) =>
`题型：Part 3
英文题面：${title}

【论点】（为每一个生成一句示范论据句，idx 从 0 开始）
${focus.map((p, i) => `${i}. ${p.title}：${p.desc}`).join('\n')}

现在为每一个论点生成一句示范论据句，按 JSON 格式输出。`

// ── 输入 ──
const FP_P1 = (a, b) => [{ title: a[0], desc: a[1] }, { title: b[0], desc: b[1] }]
const FP_P2 = (a, b, c) => [{ title: a[0], desc: a[1] }, { title: b[0], desc: b[1] }, { title: c[0], desc: c[1] }]

// group='full' = 语料充足（看会不会被误留空）；group='thin' = 薄素材（看会编的点现在留没留空）。
const STORIED = [
  { id: 'A1', group: 'full', part: 1, topic: '作息', title: 'Do you usually go to bed early or late?',
    focus: FP_P1(['怎么起手', '开门见山先说你是早睡还是晚睡，一句话把习惯说清楚'], ['收在哪', '挑一个真实小细节点一下（什么时候脑子最清醒/早上起不起得来）']),
    corpus: '我是典型的夜猫子，一般都过了十二点才睡，晚上十点以后脑子反而最清醒，重要的事我都留到深夜做。早上基本起不来，闹钟得响好几个才爬得起来，上午整个人是懵的。' },
  { id: 'A2', group: 'full', part: 1, topic: '室内vs户外', title: 'Do you prefer spending your free time indoors or outdoors?',
    focus: FP_P1(['怎么起手', '直接说你更喜欢待在室内还是户外，一句话给出偏好'], ['收在哪', '用一个真实小场景点一下为什么']),
    corpus: '我其实更喜欢待在家里。一到周末我就想窝在家，泡杯茶，打开一局策略游戏能玩一下午，中间连水都忘了喝。那种不用理任何人、完全按自己节奏来的感觉特别舒服，出门反而觉得累。' },
  { id: 'B1', group: 'full', part: 2, topic: '道歉经历', title: 'Describe a time when you apologized to someone. You should say: who, what the situation was, why, and how you felt afterwards.',
    focus: FP_P2(['交代背景', '一句话带过是跟谁、因为什么事，别在时间和细节精确度上停留'], ['讲清重点', '为什么会到需要道歉这一步，把起因或冲突讲清楚，这是最该展开的'], ['补得更完整', '道歉之后的感受、关系有没有变化']),
    corpus: '我要说的是跟我室友道歉那次。我俩之前一直因为宿舍卫生的分工闹得不太愉快，我总觉得我干得多。有次我没忍住，当着别人的面说她从来不收拾，话说得挺重的。她当时没吭声，但我看得出来她很受伤，那天晚上气氛特别僵。后来我冷静下来想，其实她那段时间在准备考试特别忙，是我太计较了。第二天我主动跟她说了对不起，还说以后分工的事我们好好商量。她一下子就放松了，说其实她也有做得不好的地方。那次之后我俩反而比以前更聊得开了，我也学会了有情绪先别急着开口。' },
  { id: 'B2', group: 'full', part: 2, topic: '放松的地方', title: 'Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.',
    focus: FP_P2(['交代背景', '一句话说清是什么地方、多久去一次'], ['讲清重点', '它凭什么能让你放松，把具体做法和氛围讲透'], ['补得更完整', '带给你的感受、和别处的不同']),
    corpus: '我最喜欢去的地方是家附近一个不大的公园，走路十分钟就到，我基本每天傍晚都会去。我一般什么也不干，就沿着湖边慢慢走一圈，戴着耳机听点歌，看看遛狗的和跑步的人。那儿有一排很老的柳树，风一吹特别安静。忙了一天之后去那儿走走，脑子里乱七八糟的事好像慢慢就理顺了，整个人会松下来。比起在家躺着刷手机，我觉得那种放空反而更解乏。' },
  // ⚠️ 薄素材压测样本：语料只覆盖「地点+放松」，"讲清重点(做法/氛围)"和"补完整(和别处不同)"几乎无素材。
  //    留空出口前：5/6 句为填格子编造（做法/频率/柳树/湖）。看现在会不会正确留空。
  { id: 'B2thin', group: 'thin', part: 2, topic: '放松的地方(薄素材·21字)', title: 'Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.',
    focus: FP_P2(['交代背景', '一句话说清是什么地方、多久去一次'], ['讲清重点', '它凭什么能让你放松，把具体做法和氛围讲透'], ['补得更完整', '带给你的感受、和别处的不同']),
    corpus: '我喜欢去我家附近的一个公园放松，感觉挺好的。' },
  // ⚠️ 中间档薄素材（复用 threshold-probe 语料）：语料给了地点+频率+做法，但"和别处不同/对比"无素材。
  //    留空出口前 threshold 轮 40字编造率 17%、60字 33%，编的主要是「补得更完整」的对比。看现在留没留空。
  { id: 'B2-40', group: 'thin', part: 2, topic: '放松的地方(中薄·40字)', title: 'Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.',
    focus: FP_P2(['交代背景', '一句话说清是什么地方、多久去一次'], ['讲清重点', '它凭什么能让你放松，把具体做法和氛围讲透'], ['补得更完整', '带给你的感受、和别处的不同']),
    corpus: '我喜欢去我家附近的一个小公园，每天傍晚都会去，沿着湖边慢慢走一圈，戴着耳机听点歌，挺放松的。' },
  { id: 'B2-60', group: 'thin', part: 2, topic: '放松的地方(中薄·60字)', title: 'Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.',
    focus: FP_P2(['交代背景', '一句话说清是什么地方、多久去一次'], ['讲清重点', '它凭什么能让你放松，把具体做法和氛围讲透'], ['补得更完整', '带给你的感受、和别处的不同']),
    corpus: '我喜欢去我家附近的一个小公园，走路十分钟，每天傍晚都会去，沿着湖边慢慢走，戴耳机听歌，看看遛狗和跑步的人，那儿很安静，挺放松的。' },
]

const PART3 = [
  { id: 'C1', title: 'Do you think people apologize enough these days?',
    focus: FP_P2(['表明立场', '先给出你的观点：现代人道歉够不够'], ['讲清理由', '用一个理由支撑你的立场'], ['延伸对比', '和过去对比，或补一个不同角度']) },
  { id: 'C2', title: 'Is it important for a city to protect its old buildings?',
    focus: FP_P2(['表明立场', '先给出你的观点：老建筑该不该保护'], ['讲清理由', '用一个理由支撑你的立场'], ['延伸对比', '补一个让步或不同角度']) },
]

const RUNS = [1, 2]

// ── 单句机器硬规则（留空点不过机器，直接跳过）──
function machine(text, part) {
  const t = (text || '').trim()
  const words = (t.match(/\b[\w'-]+\b/g) || []).length
  const H1 = !/[一-鿿]/.test(t)                                  // 纯英文
  const H2 = !/[#*`_]/.test(t) && !/^["'].*["']$/.test(t)         // 无 markdown / 整句引号包裹
  const H3 = !/[—–]/.test(t)                                      // 无破折号
  const H4 = !(/\b(band|ielts|fluency|lexical)\b/i.test(t) || /雅思/.test(t) || /\bpart\s*[123]\b/i.test(t)) // 无泄漏
  const sentences = (t.match(/[.!?]+/g) || []).length
  const H5 = sentences <= 1                                       // 单句（≤1 个句末标点）
  const cap = 22                                                  // v0.3 统一长度上限 ≤22 词
  const H6 = words <= cap                                         // 长度上限
  const H7 = words >= 3                                           // 非空
  const allPass = H1 && H2 && H3 && H4 && H5 && H7                // H6 长度计入但不一票否决
  return { words, sentences, H1, H2, H3, H4, H5, H6, H7, allPass, cap }
}

// ── 取原文里【第一个完整的 JSON 值】（对象或数组，字符串感知）──
// ⚠️ qwen 有时把 JSON 双发（紧凑版 + 美化版拼在一起），从首个 { 贪切到最后一个 } 会跨两个对象、拼成非法 JSON。
//    故按平衡括号取首个完整值即止。（生产 callLLMJson 的 extractJson 也是贪切、遇双发靠重试兜，见交付说明。）
function firstJsonValue(s) {
  let depth = 0, inStr = false, esc = false, start = -1
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (start === -1) { if (c === '{' || c === '[') { start = i; depth = 1 } continue }
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
    if (c === '"') { inStr = true; continue }
    if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return s.slice(start, i + 1) }
  }
  return start === -1 ? '' : s.slice(start)  // 不平衡（截断）→ 尽力返回，交 JSON.parse 报错
}

// storied = {"points":[{idx,en,noMaterial}]}；part3 = 裸数组 [{idx,en}]；两者都容错。
function parseExamples(raw) {
  const s = (raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const parsed = JSON.parse(firstJsonValue(s))
  const arr = Array.isArray(parsed) ? parsed : (parsed.points || [])
  return arr.map(x => ({
    idx: Number(x.idx),
    en: x.en == null ? null : String(x.en).trim(),
    noMaterial: x.noMaterial === true,
  }))
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

function safeParse(text) {
  try { return parseExamples(text) } catch { return [] }  // 解析失败不连累整任务，renderTask 会显示原文
}

console.log(`跑 ${tasks.length} 个生成任务（qwen-plus, temp ${TEMPERATURE}, 并发 4）…`)
const results = await pool(tasks, 4, async (t) => {
  // 任务级 try/catch：出错也保留 t 的身份（kind/inp/run），否则 pool 的 catch 会丢身份让 find 落空。
  try {
    const system = t.kind === 'storied' ? SYSTEM_STORIED : SYSTEM_PART3
    const user = t.kind === 'storied'
      ? userStoried(t.inp.part, t.inp.title, t.inp.focus, t.inp.corpus)
      : userPart3(t.inp.title, t.inp.focus)
    // 对齐生产 ANKI_MAX_TOKENS（part1 512 / part2 1200），避免 3 点 JSON 被截断；part3 短用 512。
    const maxTokens = t.kind === 'part3' ? 512 : (t.inp.part === 1 ? 512 : 1200)
    const { text, usage } = await generate(system, user, maxTokens)
    return { ...t, text, usage, examples: safeParse(text) }
  } catch (e) {
    return { ...t, error: String(e?.message || e), text: '', examples: [] }
  }
})

// ── 汇总 + report ──
let pTok = 0, cTok = 0, errs = 0, parseErrs = 0, exampleCount = 0, hardPass = 0
// 留空计数：按 full / thin 两组分别统计「留空点数 / 总点数」，眼判「该留的留了 / 不该留的误留了」。
const blank = { full: { blank: 0, total: 0 }, thin: { blank: 0, total: 0 } }
const flag = b => (b ? '✓' : '✗')
let md = `# Anki 卡背 · 分点式例句 + 留空出口探针（go/no-go 判分用）

- 模型 \`qwen-plus\` · temperature ${TEMPERATURE} · 每题 N=2 · 不分档（v0.3）· SYSTEM 与生产 anki-answer-prompt.ts 同源
- part1/2 审【忠料事实层/强度层 · 对点 · 口语 · 中式 · 留空是否恰当】；part3 审【论据贴合 · 常识不离谱 · 对点 · 口语 · 中式】
- 机器列：H1纯英文 H2无md H3无破折号 H4无泄漏 H5单句 H6长度≤22 H7非空（H6 不一票否决）；留空点不过机器
- ⚠️ 留空验证两问：① 会编的薄素材点（B2thin/B2-40/B2-60 的做法/氛围/对比）现在【正确留空】还是【仍编】？
  ② 完整语料点（A1/A2/B1/B2）有没有被【误留空】？

> 人工判分：逐条盲判每句例句 ① 忠料事实层(part1/2) ② 对准它那个点 ③ 口语可念 ④ 非中式；留空点判「留得对不对」；part3 换 ① 论据贴合 ② 常识不离谱。

---
`

function renderTask(r) {
  if (!r) return `- ⚠️ 任务缺失（未跑到）\n`
  if (r.error) return `- ⚠️ 生成失败：${r.error}\n`
  let out = ''
  const focus = r.inp.focus
  if (!r.examples || r.examples.length === 0) { parseErrs++; return `- ⚠️ JSON 解析失败，原文：${r.text.replace(/\n+/g, ' ').slice(0, 300)}\n` }
  const grp = r.inp.group
  for (let i = 0; i < focus.length; i++) {
    const ex = r.examples.find(e => e.idx === i)
    if (!ex) { out += `  - [${i}] ${focus[i].title}：⚠️ 缺此点\n`; continue }
    if (grp) blank[grp].total++
    if (ex.noMaterial || ex.en == null) {
      if (grp) blank[grp].blank++
      out += `  - **[${i}] ${focus[i].title}** ⬜ 留空（noMaterial）\n`
      continue
    }
    const m = machine(ex.en, r.inp.part || 3)
    exampleCount++; if (m.allPass) hardPass++
    out += `  - **[${i}] ${focus[i].title}**（${m.words}词｜H1${flag(m.H1)} H2${flag(m.H2)} H3${flag(m.H3)} H4${flag(m.H4)} H5${flag(m.H5)} H6${flag(m.H6)} H7${flag(m.H7)}）\n`
    out += `    > ${ex.en}\n`
  }
  return out
}

md += `## Part 1 / Part 2（有语料，审忠料 + 留空）\n`
for (const inp of STORIED) {
  md += `\n### 输入 ${inp.id}（Part ${inp.part}·${inp.topic}·${inp.group}）\n`
  md += `**题面**：${inp.title}\n\n**中文语料**：${inp.corpus}\n\n`
  for (const run of RUNS) {
    const r = results.find(x => x.kind === 'storied' && x.inp.id === inp.id && x.run === run)
    md += `**run${run}**：\n${renderTask(r)}\n`
    if (r && !r.error) { pTok += r.usage?.prompt_tokens || 0; cTok += r.usage?.completion_tokens || 0 } else errs++
  }
  md += `\n**${inp.id} 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐　留空恰当 ☐\n\n---\n`
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

md = md.replace('---\n', `- 例句总数（非留空）${exampleCount}　机器硬规则通过 ${hardPass}/${exampleCount}　生成失败 ${errs}　解析失败 ${parseErrs}
- 留空统计：完整组 ${blank.full.blank}/${blank.full.total} 留空（应≈0，>0 即可能误留空）　薄素材组 ${blank.thin.blank}/${blank.thin.total} 留空（薄素材点应偏高）
- token：prompt ${pTok} + completion ${cTok} = ${pTok + cTok}

---
`)

mkdirSync('scripts/anki-probe', { recursive: true })
writeFileSync('scripts/anki-probe/example-report.md', md, 'utf8')
console.log(`完成：例句 ${exampleCount} 句，机器通过 ${hardPass}/${exampleCount}，生成失败 ${errs}，解析失败 ${parseErrs}`)
console.log(`留空：完整组 ${blank.full.blank}/${blank.full.total}，薄素材组 ${blank.thin.blank}/${blank.thin.total}`)
console.log(`token 合计 ${pTok + cTok}（prompt ${pTok} + completion ${cTok}）`)
console.log(`报告已写 scripts/anki-probe/example-report.md`)
