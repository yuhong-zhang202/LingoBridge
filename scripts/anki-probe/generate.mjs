/**
 * Anki 题卡 · 卡背生成探针（go/no-go 用）
 * metric-designer 设计的套件：4 输入 × A/B/C 三档 × N=2 = 24 条，qwen-plus。
 * 直连 DashScope（OpenAI 兼容），不导入 server-only 代码。
 * 用法：node scripts/anki-probe/generate.mjs   （从 worktree 根跑）
 * 产出：scripts/anki-probe/report.md（供人 + metric-designer 判分）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

// ── 载入 .env.local（只取 DashScope 两项）──
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

// ── system prompt（diagnostician 按考官 3 条处方定稿，2026-07-23 探针第二轮；原 metric-designer 初版）──
const SYSTEM = `你是一位为中国雅思考生服务的英语口语外教。任务：拿到一道雅思口语题、这道题的分析、用户用中文口述的真实经历（语料），以及一个目标难度档，生成一段【可以直接开口说出来】的英文口语回答。这段回答会印在背题卡的背面，用户照着念、建立语感。

# 铁律（违反任何一条都算失败）
1. 只输出英文回答正文本身，一段纯文本。不要输出任何中文、不要标题、不要解释你为什么这么写、不要出现 band / IELTS / 雅思 / Part / fluency / grammar 这类元信息词。格式要求正面表述：全程只用普通句子和标点，不用任何星号、井号、反引号、下划线，不给任何词加粗或斜体，不用引号把整段包起来。
2. 必须是【说出来】的口语，不是写出来的文章：可以用缩写（I'm, don't, kind of），可以用 and / so / but / like 起句或过渡，可以有口语的松弛感。不要长难句堆叠、不要书面连接词（moreover, furthermore, in conclusion）、不要作文腔。
3. 忠于语料，且忠实分两层：
   (事实层) 回答里的事实（人物、场景、做了什么）只能来自用户这条中文语料，绝不能新增语料没提过的地点、人名、数字、时间、事件。语料没讲够的地方，宁可说得笼统，也不要编。
   (强度层) 也不能把语料里已有的事实，渲染成语料没有的画面、比喻或情绪强度。语料说"脑子放松了"，就说 my mind slows down 这类朴实说法，不要升级成 melts the static out of my head、brain remembers how to breathe 这种文学意象；语料说"她在忙考试"，就说 she was busy with exams，不要脑补成 pulling all-nighters、felt overwhelmed 这种语料没有的细节。润色只发生在语言层，不发生在事实层和强度层。
4. 不要中式英语：不要逐字直译中文，不要中式搭配和语序。想象一个母语者会怎么自然地说这件事，用他会用的说法。（注意：越是往低档降，越要守住这条——简单不等于中式。）
5. 停顿一律用逗号或句号来断句。不要用破折号（—、–、em dash、en dash 一律不用）。

# 题型决定长度
- Part 1：简短。直接回答问题，2 到 4 句就够，别铺垫别展开，像日常对话里随口答。
- Part 2：成段的个人叙述，但长度和结构完整度随档位变，见下方「Part 2 档位细则」，不要一律写成 150 词以上的完整叙事。

# 目标难度档（本次只按给定的一档生成）
三档的差异首先体现在"表达性词句"的地道程度上，绝不体现在"编造更多内容"上。
- A 档（基础）：用最常见、最基础的日常词和短句，简单、直接，宁可朴素也别用难词。关键：简单 ≠ 中式——依然要是母语者会说的自然说法，只是用词浅、句子短，让口语刚达标的考生也念得出来。
- B 档（自然）：自然的日常口语，朴素为主，句子可以稍长、有基本连接。感受和描述说清楚即可，不堆生动习语。这是默认档。
- C 档（地道）：明显更地道，用考生眼熟、好记、能复用的地道习语和 phrasal verb（例如 hit the hay 这种），有一点个性，但依然是口语，不是长难句、不是炫技、不是书面词，更不是文学隐喻。

# Part 2 档位细则（仅 Part 2 生效；Part 1 只按上面通用档位，三档差别很小）
Part 2 的档位差异，除了用词地道度，还要额外体现在句子复杂度、结构完整度和长度上：
- A 档（Part 2）：真正的基础水平，锚定一个刚达标的考生能自己复现的程度。以短句为主，尽量少用 past perfect（had done）这类复杂时态，一两个即可、不要通篇。允许朴素直白的表达和自然的少量重复，不追求面面俱到的完整叙事——把最重要的起因和感受说清楚就行，其余可以点到为止。长度约 120 到 150 词，靠一句句短句累加，不是靠加内容。仍然不能中式。
- B 档（Part 2）：自然连贯的叙述，覆盖题目 cue 的几个方面，有起因、经过、感受。简单句和复杂句混用。长度约 160 到 200 词。这是默认档。
- C 档（Part 2）：在 B 档基础上语言更地道（更多地道习语、phrasal verb、母语者语序），但守三条硬边界：一是天花板不超过一个流利考生的水平，不要写成书面高分作文；二是长度不得超过 B 档回答的 1.15 倍，宁可短也别为了地道而加长；三是绝不用文学隐喻、绝不新增语料没有的细节或情绪强度（见铁律 3）。C 档的"更地道"只加在怎么说，不加在说了什么。

# 事实锚点不随档位变
时间、地点、人物这类只交代事实的部分（如 last weekend、my roommate、at home），任何档都可以简单、可以和 A 档一样，不要为了拔高硬换花哨说法，那样反而假。只有感受、动作经过、评价这些体现语言功力的部分才随档位调地道程度。

# 输出前自检（在心里过一遍再输出，但不要把自检写出来）
1. 全篇有没有星号、井号、反引号、破折号？有就改成普通标点。
2. 有没有语料里根本没有的地点、人物、数字，或语料没有的比喻/情绪强度？有就删掉或改朴实。
3. 如果是 Part 2 C 档：长度有没有超过同题 B 档的 1.15 倍？句子是不是滑向了文学腔？有就收回来。

# 输出
直接输出英文回答正文，一段纯文本，无任何包裹或前后缀。`

const userPrompt = (part, tier, analysis, corpus) =>
`题型：Part ${part}
目标难度档：${tier}

【这道题的分析（含英文题面）】
${analysis}

【用户中文口述语料】
${corpus}

现在按上面的铁律和目标难度档，生成这段英文口语回答。`

// ── 4 条代表性输入（metric-designer 提供）──
const INPUTS = [
  { id: 'A1', part: 1, topic: '作息', analysis:
`英文题面：Do you usually go to bed early or late?
答题结构：先直接给出你的习惯 · 再点一个真实小细节收尾
侧重点：
1) 怎么起手：开门见山先说你是早睡还是晚睡，一句话把习惯说清楚，别铺垫。
2) 收在哪：挑一个真实小细节点一下就够（比如什么时候脑子最清醒、早上起不起得来），别展开讲道理。`,
    corpus: '我是典型的夜猫子，一般都过了十二点才睡，晚上十点以后脑子反而最清醒，重要的事我都留到深夜做。早上基本起不来，闹钟得响好几个才爬得起来，上午整个人是懵的。' },
  { id: 'A2', part: 1, topic: '室内vs户外', analysis:
`英文题面：Do you prefer spending your free time indoors or outdoors?
答题结构：先表明偏好 · 再点一个真实场景收尾
侧重点：
1) 怎么起手：直接说你更喜欢待在室内还是户外，一句话给出偏好。
2) 收在哪：用一个真实小场景点一下为什么，别展开成一堆理由。`,
    corpus: '我其实更喜欢待在家里。一到周末我就想窝在家，泡杯茶，打开一局策略游戏能玩一下午，中间连水都忘了喝。那种不用理任何人、完全按自己节奏来的感觉特别舒服，出门反而觉得累。' },
  { id: 'B1', part: 2, topic: '道歉经历', analysis:
`英文题面：Describe a time when you apologized to someone. You should say: who you apologized to, what the situation was, why you apologized, and explain how you felt afterwards.
答题结构：交代背景 · 讲清为什么道歉 · 补上事后的感受
侧重点：
1) 交代背景：一句话带过是跟谁、因为什么事，别在时间和细节精确度上停留。
2) 讲清重点：这类题的核心是"为什么会到需要道歉这一步"，把那段起因或冲突讲清楚，这是最该展开的。
3) 补得更完整：把道歉之后的感受、关系有没有变化讲出来，这是 Part 2 最能拉开分的地方。`,
    corpus: '我要说的是跟我室友道歉那次。我俩之前一直因为宿舍卫生的分工闹得不太愉快，我总觉得我干得多。有次我没忍住，当着别人的面说她从来不收拾，话说得挺重的。她当时没吭声，但我看得出来她很受伤，那天晚上气氛特别僵。后来我冷静下来想，其实她那段时间在准备考试特别忙，是我太计较了。第二天我主动跟她说了对不起，还说以后分工的事我们好好商量。她一下子就放松了，说其实她也有做得不好的地方。那次之后我俩反而比以前更聊得开了，我也学会了有情绪先别急着开口。' },
  { id: 'B2', part: 2, topic: '放松的地方', analysis:
`英文题面：Describe a place you like to go to relax. You should say: where it is, how often you go there, what you do there, and explain why it helps you relax.
答题结构：交代是哪个地方 · 讲清你在那儿做什么 · 补上为什么它能让你放松
侧重点：
1) 交代背景：一句话说清是什么地方、多久去一次。
2) 讲清重点：这题核心是"它凭什么能让你放松"，把你在那儿的具体做法和氛围讲透。
3) 补得更完整：把它带给你的感受、和别处的不同讲出来。`,
    corpus: '我最喜欢去的地方是家附近一个不大的公园，走路十分钟就到，我基本每天傍晚都会去。我一般什么也不干，就沿着湖边慢慢走一圈，戴着耳机听点歌，看看遛狗的和跑步的人。那儿有一排很老的柳树，风一吹特别安静。忙了一天之后去那儿走走，脑子里乱七八糟的事好像慢慢就理顺了，整个人会松下来。比起在家躺着刷手机，我觉得那种放空反而更解乏。' },
]

// ⚠️ C 档已于 2026-07-23 决策取消（方案 v0.2 §7：C 档可分性是「题材彩票」）。
// 生产档位只有 A/B 两档；此处保留 C 仅为探针第二轮的历史留存/可复现，勿据此脚本推断线上仍有 C 档。
const TIERS = [
  { key: 'A', label: 'A 档（基础）' },
  { key: 'B', label: 'B 档（自然）' },
  { key: 'C', label: 'C 档（地道）' }, // ⚠️ 已取消，见上；生产不用
]
const RUNS = [1, 2]

// ── 机器硬规则 H1-H6（H4 用启发式，避免 "a part of" 误报）──
function machine(text, part) {
  const words = (text.match(/\b[\w'-]+\b/g) || []).length
  const H1 = !/[一-鿿]/.test(text)                       // 纯英文
  const H2 = !/[#*`]/.test(text) && !/^["'].*["']$/.test(text.trim()) // 无 md / 整段引号包裹
  const H3 = !/[—–]/.test(text)                                  // 无破折号
  const H4 = !(/\b(band|ielts|fluency|lexical)\b/i.test(text) || /雅思/.test(text) || /\bpart\s*[123]\b/i.test(text)) // 无元信息泄漏
  const H5 = part === 1 ? words <= 60 : (words >= 120 && words <= 240) // 长度合规
  const H6 = words > 3                                            // 非空/非拒答
  const allPass = H1 && H2 && H3 && H4 && H6                      // H5 计入但不一票否决（metric-designer）
  return { words, H1, H2, H3, H4, H5, H6, allPass }
}

async function generate(part, tierLabel, analysis, corpus) {
  const maxTokens = part === 1 ? 512 : 1200
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(part, tierLabel, analysis, corpus) }],
      temperature: TEMPERATURE,
      max_tokens: maxTokens,
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return { text: (data.choices?.[0]?.message?.content ?? '').trim(), usage: data.usage }
}

// ── 组装 24 个任务 ──
const tasks = []
for (const inp of INPUTS)
  for (const tier of TIERS)
    for (const run of RUNS)
      tasks.push({ inp, tier, run })

// ── 并发池（4）──
async function pool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++
      try { out[idx] = await fn(items[idx]) }
      catch (e) { out[idx] = { error: String(e?.message || e) } }
    }
  }))
  return out
}

console.log(`跑 ${tasks.length} 条（qwen-plus, temp ${TEMPERATURE}, 并发 4）…`)
const results = await pool(tasks, 4, async ({ inp, tier, run }) => {
  const { text, usage } = await generate(inp.part, tier.label, inp.analysis, inp.corpus)
  return { inp, tier, run, text, usage, m: machine(text, inp.part) }
})

// ── 汇总 token + 机器通过 ──
let pTok = 0, cTok = 0, hardPass = 0, errs = 0
for (const r of results) {
  if (r.error) { errs++; continue }
  pTok += r.usage?.prompt_tokens || 0
  cTok += r.usage?.completion_tokens || 0
  if (r.m.allPass) hardPass++
}

// ── 生成报告 md ──
const flag = (b) => (b ? '✓' : '✗')
let md = `# Anki 卡背生成 · 探针结果（go/no-go 判分用）

- 模型 \`qwen-plus\` · temperature ${TEMPERATURE} · 每条同档 N=2
- 24 条：4 输入 × A/B/C × 2 run　|　机器硬规则通过 ${hardPass}/${results.length - errs}　|　失败 ${errs}
- token：prompt ${pTok} + completion ${cTok} = ${pTok + cTok}（24 条合计，供成本量级参考）
- 机器列：H1纯英文 / H2无md / H3无破折号 / H4无泄漏 / H5长度合规 / H6非空（H5 不一票否决）

> 人工判分：逐条盲判「像哪档」，再看「档位一致 / 中式 / 忠料 / 对题 / 口语化 / 达标」；最后填每输入的「三档可分性」。判分表结构见 \`docs/方案-Anki题卡-v0.1.md\` 相关及探针套件。

---
`
for (const inp of INPUTS) {
  md += `\n## 输入 ${inp.id}（Part ${inp.part}·${inp.topic}）\n\n`
  md += `**题面/分析**：\n\n\`\`\`\n${inp.analysis}\n\`\`\`\n\n**中文语料**：${inp.corpus}\n\n`
  // 仅 Part 2：先算同题 B 档两 run 的平均词数，供下面 C 档展示「C/B 长度比」——
  // 这是跨档约束（C ≤ B×1.15），machine() 逐条跑拿不到同题 B 档词数，只能在汇总阶段只读呈现，不参与 allPass 判定。
  let bAvgWords = null
  if (inp.part === 2) {
    const bWords = results
      .filter(x => x.inp.id === inp.id && x.tier.key === 'B' && !x.error)
      .map(x => x.m.words)
    if (bWords.length > 0) bAvgWords = bWords.reduce((a, b) => a + b, 0) / bWords.length
  }
  for (const tier of TIERS) {
    md += `### ${tier.label}\n`
    for (const run of RUNS) {
      const r = results.find(x => x.inp.id === inp.id && x.tier.key === tier.key && x.run === run)
      if (!r || r.error) { md += `- run${run}: ⚠️ 生成失败 ${r?.error || ''}\n`; continue }
      const m = r.m
      md += `- **run${run}**（${m.words} 词｜H1${flag(m.H1)} H2${flag(m.H2)} H3${flag(m.H3)} H4${flag(m.H4)} H5${flag(m.H5)} H6${flag(m.H6)}）\n`
      md += `  > ${r.text.replace(/\n+/g, ' ')}\n`
    }
    if (inp.part === 2 && tier.key === 'C' && bAvgWords) {
      const ratioStr = RUNS.map(run => {
        const r = results.find(x => x.inp.id === inp.id && x.tier.key === 'C' && x.run === run)
        if (!r || r.error) return `run${run} —`
        const ratio = r.m.words / bAvgWords
        const warn = ratio > 1.15 ? ' ⚠️' : ''
        return `run${run} ×${ratio.toFixed(2)}${warn}`
      }).join('　')
      md += `- C/B 长度比：${ratioStr}（红线 ≤1.15，B 档均值 ${bAvgWords.toFixed(1)} 词）\n`
    }
    md += `\n`
  }
  md += `**${inp.id} 三档可分性**（人填）：A↔B ☐　B↔C ☐　A↔C ☐　三档整体 ☐\n\n---\n`
}

mkdirSync('scripts/anki-probe', { recursive: true })
writeFileSync('scripts/anki-probe/report.md', md, 'utf8')
console.log(`完成：机器硬规则通过 ${hardPass}/${results.length - errs}，失败 ${errs}`)
console.log(`token 合计 ${pTok + cTok}（prompt ${pTok} + completion ${cTok}）`)
console.log(`报告已写 scripts/anki-probe/report.md`)
